use axum::{
    extract::{
        ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
    routing::get,
    Router,
};
use futures_util::StreamExt;
use hmac::{Hmac, Mac};
use serde_json::{json, Value as V};
use sha2::Sha256;
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::{mpsc, watch};
use uuid::Uuid;

#[derive(Clone, Copy, PartialEq)]
enum PeerStatus {
    Active,
    Slow,
    Replaced,
}

struct Peer {
    socket: Uuid,
    tx: mpsc::Sender<V>,
    stop: watch::Sender<PeerStatus>,
}
struct Stroke {
    start: V,
    points: Vec<V>,
    ended: bool,
    time: Instant,
}
struct Room {
    id: String,
    key: String,
    peers: HashMap<String, Peer>,
    ink: VecDeque<Stroke>,
}
type Shared = Arc<Mutex<Room>>;
fn hex_id(v: &V) -> bool {
    v.as_str().is_some_and(|s| {
        s.len() == 64
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}
impl Room {
    fn broadcast(&self, m: V, except: &str) {
        for (id, p) in &self.peers {
            if id != except && p.tx.try_send(m.clone()).is_err() {
                let _ = p.stop.send(PeerStatus::Slow);
            }
        }
    }
    fn prune(&mut self) {
        self.ink.retain(|s| {
            let ttl = s.start["ttl"].as_u64().unwrap_or(0);
            if !s.ended {
                s.time.elapsed() < Duration::from_secs(15)
            } else {
                ttl == 0 || s.time.elapsed() < Duration::from_millis(ttl)
            }
        });
    }
    fn leave(&mut self, id: &str, socket: Uuid) {
        if !self.peers.get(id).is_some_and(|p| p.socket == socket) {
            return;
        }
        self.peers.remove(id);
        let prefix = format!("{id}-");
        let mut ends = Vec::new();
        for s in &mut self.ink {
            if !s.ended && s.start["id"].as_str().unwrap_or("").starts_with(&prefix) {
                s.ended = true;
                s.time = Instant::now();
                ends.push(json!({"type":"end","id":s.start["id"]}));
            }
        }
        for e in ends {
            self.broadcast(json!({"type":"event","event":e}), "")
        }
        self.broadcast(
            json!({"type":"members","participants":self.peers.len()}),
            "",
        );
    }
    fn event(&mut self, id: &str, m: V) {
        self.prune();
        let prefix = format!("{id}-");
        if m["type"] == "undo-own" {
            let own = |s: &Stroke| {
                s.start["id"]
                    .as_str()
                    .is_some_and(|sid| sid.starts_with(&prefix))
            };
            if let Some(index) = self.ink.iter().rposition(own) {
                let last = self.ink.remove(index).unwrap();
                let mut removed = vec![last.start["id"].clone()];
                if let Some(group) = last.start["undoGroup"].as_str() {
                    self.ink.retain(|s| {
                        if own(s) && s.start["undoGroup"] == group {
                            removed.push(s.start["id"].clone());
                            return false;
                        }
                        true
                    });
                }
                for sid in removed {
                    self.broadcast(
                        json!({"type":"event","event":{"type":"remove","id":sid}}),
                        "",
                    );
                }
            }
            return;
        }
        if m["type"] == "clear-own" {
            self.ink
                .retain(|s| !s.start["id"].as_str().unwrap_or("").starts_with(&prefix));
            self.broadcast(
                json!({"type":"event","event":{"type":"clear-author","author":id}}),
                id,
            );
            return;
        }
        let e = &m["event"];
        let Some(sid) = e["id"].as_str() else { return };
        if m["type"] != "event"
            || !sid.starts_with(&prefix)
            || sid.len() > 64
            || !sid.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return;
        }
        let points = e["points"].as_array();
        if e["type"] != "end"
            && !points.is_some_and(|ps| {
                !ps.is_empty()
                    && ps.len() <= 64
                    && ps.iter().all(|p| {
                        p.as_array().is_some_and(|a| {
                            a.len() == 2
                                && a.iter()
                                    .all(|n| n.as_f64().is_some_and(|x| (0.0..=1.0).contains(&x)))
                        })
                    })
            })
        {
            return;
        }
        let now = Instant::now();
        if e["type"] == "start" {
            if self.ink.iter().any(|s| s.start["id"] == sid)
                || !e["color"].as_str().is_some_and(|c| {
                    c.len() == 7
                        && c.starts_with('#')
                        && c[1..].bytes().all(|b| b.is_ascii_hexdigit())
                })
                || !e["width"]
                    .as_f64()
                    .is_some_and(|w| (0.0005..=0.02).contains(&w))
                || !matches!(e["ttl"].as_u64(), Some(0 | 2000 | 5000 | 10000))
            {
                return;
            }
            let mut start = json!({"type":"start","id":sid,"color":e["color"],"width":e["width"],"ttl":e["ttl"]});
            if let Some(group) = e.get("undoGroup") {
                if !group.as_str().is_some_and(|g| {
                    !g.is_empty()
                        && g.len() <= 32
                        && g.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                }) {
                    return;
                }
                start["undoGroup"] = group.clone();
            }
            self.ink.push_back(Stroke {
                start,
                points: points.unwrap().clone(),
                ended: false,
                time: now,
            });
        } else {
            let Some(s) = self
                .ink
                .iter_mut()
                .find(|s| s.start["id"] == sid && !s.ended)
            else {
                return;
            };
            if e["type"] == "end" {
                s.ended = true
            } else if e["type"] == "points" && s.points.len() + points.unwrap().len() <= 4096 {
                s.points.extend_from_slice(points.unwrap())
            } else {
                return;
            }
            s.time = now;
        }
        while self.ink.len() > 256 || self.ink.iter().map(|s| s.points.len()).sum::<usize>() > 65536
        {
            self.ink.pop_front();
        }
        self.broadcast(json!({"type":"event","event":e}), id);
    }
    fn join(
        &mut self,
        m: &V,
        socket: Uuid,
        tx: mpsc::Sender<V>,
        stop: watch::Sender<PeerStatus>,
    ) -> Result<(String, Vec<V>), V> {
        if m["type"] != "join"
            || m["protocol"] != 4
            || m["accessKey"] != self.key
            || !hex_id(&m["identity"])
        {
            return Err(json!({"type":"error","message":"Немає доступу до сесії."}));
        }
        let mut mac = Hmac::<Sha256>::new_from_slice(self.key.as_bytes()).unwrap();
        mac.update(m["identity"].as_str().unwrap().as_bytes());
        let id = format!("{:x}", mac.finalize().into_bytes())[..24].to_string();
        if let Some(p) = self.peers.get(&id) {
            let _ = p.stop.send(PeerStatus::Replaced);
            self.leave(&id, p.socket);
        }
        if self.peers.len() >= 32 {
            return Err(json!({"type":"error","message":"У сесії вже 32 учасники."}));
        }
        self.peers.insert(id.clone(), Peer { tx, stop, socket });
        let mut messages = vec![
            json!({"type":"ready","protocol":4,"serverId":self.id,"participantId":id,"config":{"aspect":16.0/9.0},"participants":self.peers.len()}),
        ];
        self.prune();
        for s in &self.ink {
            if s.ended && s.start["ttl"] != 0 {
                continue;
            }
            for (i, batch) in s.points.chunks(64).enumerate() {
                let mut e = if i == 0 {
                    s.start.clone()
                } else {
                    json!({"type":"points","id":s.start["id"]})
                };
                e["points"] = json!(batch);
                messages.push(json!({"type":"event","event":e}));
            }
            if s.ended {
                messages.push(json!({"type":"event","event":{"type":"end","id":s.start["id"]}}));
            }
        }
        messages.push(json!({"type":"synced"}));
        self.broadcast(
            json!({"type":"members","participants":self.peers.len()}),
            &id,
        );
        Ok((id, messages))
    }
}
async fn peer(mut ws: WebSocket, room: Shared, mut shutdown: watch::Receiver<bool>) {
    let Ok(Some(Ok(Message::Text(text)))) =
        tokio::time::timeout(Duration::from_secs(12), ws.recv()).await
    else {
        return;
    };
    let Ok(m) = serde_json::from_str(&text) else {
        return;
    };
    let socket = Uuid::new_v4();
    let (tx, mut rx) = mpsc::channel(512);
    let (stop, mut gone) = watch::channel(PeerStatus::Active);
    let joined = room.lock().unwrap().join(&m, socket, tx, stop);
    let (id, replay) = match joined {
        Ok(x) => x,
        Err(e) => {
            let _ = ws.send(Message::Text(e.to_string().into())).await;
            return;
        }
    };
    let run = async {
        for v in replay {
            ws.send(Message::Text(v.to_string().into())).await.ok()?;
        }
        let mut pulse = tokio::time::interval(Duration::from_secs(15));
        let mut pong = true;
        let mut count = 0;
        let mut since = Instant::now();
        loop {
            tokio::select! {
             _=pulse.tick()=>{if !pong{break}pong=false;ws.send(Message::Ping(Vec::new().into())).await.ok()?;}
             Some(v)=rx.recv()=>ws.send(Message::Text(v.to_string().into())).await.ok()?,
             incoming=ws.next()=>match incoming{Some(Ok(Message::Pong(_)))=>pong=true,Some(Ok(Message::Ping(payload)))=>ws.send(Message::Pong(payload)).await.ok()?,Some(Ok(Message::Text(t)))=>{if since.elapsed()>=Duration::from_secs(1){since=Instant::now();count=0}count+=1;if count>240{break}let m=serde_json::from_str(&t).ok()?;let mut r=room.lock().unwrap();if r.peers.get(&id).is_some_and(|p|p.socket==socket){r.event(&id,m)}},_=>break}
            }
        }
        Some(())
    };
    let replaced = tokio::select! {
        biased;
        changed = gone.changed() => changed.is_ok() && *gone.borrow() == PeerStatus::Replaced,
        _ = shutdown.changed() => false,
        _ = run => false
    };
    if replaced {
        let _ = tokio::time::timeout(Duration::from_secs(1), async {
            let error = json!({"type":"error","code":"session-replaced","message":"Цей профіль підключився знову. Щоб повернутися з цієї копії, натисніть «Підключитися»."});
            ws.send(Message::Text(error.to_string().into())).await?;
            ws.send(Message::Close(Some(CloseFrame {code:4001,reason:"Session replaced".into()}))).await
        }).await;
    }
    room.lock().unwrap().leave(&id, socket);
}
pub async fn serve(
    listener: tokio::net::TcpListener,
    key: String,
    id: String,
    mut stop: watch::Receiver<bool>,
) {
    let room = Arc::new(Mutex::new(Room {
        id: id.clone(),
        key,
        peers: HashMap::new(),
        ink: VecDeque::new(),
    }));
    let stopping = stop.clone();
    let router = Router::new()
        .route(
            "/",
            get(
                move |State(room): State<Shared>,
                      ws: Result<
                    WebSocketUpgrade,
                    axum::extract::ws::rejection::WebSocketUpgradeRejection,
                >| async move {
                    match ws {
                        Ok(ws) => ws
                            .max_message_size(16384)
                            .on_upgrade(move |ws| peer(ws, room, stopping))
                            .into_response(),
                        Err(_) => (
                            [
                                ("x-puzzle-ink-protocol", "4"),
                                ("x-puzzle-ink-server", id.as_str()),
                                ("cache-control", "no-store"),
                            ],
                            "Puzzle Ink relay",
                        )
                            .into_response(),
                    }
                },
            ),
        )
        .with_state(room);
    let _ = axum::serve(listener, router)
        .with_graceful_shutdown(async move {
            let _ = stop.changed().await;
        })
        .await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::SinkExt;
    use tokio_tungstenite::{connect_async, tungstenite::Message as Wire};
    #[tokio::test]
    async fn desktop_clients_recover_history_and_clear_only_their_own_strokes() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("ws://{}", listener.local_addr().unwrap());
        let key = "b".repeat(64);
        let (stop, rx) = watch::channel(false);
        let task = tokio::spawn(serve(listener, key.clone(), "test".into(), rx));
        type Socket = tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >;
        async fn next(c: &mut Socket) -> V {
            loop {
                match tokio::time::timeout(Duration::from_secs(3), c.next())
                    .await
                    .unwrap()
                    .unwrap()
                    .unwrap()
                {
                    Wire::Text(t) => return serde_json::from_str(&t).unwrap(),
                    Wire::Ping(p) => c.send(Wire::Pong(p)).await.unwrap(),
                    _ => {}
                }
            }
        }
        async fn join(url: &str, key: &str, who: &str) -> (Socket, V) {
            let (mut c, _) = connect_async(url).await.unwrap();
            let m = json!({"type":"join","protocol":4,"identity":who.repeat(64),"accessKey":key});
            c.send(Wire::Text(m.to_string().into())).await.unwrap();
            let ready = next(&mut c).await;
            (c, ready)
        }
        let (mut a, r) = join(&url, &key, "a").await;
        let id = r["participantId"].as_str().unwrap().to_string();
        assert_eq!(next(&mut a).await["type"], "synced");
        let (mut b, _) = join(&url, &key, "c").await;
        next(&mut b).await;
        next(&mut a).await;
        let sid = format!("{id}-first");
        let start = json!({"type":"start","id":sid,"color":"#010203","width":0.004,"ttl":0,"points":[[0.1,0.2]]});
        a.send(Wire::Text(
            json!({"type":"event","event":start}).to_string().into(),
        ))
        .await
        .unwrap();
        assert_eq!(next(&mut b).await["event"], start);
        let (mut a2, r2) = join(&url, &key, "a").await;
        assert_eq!(next(&mut a).await["code"], "session-replaced");
        assert_eq!(r2["participants"], 2);
        assert_eq!(r2["participantId"], id);
        assert_eq!(next(&mut a2).await["event"], start);
        assert_eq!(next(&mut a2).await["event"]["type"], "end");
        assert_eq!(next(&mut a2).await["type"], "synced");
        b.send(Wire::Text(
            json!({"type":"clear-own","author":id}).to_string().into(),
        ))
        .await
        .unwrap();
        assert_ne!(next(&mut a2).await["event"]["author"], id);
        a2.send(Wire::Text(json!({"type":"undo-own"}).to_string().into()))
            .await
            .unwrap();
        assert_eq!(
            next(&mut a2).await["event"],
            json!({"type":"remove","id":sid})
        );
        while next(&mut b).await["event"]["type"] != "remove" {}
        let (mut late, _) = join(&url, &key, "e").await;
        assert_eq!(next(&mut late).await["type"], "synced");
        drop(late);
        stop.send(true).unwrap();
        drop((a, a2, b));
        task.await.unwrap();
    }
}
