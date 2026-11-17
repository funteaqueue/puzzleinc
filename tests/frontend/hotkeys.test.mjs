import test from 'node:test';
import assert from 'node:assert/strict';
import { HotkeyEdges, DEFAULT_BINDINGS, parseKey, validateBindings } from '../../frontend/lib/hotkeys.mjs';
import { InkStore } from '../../frontend/lib/ink-store.mjs';
import { migrateQuestionScope } from '../../frontend/lib/question-ping.mjs';
function setup(extra={}){const e=new HotkeyEdges(),options={bindings:DEFAULT_BINDINGS,enabled:true,drawing:false,digits:true,suspended:false,...extra};const sample=(keys=[],patch={})=>e.sample(new Set(keys),{...options,...patch});sample();return sample}
test('Caps Lock executes both actions once per physical press, without repeats',()=>{const s=setup();assert.deepEqual(s(['CapsLock']),['clear-own','toggle-drawing']);assert.deepEqual(s(['CapsLock']),[]);s();assert.deepEqual(s(['CapsLock']),['clear-own','toggle-drawing'])});
test('modifiers must match exactly and changing them while holding a key does not fire',()=>{const s=setup();assert.deepEqual(s(['D']),[]);assert.deepEqual(s(['Control','Alt','D']),[]);s(['Control','Alt']);assert.deepEqual(s(['Control','Alt','D']),['toggle-drawing']);s();assert.deepEqual(s(['Control','Alt','Shift','D']),[])});
test('digits work only in drawing mode without modifiers, suspension swallows no keys and prevents delayed actions',()=>{const s=setup();assert.deepEqual(s(['1']),[]);s();assert.deepEqual(s(['1'],{drawing:true}),['color-1']);s();assert.deepEqual(s(['2','Control'],{drawing:true}),[]);s();assert.deepEqual(s(['CapsLock'],{suspended:true}),[]);assert.deepEqual(s(['CapsLock']),[]);s();assert.deepEqual(s(['CapsLock'],{enabled:false}),[])});
test('custom bindings merge actions on the same key in deterministic order and honor scope',()=>{const bindings=validateBindings([{key:'F8',scope:'session',actions:['toggle-drawing','clear-own']},{key:'F8',scope:'drawing',actions:['clear-own','toggle-others']}]);const s=setup({bindings});assert.deepEqual(s(['F8']),['clear-own','toggle-drawing']);s();assert.deepEqual(s(['F8'],{drawing:true}),['clear-own','toggle-others','toggle-drawing'])});
test('binding parsing rejects unsupported, modifier-only and duplicate keys',()=>{assert.equal(parseKey('alt + ctrl + d').canonical,'Control+Alt+D');assert.equal(parseKey('Caps Lock').key,'CapsLock');for(const k of ['Ctrl','Ctrl+Ctrl+D','Meta','Cmd+Meta+A','A+B','F13',''])assert.throws(()=>parseKey(k));assert.throws(()=>validateBindings([{key:'F1',scope:'session',actions:[]}]))});
test('initial sampling while held never triggers',()=>{const e=new HotkeyEdges();assert.deepEqual(e.sample(new Set(['CapsLock']),{enabled:true,bindings:DEFAULT_BINDINGS}),[])});
test('G pings on a fresh press during drawing in new and upgraded profiles',()=>{
 const legacy={key:'G',scope:'session',actions:['question-ping']};
 for(const bindings of [DEFAULT_BINDINGS,migrateQuestionScope([legacy])]){
  const sample=setup({bindings});
  assert.deepEqual(sample(['G']),[]);
  assert.deepEqual(sample(['G'],{drawing:true}),[]);
  sample();
  assert.deepEqual(sample(['G'],{drawing:true}),['question-ping']);
  sample();
  assert.deepEqual(sample(['G']),[]);
 }
 const custom=[{...legacy,key:'Control+G'},{...legacy,key:'H'},{...legacy,actions:['clear-own']}];
 assert.deepEqual(migrateQuestionScope(custom),custom);
});
test('selective clearing removes one author and preserves every other author',()=>{const s=new InkStore(),a='a'.repeat(24),b='b'.repeat(24);for(const id of [a+'-1',a+'-2',b+'-1'])s.apply({type:'start',id,points:[[0,0]],color:'#ffffff',width:.003,ttl:0},0);s.apply({type:'clear-author',author:a},1);assert.deepEqual([...s.strokes.keys()],[b+'-1'])});
