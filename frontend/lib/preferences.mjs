import { DEFAULT_BINDINGS, DEFAULT_PRESETS, DEFAULT_COLOR_KEYS, parseKey, validateBindings } from './hotkeys.mjs';
import { validRegion } from './protocol.mjs';
import { migrateQuestionScope } from './question-ping.mjs';
export function upgradeDrawingHotkeys(prefs){
 prefs.bindings=migrateQuestionScope(prefs.bindings);
 const occupied=prefs.bindings.some(b=>b.key==='Backspace'||b.actions.includes('undo-own'))||prefs.colorKeys.includes('Backspace');
 if(!occupied&&prefs.bindings.length<16)prefs.bindings.push({key:'Backspace',scope:'drawing',actions:['undo-own']});
}
export function serverAddress(value){const u=new URL(value);if(!['ws:','wss:'].includes(u.protocol)||u.username||u.password||u.hash)throw Error('Адреса має починатися з ws:// або wss://.');return u.href}
export function preferences(value, defaults){
 const p={...defaults,...value};p.url=serverAddress(p.url);
 if(!Array.isArray(p.presets)||p.presets.length!==9||p.presets.some(c=>!/^#[a-f0-9]{6}$/i.test(c)))throw Error('Потрібно дев’ять коректних кольорів.');
 if(!Number.isInteger(p.selectedPreset)||p.selectedPreset<0||p.selectedPreset>8)throw Error('Некоректний пресет.');
 if(![0,2000,5000,10000].includes(p.ttl)||!['pen','pointer','question'].includes(p.tool))throw Error('Некоректний інструмент.');
 if(p.manual&&!validRegion(p.region))throw Error('Некоректна область екрана.');
 if(!Array.isArray(p.colorKeys)||p.colorKeys.length!==9)throw Error('Потрібно дев’ять клавіш кольорів.');
 const colorKeys=p.colorKeys.map(k=>k===''?'':parseKey(k).canonical);
 if(new Set(colorKeys.filter(Boolean)).size!==colorKeys.filter(Boolean).length)throw Error('Кожному кольору потрібна окрема клавіша.');
 return {url:p.url,displayId:Number(p.displayId),manual:!!p.manual,region:p.region,tool:p.tool,ttl:p.ttl,presets:p.presets.slice(),selectedPreset:p.selectedPreset,bindings:validateBindings(p.bindings),colorKeys,overlayVisible:p.overlayVisible!==false,hotkeysEnabled:p.hotkeysEnabled!==false,digitColors:p.digitColors!==false,showOthers:p.showOthers!==false,autoConnect:p.autoConnect!==false};
}
export function defaults(url,display){return {url,displayId:display.id,manual:false,region:{x:0,y:0,width:display.bounds.width,height:display.bounds.height},tool:'pen',ttl:0,presets:[...DEFAULT_PRESETS],selectedPreset:0,bindings:structuredClone(DEFAULT_BINDINGS),colorKeys:[...DEFAULT_COLOR_KEYS],overlayVisible:true,hotkeysEnabled:true,digitColors:true,showOthers:true,autoConnect:true}}
