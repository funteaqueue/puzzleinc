import {parseKey,ACTIONS} from './lib/hotkeys.mjs';
import {hexToHsv,hsvToHex} from './lib/color.mjs';
const $=id=>document.getElementById(id);
const labels={'undo-own':'Скасувати останній свій штрих','clear-own':'Стерти мої','toggle-others':'Приховати / показати чужі','toggle-drawing':'Перемкнути малювання','toggle-overlay':'Приховати / показати весь оверлей','question-ping':'Пінг ? під курсором'};
let displays=[],prefs={},state={},editorIndex=0,hsv={h:0,s:0,v:1},recordingColor=false,platform='';
const pretty=key=>key.replaceAll('Control','Ctrl').replaceAll('Meta',platform==='linux'?'Super':'Win').replace('CapsLock','Caps Lock').replaceAll('+',' + ');
function icon(name){const el=document.createElementNS('http://www.w3.org/2000/svg','svg');el.classList.add('icon');const use=document.createElementNS(el.namespaceURI,'use');use.setAttribute('href','#i-'+name);el.append(use);return el}
async function invoke(name,data){
 const r=await window.ink.invoke(name,data);if(!r.ok){$('status').textContent=r.error;$('status').hidden=false;if($('settings-dialog').open)$('saved').textContent=r.error;if($('color-editor').matches(':popover-open'))$('color-error').textContent=r.error;return null}return r.value??true;
}
function update(s){
 state=s;const ready=s.connected&&!s.syncing;
 $('connection-label').textContent=s.connected?'На зв’язку':s.connecting?'Підключення…':'Немає зв’язку';
 $('connection-dot').className='dot'+(s.connected?' online':s.connecting?' pending':'');
 $('peer').textContent=s.connected?`${s.participants} / 32`:'—';
 $('status').textContent=s.syncing?'Завантаження спільних позначок…':s.message;
 $('status').hidden=ready||s.connecting||!s.message;
 $('connect').hidden=s.connected||s.connecting;$('disconnect').hidden=!s.connected&&!s.connecting;
 $('draw').disabled=$('clear').disabled=!ready;
 $('draw-label').textContent=s.drawing?'Завершити малювання':s.overlayVisible===false?'Показати й малювати':'Почати малювання';
 $('draw').classList.toggle('active',!!s.drawing);
 $('toggle-overlay').setAttribute('aria-checked',String(s.overlayVisible!==false));
 $('overlay-label').textContent=s.overlayVisible===false?'Оверлей вимкнено':'Оверлей увімкнено';
 $('overlay-icon').setAttribute('href',s.overlayVisible===false?'#i-hide':'#i-eye');
 const overlayBinding=prefs.bindings?.find(b=>b.actions.includes('toggle-overlay'));
 const prefix=prefs.hotkeysEnabled&&overlayBinding?pretty(overlayBinding.key)+' — ':'';
 $('overlay-help').textContent=s.overlayVisible===false?prefix+'повернути позначки. З’єднання зберігається.':!s.connected?'Позначки з’являться після підключення.':prefix+'приховати все та вимкнути малювання';
 $('others-label').textContent=s.showOthers?'Приховати чужі':'Показати чужі';$('others').setAttribute('aria-pressed',String(!s.showOthers));
 $('others-icon').setAttribute('href',s.showOthers?'#i-hide':'#i-eye');
 $('warning').hidden=!s.keyboardError;$('warning').textContent=s.keyboardError||'';
 const host=s.hosting||{phase:'stopped',message:''};const active=['starting','running','stopping'].includes(host.phase);
 $('start-server').hidden=active||s.connected;$('stop-server').hidden=!active;$('stop-server').disabled=host.phase==='stopping';
 $('start-server').disabled=!!s.hostingUnavailable;$('start-server').title=s.hostingUnavailable||'';
 $('stop-server').textContent=host.phase==='starting'?'Скасувати':'Зупинити';
 $('server-label').textContent=host.phase==='running'?'Сервер на цьому ПК':host.phase==='starting'?'Запускаю сервер…':host.phase==='stopping'?'Зупиняю сервер…':s.connected?'Сервер у сесії':'Сервер не запущено';
 $('host-dot').className='dot'+(host.phase==='running'||s.connected?' online':active?' pending':'');
 $('host-status').textContent=host.phase==='running'?'Залиш застосунок відкритим — можна згорнути.':active||host.phase==='error'?host.message:s.connected?'Усі учасники бачать спільні позначки.':'Сервер запускає один із вас. Решта підключається автоматично.';
 if(s.hostingUnavailable&&!s.connected)$('host-status').textContent=s.hostingUnavailable;
 renderPalette();
}
function renderPalette(){
 if(!prefs.presets)return;
 for(const [i,cell] of [...$('palette').children].entries()){
  const swatch=cell.querySelector('.swatch'),key=cell.querySelector('.preset-key');swatch.style.setProperty('--swatch',prefs.presets[i]);swatch.setAttribute('aria-pressed',String(i===state.selectedPreset));swatch.title=`Колір ${i+1} · ${prefs.presets[i]} · ПКМ — редагувати`;
  key.textContent=prefs.colorKeys[i]?pretty(prefs.colorKeys[i]):'—';key.title='Змінити клавішу кольору '+(i+1);key.setAttribute('aria-label','Змінити клавішу кольору '+(i+1));
 }
}
function brush(p){
 prefs=p;$('ttl').value=p.ttl;$('pen').setAttribute('aria-pressed',String(p.tool==='pen'));$('pointer').setAttribute('aria-pressed',String(p.tool==='pointer'));
 $('question').setAttribute('aria-pressed',String(p.tool==='question'));
 const ping=p.bindings.find(b=>b.actions.includes('question-ping'));
 const pingScope=ping?.scope==='drawing'?'під час малювання':'у сесії';
 $('ping-help').textContent=(p.hotkeysEnabled&&ping?pretty(ping.key)+' — пінг ? під курсором '+pingScope+'. ':'Пінг ? можна призначити на клавішу в налаштуваннях. ')+'Жовтий знак зникає через 2 секунди.';
 const drawing=p.bindings.find(b=>b.actions.includes('toggle-drawing')),overlay=p.bindings.find(b=>b.actions.includes('toggle-overlay'));
 $('draw-key').hidden=!p.hotkeysEnabled||!drawing;$('draw-key').textContent=drawing?pretty(drawing.key):'';
 $('overlay-key').hidden=!p.hotkeysEnabled||!overlay;$('overlay-key').textContent=overlay?pretty(overlay.key):'';
 const acts=drawing?new Set(p.bindings.filter(b=>b.key===drawing.key).flatMap(b=>b.actions)):new Set();
 $('draw-help').textContent=!p.hotkeysEnabled?'Хоткеї вимкнені. Кнопки працюють.':drawing?pretty(drawing.key)+': '+ACTIONS.filter(a=>acts.has(a)).map(a=>labels[a].toLowerCase()).join(' + '):'Клавішу малювання можна призначити в налаштуваннях.';
 update(state);
}
for(let i=0;i<9;i++){
 const cell=document.createElement('div');cell.className='preset';const wrap=document.createElement('div');wrap.className='swatch-wrap';
 const swatch=document.createElement('button');swatch.className='swatch';swatch.setAttribute('aria-label','Вибрати колір '+(i+1));swatch.onclick=()=>invoke('color',i);swatch.oncontextmenu=e=>{e.preventDefault();openEditor(i)};
 const edit=document.createElement('button');edit.className='edit-color';edit.setAttribute('aria-label','Редагувати колір '+(i+1));edit.title='Змінити колір і клавішу';edit.append(icon('pen'));edit.onclick=()=>openEditor(i);
 const key=document.createElement('button');key.className='preset-key';key.onclick=()=>openEditor(i,true);wrap.append(swatch,edit);cell.append(wrap,key);$('palette').append(cell);
}
function positionEditor(){const rect=$('palette').children[editorIndex].getBoundingClientRect(),box=$('color-editor');const left=Math.min(innerWidth-box.offsetWidth-14,Math.max(14,rect.right+8));const top=Math.max(12,Math.min(rect.top-140,innerHeight-box.offsetHeight-12));box.style.left=left+'px';box.style.top=top+'px'}
function openEditor(index,record=false){
 editorIndex=index;recordingColor=false;$('color-title').textContent='Колір '+(index+1);$('color-key').value=prefs.colorKeys[index];$('color-error').textContent='';hsv=hexToHsv(prefs.presets[index]);paintPicker();
 if(!$('color-editor').matches(':popover-open'))$('color-editor').showPopover();positionEditor();invoke('color',index);if(record)recordColor();
}
function paintPicker(){const hex=hsvToHex(hsv);$('sv').style.setProperty('--hue',`hsl(${hsv.h},100%,50%)`);$('sv-cursor').style.left=(hsv.s*100)+'%';$('sv-cursor').style.top=((1-hsv.v)*100)+'%';$('hue').value=hsv.h;$('hex').value=hex.toUpperCase();$('color-preview').style.backgroundColor=hex}
async function commitColor(){const colors=[...prefs.presets];colors[editorIndex]=hsvToHex(hsv);prefs.presets=colors;renderPalette();$('color-error').textContent='';$('color-save-status').textContent='Зберігаю…';const p=await invoke('save-settings',{presets:colors});$('color-save-status').textContent=p?'Збережено':'Не збережено'}
function pointColor(e){const r=$('sv').getBoundingClientRect();hsv.s=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));hsv.v=1-Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));paintPicker()}
let colorPointer=null;
$('sv').onpointerdown=e=>{if(e.button!==0)return;colorPointer=e.pointerId;$('sv').setPointerCapture(e.pointerId);pointColor(e)};
$('sv').onpointermove=e=>{if(e.pointerId===colorPointer)pointColor(e)};
$('sv').onpointerup=e=>{if(e.pointerId===colorPointer){pointColor(e);colorPointer=null;commitColor()}};
$('sv').onpointercancel=()=>{colorPointer=null};
$('hue').oninput=()=>{hsv.h=Number($('hue').value);paintPicker()};$('hue').onchange=commitColor;
$('hex').onchange=()=>{const hex=$('hex').value;if(!/^#[a-f0-9]{6}$/i.test(hex)){$('color-error').textContent='Введи HEX, наприклад #65B8FF.';return}hsv=hexToHsv(hex);paintPicker();commitColor()};
$('close-color').onclick=()=>$('color-editor').hidePopover();
$('color-editor').addEventListener('toggle',e=>{if(e.newState==='closed'){recordingColor=false;$('color-key-help').textContent='Лише під час малювання. Зміни зберігаються одразу.'}});
window.addEventListener('resize',()=>{if($('color-editor').matches(':popover-open'))positionEditor()});
function eventKey(e){return parseKey([e.ctrlKey?'Control':'',e.altKey?'Alt':'',e.shiftKey?'Shift':'',e.metaKey?'Meta':'',e.code.replace(/^Key/,'').replace(/^Digit/,'').replace(/^Arrow/,'')].filter(Boolean).join('+')).canonical}
// Both manual shortcut entry and the recorder use the same editable fields.
const shortcutField = '#color-key, .binding-key';
let editingShortcut = false;
let capturedCode = null;
function setEditingShortcut(editing){
 if(!editing) capturedCode = null;
 if(editingShortcut === editing)return;
 editingShortcut = editing;
 invoke('editing-shortcut', editing);
}
document.addEventListener('focusin', e=>setEditingShortcut(e.target.matches(shortcutField)));
document.addEventListener('focusout', e=>{
 if(e.target.matches(shortcutField))setEditingShortcut(false);
});
window.addEventListener('blur', ()=>setEditingShortcut(false));
window.addEventListener('focus', ()=>setEditingShortcut(document.activeElement?.matches(shortcutField) === true));
window.addEventListener('pagehide', ()=>setEditingShortcut(false));
// Wait for keyup so the native listener cannot fire the shortcut being assigned.
document.addEventListener('keydown', e=>{
 if(capturedCode && e.target.matches(shortcutField)){
  e.preventDefault();e.stopImmediatePropagation();
 }
}, true);
document.addEventListener('keyup', e=>{
 if(e.code === capturedCode && e.target.matches(shortcutField)){
  e.target.blur();
 }
}, true);
function recordColor(){recordingColor=true;$('color-key').focus();$('color-key').select();$('color-key-help').textContent='Натисни нову клавішу або комбінацію. Escape — скасувати.'}
$('record-color-key').onclick=recordColor;
$('color-key').onkeydown=async e=>{
 if(!recordingColor){if(e.key==='Enter'){e.preventDefault();await saveColorKey()}return}
 e.preventDefault();e.stopPropagation();if(e.key==='Escape'){capturedCode=e.code;recordingColor=false;$('color-key').value=prefs.colorKeys[editorIndex];$('color-key-help').textContent='Лише під час малювання. Зміни зберігаються одразу.';return}if(['Control','Alt','Shift','Meta'].includes(e.key))return;
 try{$('color-key').value=eventKey(e);capturedCode=e.code;recordingColor=false;await saveColorKey()}catch(err){$('color-error').textContent=err.message}
};
$('color-key').onblur=()=>{if(recordingColor){recordingColor=false;$('color-key-help').textContent='Лише під час малювання. Зміни зберігаються одразу.'}};
$('color-key').onchange=()=>{if(!recordingColor)saveColorKey()};
async function saveColorKey(){try{const raw=$('color-key').value.trim(),keys=[...prefs.colorKeys];keys[editorIndex]=raw?parseKey(raw).canonical:'';const p=await invoke('save-settings',{colorKeys:keys});if(p){$('color-key').value=p.colorKeys[editorIndex];$('color-error').textContent='';$('color-key-help').textContent='Збережено. Працює лише під час малювання.'}}catch(e){$('color-error').textContent=e.message}}
function bindingRow(binding={key:'',scope:'session',actions:['toggle-drawing']}){
 const row=document.createElement('fieldset');row.className='binding';const top=document.createElement('div');top.className='binding-top';const input=document.createElement('input');input.className='binding-key';input.value=binding.key;input.placeholder='Клавіша';input.setAttribute('aria-label','Клавіша або комбінація');
 const capture=document.createElement('button');capture.type='button';capture.title='Записати клавішу';capture.append(icon('keyboard'));let recording=false;capture.onclick=()=>{recording=true;input.placeholder='Натисни клавішу';input.focus();input.select()};
 input.onkeydown=e=>{if(!recording)return;e.preventDefault();e.stopPropagation();if(['Control','Alt','Shift','Meta'].includes(e.key))return;try{input.value=eventKey(e);capturedCode=e.code;recording=false;input.placeholder='Клавіша'}catch(err){$('saved').textContent=err.message}};input.onblur=()=>{recording=false;input.placeholder='Клавіша'};
 const scope=document.createElement('select');scope.setAttribute('aria-label','Коли працює хоткей');for(const [v,l] of [['session','У сесії'],['drawing','Під час малювання']]){const opt=document.createElement('option');opt.value=v;opt.textContent=l;scope.append(opt)}scope.value=binding.scope;
 const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title='Видалити хоткей';remove.onclick=()=>row.remove();top.append(input,capture,scope,remove);
 const checks=document.createElement('div');checks.className='binding-actions';for(const [action,label] of Object.entries(labels)){const l=document.createElement('label');l.className='check';const c=document.createElement('input');c.type='checkbox';c.value=action;c.checked=binding.actions.includes(action);l.append(c,document.createTextNode(label));checks.append(l)}row.append(top,checks);$('bindings').append(row);
}
function form(p){$('hotkeys').checked=p.hotkeysEnabled;$('digits').checked=p.digitColors;$('auto-connect').checked=p.autoConnect;$('url').value=p.url;$('display').value=p.displayId;$('manual').checked=p.manual;$('region').hidden=!p.manual;for(const k of ['x','y','width','height'])$(k).value=p.region[k];$('bindings').replaceChildren();p.bindings.forEach(bindingRow)}
function openSettings(){if($('color-editor').matches(':popover-open'))$('color-editor').hidePopover();form(prefs);$('saved').textContent='';$('settings-dialog').showModal()}
$('open-settings').onclick=$('open-hotkeys').onclick=openSettings;$('close-settings').onclick=()=>$('settings-dialog').close();
$('manual').onchange=()=>{$('region').hidden=!$('manual').checked};$('display').onchange=()=>{const d=displays.find(d=>d.id===Number($('display').value));if(d){$('x').value=$('y').value=0;$('width').value=d.width;$('height').value=d.height}};
$('add-binding').onclick=()=>{if($('bindings').children.length<16)bindingRow();else $('saved').textContent='Можна додати до 16 хоткеїв.'};
$('settings').onsubmit=async e=>{e.preventDefault();const p=await invoke('save-settings',{hotkeysEnabled:$('hotkeys').checked,digitColors:$('digits').checked,autoConnect:$('auto-connect').checked,url:$('url').value.trim(),displayId:Number($('display').value),manual:$('manual').checked,region:Object.fromEntries(['x','y','width','height'].map(k=>[k,Number($(k).value)])),bindings:[...$('bindings').children].map(row=>({key:row.querySelector('.binding-key').value,scope:row.querySelector('select').value,actions:[...row.querySelectorAll('input:checked')].map(c=>c.value)}))});if(p){form(p);$('saved').textContent='Збережено.'}};
for(const [id,command] of [['connect','connect'],['disconnect','disconnect'],['draw','draw'],['clear','clear-own'],['others','toggle-others'],['toggle-overlay','toggle-overlay'],['start-server','start-server'],['stop-server','stop-server']])$(id).onclick=()=>invoke(command);
$('pen').onclick=()=>invoke('save-settings',{tool:'pen'});$('pointer').onclick=()=>invoke('save-settings',{tool:'pointer'});$('ttl').onchange=()=>invoke('save-settings',{ttl:Number($('ttl').value)});
 $('question').onclick=async()=>{await invoke('save-settings',{tool:'question'});if(!state.drawing)await invoke('draw');};
window.ink.on('state',update);window.ink.on('preferences',brush);
const initial=await invoke('init');if(initial){platform=initial.platform;displays=initial.displays;for(const d of displays){const o=document.createElement('option');o.value=d.id;o.textContent=`${d.label} · ${d.width} × ${d.height}`;$('display').append(o)}state=initial.state;brush(initial.preferences)}
