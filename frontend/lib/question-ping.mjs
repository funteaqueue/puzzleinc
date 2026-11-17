import {AUTHOR_PATTERN,validEvent} from './protocol.mjs';
import {QUESTION_PING_ART} from './question-ping-art.mjs';

// Protocol 4 only: ordinary start/end strokes let unmodified clients draw the
// complete symbol, fade it, hide it and clear it using their existing code.
export function questionPing({point,aspect,author,id}){
 if(!AUTHOR_PATTERN.test(author)||typeof id!=='string'||!/^[a-zA-Z0-9-]{1,32}$/.test(id)||!Array.isArray(point)||point.length!==2||point.some(n=>!Number.isFinite(n)||n<0||n>1)||!Number.isFinite(aspect)||aspect<.2||aspect>8)return [];
 const size=.08,padding=size*.51;
 const cx=Math.max(padding/aspect,Math.min(1-padding/aspect,point[0])),cy=Math.max(padding,Math.min(1-padding,point[1]));
 const events=QUESTION_PING_ART.flatMap((layer,i)=>{
  const strokeId=`${author}-${id}-${i}`,points=layer.points.map(([x,y])=>[cx+x*size/aspect,cy+y*size]);
  const events=[{type:'start',id:strokeId,undoGroup:id,points:points.slice(0,64),color:layer.color,width:layer.width*size,ttl:2000}];
  for(let offset=64;offset<points.length;offset+=64)events.push({type:'points',id:strokeId,points:points.slice(offset,offset+64)});
  events.push({type:'end',id:strokeId});return events;
 });
 return events.every(validEvent)?events:[];
}
export function migrateQuestionScope(bindings){
 return bindings.map(binding=>binding.key==='G' && binding.scope==='session' && binding.actions.includes('question-ping')
  ? {...binding,scope:'drawing'} : binding);
}
