import test from 'node:test';
import assert from 'node:assert/strict';
import { containRect, normalizePoint, validEvent, validRegion } from '../../frontend/lib/protocol.mjs';
import { InkStore } from '../../frontend/lib/ink-store.mjs';
test('a 16:9 stream on an ultrawide screen excludes pillarboxes', () => {
  const r = containRect({x:0,y:0,width:3440,height:1440},16/9);
  assert.deepEqual(r,{x:440,y:0,width:2560,height:1440});
  assert.equal(normalizePoint(100,500,r),null);
  assert.deepEqual(normalizePoint(1720,720,r),[0.5,0.5]);
});
test('a 4:3 stream on 1080p excludes sidebars and maps corners exactly', () => {
  const r=containRect({x:0,y:0,width:1920,height:1080},4/3);
  assert.deepEqual(normalizePoint(240,0,r),[0,0]);
  assert.deepEqual(normalizePoint(1680,1080,r),[1,1]);
});
test('manual region offsets and DPI-independent coordinates', () => {
  assert.deepEqual(normalizePoint(500,350,{x:100,y:50,width:800,height:600}),[0.5,0.5]);
  assert.equal(validRegion({x:-1,y:0,width:100,height:100}),false);
});
test('network validation rejects malformed and unbounded drawing data', () => {
  assert.equal(validEvent({type:'points',id:'s',points:[[Infinity,0]]}),false);
  assert.equal(validEvent({type:'points',id:'s',points:[[1.01,0]]}),false);
  assert.equal(validEvent({type:'points',id:'s',points:Array(65).fill([0,0])}),false);
  assert.equal(validEvent({type:'start',id:'s',points:[[0,0]],color:'red',width:.003,ttl:0}),false);
});
test('strokes expire after completion, persistent strokes survive, clear removes all', () => {
  const store=new InkStore();
  const start=(id,ttl)=>({type:'start',id,points:[[.5,.5]],color:'#ffffff',width:.003,ttl});
  store.apply(start('a',2000),0);store.apply({type:'end',id:'a'},1000);
  store.apply(start('b',0),0);store.apply({type:'end',id:'b'},1000);
  assert.equal([...store.visible(2999)].length,2);
  assert.equal([...store.visible(3000)].length,1);
  assert.equal([...store.visible(99999)].length,1);
  store.apply({type:'clear'},100000);assert.equal(store.strokes.size,0);
});
test('orphan segments, duplicate starts and abandoned strokes are bounded', () => {
  const s=new InkStore();s.apply({type:'points',id:'missing',points:[[0,0]]},0);assert.equal(s.strokes.size,0);
  const e={type:'start',id:'a',points:[[0,0]],color:'#ffffff',width:.003,ttl:0};
  s.apply(e,0);s.apply(e,100);assert.equal(s.strokes.size,1);
  assert.equal([...s.visible(16000)].length,0);
});
