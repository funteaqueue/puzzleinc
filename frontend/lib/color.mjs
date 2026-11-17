export function hexToHsv(hex){
 const rgb=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255),[r,g,b]=rgb,max=Math.max(...rgb),min=Math.min(...rgb),delta=max-min;
 let h=0;if(delta)h=max===r?((g-b)/delta)%6:max===g?(b-r)/delta+2:(r-g)/delta+4;
 return {h:(h*60+360)%360,s:max?delta/max:0,v:max};
}
export function hsvToHex({h,s,v}){
 const c=v*s,x=c*(1-Math.abs(((h%360)/60)%2-1)),m=v-c;
 const rgb=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
 return '#'+rgb.map(n=>Math.round((n+m)*255).toString(16).padStart(2,'0')).join('');
}
