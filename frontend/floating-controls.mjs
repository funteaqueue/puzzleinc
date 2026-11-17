// Move only the small DOM toolbar, never the native full-screen overlay window.
export function floatingControls(panel,handle,{onDrag=()=>{}}={}){
 const storageKey='puzzle-overlay-controls-position-v1',margin=8;let position=null,drag=null;
 try{const saved=JSON.parse(localStorage.getItem(storageKey));if(saved&&[saved.x,saved.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1))position=saved;}catch{}
 const bounds=()=>({width:Math.max(0,innerWidth-panel.offsetWidth-margin*2),height:Math.max(0,innerHeight-panel.offsetHeight-margin*2)});
 function place(x,y){const b=bounds(),left=Math.max(margin,Math.min(margin+b.width,x)),top=Math.max(margin,Math.min(margin+b.height,y));panel.style.transform='none';panel.style.left=left+'px';panel.style.top=top+'px';return {x:b.width?(left-margin)/b.width:0,y:b.height?(top-margin)/b.height:0};}
 function layout(){if(panel.hidden||drag)return;const b=bounds();if(position)place(margin+position.x*b.width,margin+position.y*b.height);else place(margin+b.width/2,16);}
 function cancel(){if(!drag)return;const id=drag.id;drag=null;panel.classList.remove('dragging');if(handle.hasPointerCapture(id))handle.releasePointerCapture(id);if(position)try{localStorage.setItem(storageKey,JSON.stringify(position));}catch{}}
 handle.addEventListener('pointerdown',event=>{
  if(event.button!==0||drag)return;event.preventDefault();event.stopPropagation();onDrag();const rect=panel.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX-rect.left,y:event.clientY-rect.top};handle.setPointerCapture(event.pointerId);panel.classList.add('dragging');
 });
 handle.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id)return;event.preventDefault();position=place(event.clientX-drag.x,event.clientY-drag.y);});
 for(const event of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(event,cancel);
 window.addEventListener('resize',layout);
 return {layout,cancel};
}
