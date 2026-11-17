import {defaults,preferences,upgradeDrawingHotkeys} from './lib/preferences.mjs';
import {containRect,normalizePoint,validConfig,validEvent,AUTHOR_PATTERN} from './lib/protocol.mjs';
import {HotkeyEdges,MODIFIERS,parseKey} from './lib/hotkeys.mjs';
import {InkStore} from './lib/ink-store.mjs';
import {questionPing} from './lib/question-ping.mjs';
import {isDuplicateConnection,reconnectMessage,replacedCloseCode,replacedMessage} from './lib/connection-errors.mjs';
const channel=new BroadcastChannel('puzzle-overlay-v1');
const listeners=new Map();
const notify=(name,data)=>listeners.get(name)?.(data);
const post=(name,data)=>channel.postMessage({name,data});
const on=(name,fn)=>listeners.set(name,fn);
const native=(name,args={})=>window.__TAURI__.core.invoke(name,args);
const overlay=location.pathname.endsWith('overlay.html');
if(overlay){
 window.ink={on,invoke:(name,data)=>{post('command',{name,data});return Promise.resolve({ok:true});}};
 channel.onmessage=e=>notify(e.data.name,e.data.data);
 await import('./overlay.mjs');post('loaded');
}else{
 const info=await native('startup'),display=info.displays[0];
 let saved={};try{saved=JSON.parse(localStorage.getItem('preferences')||'{}')}catch{}
 let prefs=preferences(saved,defaults(info.url,{id:display.id,bounds:display}));
 if(saved.drawingHotkeysVersion!==1){
  upgradeDrawingHotkeys(prefs);
  localStorage.setItem('preferences',JSON.stringify({...prefs,drawingHotkeysVersion:1}));
 }
 if(!info.displays.some(d=>d.id===prefs.displayId))prefs.displayId=display.id;
 const secret=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
 const identity=localStorage.getItem('identity')||secret();localStorage.setItem('identity',identity);
 let editingShortcut=false;
 const instanceId=secret(),edges=new HotkeyEdges(),store=new InkStore();
 let state={connected:false,connecting:false,syncing:false,drawing:false,overlayVisible:prefs.overlayVisible,showOthers:prefs.showOthers,selectedPreset:prefs.selectedPreset,participants:0,hosting:{phase:'stopped'},message:''};
 let ws,timer,deadline,author,aspect=16/9,readyOverlay=false,lastPing=-Infinity,modeQueue=Promise.resolve(),hostGeneration=0,hostTimer;
 const config=()=>{const d=info.displays.find(d=>d.id===prefs.displayId)||display;return {region:prefs.manual?prefs.region:containRect({x:0,y:0,width:d.width,height:d.height},aspect),participantId:author,softwareCursor:info.platform==='macos',...brush()};};
 function brush(){return {tool:prefs.tool,ttl:prefs.ttl,color:prefs.presets[prefs.selectedPreset]}}
 function update(patch){Object.assign(state,patch);notify('state',{...state});post('state',state)}
 if(info.platform==='macos'){
  const refresh=async()=>update({inputAllowed:await native('input_permission',{request:false})});
  await refresh();window.addEventListener('focus',refresh);
 }
 function configureKeys(){edges.previous=null;const keys=new Set(MODIFIERS);for(const b of prefs.bindings)keys.add(parseKey(b.key).key);if(prefs.digitColors)for(const k of prefs.colorKeys)if(k)keys.add(parseKey(k).key);
 return native('set_keys',{keys:state.connected&&!state.syncing&&prefs.hotkeysEnabled?[...keys]:[]});}

 let nativeMode='',idleClose,inkExpiry,expiryAt=Infinity;
 function mode(){
  const visible=state.connected&&state.overlayVisible&&(state.drawing||store.strokes.size>0);
  const args={display:prefs.displayId,visible,drawing:visible&&state.drawing},key=JSON.stringify(args);
  if(key===nativeMode)return modeQueue;
  nativeMode=key;clearTimeout(idleClose);
  modeQueue=modeQueue.catch(()=>{}).then(()=>native('overlay_mode',args)).catch(e=>{nativeMode='';update({drawing:false,keyboardError:'Оверлей: '+String(e)});});
  if(!visible)idleClose=setTimeout(()=>{
    if(nativeMode!==key)return;
    modeQueue=modeQueue.then(async()=>{if(nativeMode===key){readyOverlay=false;await native('release_overlay');}});
  },10000);
  return modeQueue;
 }
 function expireLater(at){
  if(at>=expiryAt)return;
  clearTimeout(inkExpiry);expiryAt=at;
  inkExpiry=setTimeout(()=>{
   expiryAt=Infinity;
   for(const s of store.visible(performance.now())){
    if(s.ended===null)expireLater(s.updated+15001);
    else if(s.ttl)expireLater(s.ended+s.ttl+1);
   }
   mode();
  },Math.max(1,at-performance.now()));
 }
 function persist(){localStorage.setItem('preferences',JSON.stringify({...prefs,drawingHotkeysVersion:1}));notify('preferences',prefs)}
 function sync(){post('configure',config());post('ink',{type:'clear'});for(const s of store.visible(performance.now())){
 for(let i=0;i<s.points.length;i+=64)post('ink',i?{type:'points',id:s.id,points:s.points.slice(i,i+64)}:{type:'start',id:s.id,color:s.color,width:s.width,ttl:s.ttl,points:s.points.slice(0,64)});
 if(s.ended!==null)post('ink',{type:'end',id:s.id});}post('state',state)}
 function send(m){if(ws?.readyState===1&&ws.bufferedAmount<1048576)ws.send(JSON.stringify(m));}
 function ink(e,echo=true){const now=performance.now();store.apply(e,now);if(echo&&readyOverlay)post('ink',e);if(e.type==='start')expireLater(now+15001);if(e.type==='end'){const s=store.strokes.get(e.id);if(s?.ttl)expireLater(now+s.ttl+1)}if(e.type!=='points')mode();}
 function disconnect(message,retry=false){
 clearTimeout(timer);clearTimeout(deadline);const old=ws;ws=null;old?.close();author=null;store.apply({type:'clear'});post('ink',{type:'clear'});
 update({connected:false,connecting:false,syncing:false,participants:0,drawing:false,message});void mode();void configureKeys();
 if(retry)timer=setTimeout(connect,3000);}
 function connect(){
 disconnect('Підключення…');update({connecting:true});
 const sock=ws=new WebSocket(prefs.url);
 deadline=setTimeout(()=>{if(ws===sock)disconnect('Сервер недоступний. Повторюю підключення…',true)},12000);
 sock.onopen=()=>send({type:'join',protocol:4,identity,instanceId,accessKey:info.accessKey});
 sock.onclose=e=>{if(ws!==sock)return;if(e.code===replacedCloseCode)return disconnect(replacedMessage);disconnect('Зв’язок втрачено. Повторюю підключення…',true)};
 sock.onmessage=({data})=>{if(sock!==ws)return;let m;try{m=JSON.parse(data)}catch{return}
 if(m.type==='ready'&&validConfig(m.config)&&AUTHOR_PATTERN.test(m.participantId)){clearTimeout(deadline);author=m.participantId;aspect=m.config.aspect;update({connected:true,connecting:false,syncing:true,participants:m.participants});post('configure',config());void mode();}
 else if(m.type==='synced'&&author){update({syncing:false});void configureKeys();}
 else if(m.type==='event'&&author&&validEvent(m.event))ink(m.event);
 else if(m.type==='members')update({participants:m.participants});
 else if(m.type==='error')disconnect(isDuplicateConnection(m)?reconnectMessage:m.message,isDuplicateConnection(m));};}
 function probe(url){return new Promise(resolve=>{const s=new WebSocket(url);const done=value=>{clearTimeout(timeout);s.onclose=s.onerror=null;s.close();resolve(value);};const timeout=setTimeout(()=>done(null),4000);s.onopen=()=>s.send(JSON.stringify({type:'join',protocol:4,accessKey:info.accessKey,identity:secret()}));s.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='ready')done(m.serverId);else if(m.type==='error')done('occupied')};s.onerror=s.onclose=()=>done(null);});}
 function hostState(phase,message){update({hosting:{phase,message}})}
 async function stopHost(){++hostGeneration;clearInterval(hostTimer);await native('stop_host');hostState('stopped','');}
 async function startHost(){if(['running','starting'].includes(state.hosting.phase))return;const gen=++hostGeneration;
 hostState('starting','Перевіряю сервер…');try{
 const existing=await probe(info.url);if(gen!==hostGeneration)return;if(existing){hostState('stopped','Сервер уже працює.');connect();return;}
 const id=await native('start_host');if(gen!==hostGeneration){await native('stop_host');return;}
 hostState('starting','Підключаю тунель…');const end=Date.now()+60000;
 while(gen===hostGeneration&&Date.now()<end){if(!await native('host_alive'))throw Error('Тунель завершив роботу.');const current=await probe(info.url);if(gen!==hostGeneration)return;
 if(current===id){hostState('running','');hostTimer=setInterval(async()=>{if(!await native('host_alive')&&gen===hostGeneration){clearInterval(hostTimer);hostState('error','Тунель завершив роботу.')}},2000);connect();return}
 if(current)throw Error('У сесії вже працює інший сервер.');await new Promise(r=>setTimeout(r,800));}
 if(gen===hostGeneration)throw Error('Тунель не став доступним.');
 }catch(e){if(gen===hostGeneration){await stopHost();hostState('error',String(e));}}}
 async function act(name,data){switch(name){
 case 'editing-shortcut':editingShortcut=data===true;return;
 case 'init':return {state,preferences:prefs,platform:info.platform,displays:info.displays};
 case 'connect':return connect();case 'disconnect':return disconnect('Від’єднано');
 case 'request-input':if(info.platform==='macos')update({inputAllowed:await native('input_permission',{request:true})});return;
 case 'start-server':if(info.platform!=='macos')return startHost();return;
 case 'stop-server':if(info.platform!=='macos')return stopHost();return;
 case 'draw':case 'stop-draw':{const drawing=name==='draw'&&!state.drawing&&state.connected&&!state.syncing;if(drawing&&!prefs.overlayVisible){prefs.overlayVisible=true;persist()}update({drawing,overlayVisible:prefs.overlayVisible});return mode();}
 case 'toggle-overlay':prefs.overlayVisible=!prefs.overlayVisible;update({overlayVisible:prefs.overlayVisible,drawing:false});persist();return mode();
 case 'toggle-others':prefs.showOthers=!prefs.showOthers;update({showOthers:prefs.showOthers});persist();return;
 case 'undo-own':if(author&&!state.syncing)send({type:'undo-own'});return;
 case 'clear-own':if(author&&!state.syncing){ink({type:'clear-author',author});send({type:'clear-own'})}return;
 case 'color':if(Number.isInteger(data)&&data>=0&&data<9){prefs.selectedPreset=data;post('brush',brush());update({selectedPreset:data});persist()}return;
 case 'question-ping':{if(!author||state.syncing||performance.now()-lastPing<650)return;
 const r=config().region;const p=data??normalizePoint(...await native('pointer',{display:prefs.displayId}),r);
 for(const e of questionPing({point:p,aspect:r.width/r.height,author,id:crypto.randomUUID().replaceAll('-','')})){ink(e);send({type:'event',event:e});}lastPing=performance.now();return;}
 case 'ink':if(author&&validEvent(data)&&data.id?.startsWith(author+'-')&&['start','points','end'].includes(data.type)){ink(data,false);send({type:'event',event:data})}return;
 case 'save-settings':{const next=preferences(data,prefs);
 if(next.url!==new URL(info.url).href&&!/^ws:\/\/127\.0\.0\.1:\d+\/$/.test(next.url))throw Error('Доступна персональна адреса або локальний сервер 127.0.0.1.');
 const changed=prefs.url!==next.url;prefs=next;persist();post('configure',config());post('brush',brush());await configureKeys();if(changed)connect();else if(state.connected)await mode();return prefs;}
 }}
 window.puzzleKeys=keys=>{const actions=edges.sample(new Set(keys),{bindings:prefs.bindings,enabled:state.connected&&!state.syncing&&prefs.hotkeysEnabled,drawing:state.drawing,digits:prefs.digitColors,colorKeys:prefs.colorKeys,suspended:editingShortcut});
 for(const a of actions){if(a.startsWith('color-'))act('color',Number(a.slice(-1))-1);else act(a==='toggle-drawing'?'draw':a);}};
 channel.onmessage=({data:m})=>{if(m.name==='loaded'){readyOverlay=true;sync()}else if(m.name==='command'&&['ink','clear-own','stop-draw','question-ping'].includes(m.data.name))act(m.data.name,m.data.data)};
 window.ink={on,invoke:async(name,data)=>{try{return {ok:true,value:await act(name,data)}}catch(e){return {ok:false,error:String(e)}}}};
 await import('./panel.mjs');if(prefs.autoConnect)connect();
}
