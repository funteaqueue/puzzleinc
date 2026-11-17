export const ACTIONS = ['clear-own','undo-own', 'toggle-others', 'toggle-drawing', 'toggle-overlay', 'question-ping'];
export const MODIFIERS = ['Control','Alt','Shift','Meta'];
export const DEFAULT_COLOR_KEYS = ['1','2','3','4','5','6','7','8','9'];
export const DEFAULT_PRESETS = ['#6ef0b5','#ff637d','#65b8ff','#ffd166','#c694ff','#ff994d','#ffffff','#ff66cc','#41d9d0'];
export const DEFAULT_BINDINGS = [
  { key: 'CapsLock', scope: 'session', actions: ['clear-own','toggle-drawing'] },
  { key: 'Control+Alt+D', scope: 'session', actions: ['toggle-drawing'] },
  { key: 'Control+Alt+X', scope: 'session', actions: ['clear-own'] },
  { key: 'Control+Alt+H', scope: 'session', actions: ['toggle-others'] },
  { key: 'F8', scope: 'session', actions: ['toggle-overlay'] },
  { key: 'G', scope: 'drawing', actions: ['question-ping'] },
  { key: 'Backspace', scope: 'drawing', actions: ['undo-own'] }
];
export function parseKey(value) {
  if (typeof value !== 'string' || value.length > 80) throw Error('Некоректна клавіша.');
  const parts=value.replace(/\s/g,'').split('+');
  const aliases={ctrl:'Control',control:'Control',alt:'Alt',shift:'Shift',capslock:'CapsLock',esc:'Escape',escape:'Escape',space:'Space',enter:'Enter',tab:'Tab',backspace:'Backspace',delete:'Delete',insert:'Insert',home:'Home',end:'End',pageup:'PageUp',pagedown:'PageDown',up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight'};
  const keys=parts.map(p=>aliases[p.toLowerCase()] || (/^[a-z0-9]$/i.test(p)?p.toUpperCase():/^f([1-9]|1[0-2])$/i.test(p)?p.toUpperCase():p));
  const normalized=keys.map(k=>/^(meta|cmd|command|super|win)$/i.test(k)?'Meta':k);
  keys.splice(0,keys.length,...normalized);
  const modifiers=MODIFIERS.filter(m=>keys.includes(m));
  const regular=keys.filter(k=>!modifiers.includes(k));
  if (regular.length!==1 || keys.length!==new Set(keys).size || !/^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|CapsLock|Escape|Space|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right))$/.test(regular[0])) throw Error('Оберіть одну клавішу, за потреби з Ctrl, Alt, Shift або Command / Win.');
  return {key:regular[0],modifiers,canonical:[...modifiers,regular[0]].join('+')};
}
export function validateBindings(bindings) {
  if(!Array.isArray(bindings)||bindings.length>16)throw Error('Можна задати до 16 хоткеїв.');
  return bindings.map(b=>{
    const key=parseKey(b.key).canonical;
    if(!['session','drawing'].includes(b.scope)||!Array.isArray(b.actions)||!b.actions.length||b.actions.some(a=>!ACTIONS.includes(a)))throw Error('Оберіть дію й область роботи хоткея.');
    return {key,scope:b.scope,actions:[...new Set(b.actions)]};
  });
}
// Only the transition from released to pressed triggers the action.
// No OS key registration, grabs, suppression, injection or input logging.
export class HotkeyEdges {
  previous = null;
  sample(down, { bindings, enabled, drawing, digits, suspended, colorKeys=DEFAULT_COLOR_KEYS }) {
    const before=this.previous; this.previous=new Set(down);
    if(!before||!enabled||suspended)return [];
    const actions=new Set();
    for(const b of bindings){
      const p=parseKey(b.key);
      if(b.scope==='drawing'&&!drawing)continue;
      if(down.has(p.key)&&!before.has(p.key)&&MODIFIERS.every(m=>down.has(m)===p.modifiers.includes(m)))for(const a of b.actions)actions.add(a);
    }
    if(drawing&&digits)colorKeys.forEach((key,i)=>{
      if(!key)return;const p=parseKey(key);
      if(down.has(p.key)&&!before.has(p.key)&&MODIFIERS.every(m=>down.has(m)===p.modifiers.includes(m)))actions.add('color-'+(i+1));
    });
    return [...ACTIONS.filter(a=>actions.has(a)),...[...actions].filter(a=>a.startsWith('color-'))];
  }
}
