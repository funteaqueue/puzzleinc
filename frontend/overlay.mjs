import { normalizePoint, MAX_POINTS } from './lib/protocol.mjs';
import { InkStore } from './lib/ink-store.mjs';
import {floatingControls} from './floating-controls.mjs';
const canvas = document.getElementById('ink');
const ctx = canvas.getContext('2d');
const store = new InkStore();
const cursor=document.getElementById('drawing-cursor');
function positionCursor(point){
 const visible=drawing&&config?.softwareCursor&&point&&Number.isFinite(point.x)&&Number.isFinite(point.y);
 cursor.toggleAttribute('hidden',!visible);
 if(visible)cursor.style.transform=`translate(${point.x-16}px,${point.y-16}px)`;
}
let config, drawing = false, showOthers = true, active = null, pending = [], overlayVisible = true, frameId = 0, wakeTimer = 0;
function invalidate() {
  clearTimeout(wakeTimer);
  if (overlayVisible && !frameId) frameId = requestAnimationFrame(frame);
}
function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); invalidate();
}
function wire(e) { window.ink.invoke('ink', e); }
function apply(e) { store.apply(e, performance.now()); invalidate(); }
function emit(e) { apply(e); wire(e); }
function flush() {
  if (active && pending.length) wire({ type: 'points', id: active.id, points: pending.splice(0) });
}
function finish() {
  if (!active) return;
  flush(); emit({ type: 'end', id: active.id }); active = null;
}
const controls=floatingControls(document.getElementById('hint'),document.getElementById('controls-grip'),{onDrag:finish});
window.ink.on('configure', c => { config = c; invalidate();document.getElementById('cursor-color').setAttribute('fill',c.color);positionCursor(null); });
window.ink.on('brush', c => { finish(); config = { ...config, ...c };document.getElementById('cursor-color').setAttribute('fill',c.color); });
window.ink.on('cursor',positionCursor);
window.ink.on('state', s => {
  if (!s.drawing) finish();
  const redraw = drawing !== s.drawing || showOthers !== (s.showOthers !== false) || overlayVisible !== (s.overlayVisible !== false);
  drawing = s.drawing;
  overlayVisible = s.overlayVisible !== false;
  if(!drawing||s.overlayVisible===false)positionCursor(null);
  showOthers = s.showOthers !== false;
  document.body.classList.toggle('drawing', drawing);
  document.getElementById('hint').hidden = !drawing;
  if(drawing)controls.layout();else controls.cancel();
  if (redraw) invalidate();
});
window.ink.on('ink', e => {
  if (e.type === 'clear' || (e.type === 'clear-author' && e.author === config?.participantId) || (e.type === 'remove' && e.id === active?.id)) { active = null; pending = []; }
  apply(e);
});
canvas.addEventListener('pointerdown', e => {
  if (!drawing || !config || e.button !== 0) return;
  const p = normalizePoint(e.clientX, e.clientY, config.region);
  if (!p) return;
  finish();
  if(config.tool==='question'){window.ink.invoke('question-ping',p);return;}
  canvas.setPointerCapture(e.pointerId);
  active = { id: config.participantId + '-' + crypto.randomUUID(), count: 1 };
  emit({ type: 'start', id: active.id, points: [p], color: config.color, width: config.tool === 'pointer' ? 0.012 : 0.0035, ttl: config.ttl });
  if (config.tool === 'pointer') finish();
});
canvas.addEventListener('pointermove', e => {
  if (!active || !drawing) return;
  const p = normalizePoint(e.clientX, e.clientY, config.region);
  if (!p) { finish(); return; }
  if (++active.count >= MAX_POINTS) { finish(); return; }
  apply({ type: 'points', id: active.id, points: [p] });
  pending.push(p);
  if (pending.length >= 64) flush();
});
for (const event of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(event, finish);
document.getElementById('stop').onclick = () => { finish(); window.ink.invoke('stop-draw'); };
document.getElementById('clear-own').onclick = () => { finish(); window.ink.invoke('clear-own'); };
window.addEventListener('resize', resize);
resize();
function frame(now) {
  frameId = 0;
  flush();
  if (!config || !overlayVisible) return;
  const strokes = store.visible(now);
  let nextChange = Infinity;
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  const r = config.region;
  if (drawing) {
    ctx.save();ctx.strokeStyle='#6ef0b566';ctx.lineWidth=1;ctx.setLineDash([6,6]);ctx.strokeRect(r.x+1,r.y+1,r.width-2,r.height-2);ctx.restore();
  }
  ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.width,r.height);ctx.clip();
  for (const s of strokes) {
    if (s.ended === null) nextChange = Math.min(nextChange, s.updated + 15001);
    if (!showOthers && !s.id.startsWith(config.participantId + '-')) continue;
    if (s.ttl && s.ended !== null) {
      nextChange = Math.min(nextChange, s.ended + s.ttl - 400);
    }
    ctx.globalAlpha = s.ttl && s.ended !== null ? Math.min(1, Math.max(0, (s.ttl - now + s.ended) / 400)) : 1;
    ctx.strokeStyle = ctx.fillStyle = s.color;
    ctx.lineWidth = s.width * r.height;ctx.lineCap='round';ctx.lineJoin='round';
    ctx.shadowColor='#000000bb';ctx.shadowBlur=3;
    if (s.points.length === 1) {
      ctx.beginPath();ctx.arc(r.x+s.points[0][0]*r.width,r.y+s.points[0][1]*r.height,ctx.lineWidth/2,0,Math.PI*2);ctx.fill();
    } else {
      ctx.beginPath();s.points.forEach((p,i) => { const x=r.x+p[0]*r.width, y=r.y+p[1]*r.height; if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y); });ctx.stroke();
    }
  }
  ctx.restore();
  if (nextChange <= now) invalidate();
  else if (Number.isFinite(nextChange)) wakeTimer = setTimeout(invalidate, nextChange - now);
}
