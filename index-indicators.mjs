export function indexIndicators(candles){
 let ema,fast,slow,gain=0,loss=0;
 return candles.map((x,i)=>{
  const p=x.close,delta=i?p-candles[i-1].close:0;
  ema=i?p*2/21+ema*19/21:p;fast=i?p*2/13+fast*11/13:p;slow=i?p*2/27+slow*25/27:p;
  if(i<=14){gain+=Math.max(delta,0)/14;loss+=Math.max(-delta,0)/14}else{gain=(gain*13+Math.max(delta,0))/14;loss=(loss*13+Math.max(-delta,0))/14}
  return {...x,t:x.time.slice(5),ma:i<19?null:candles.slice(i-19,i+1).reduce((sum,r)=>sum+r.close,0)/20,ema:i<19?null:ema,macd:i<25?null:fast-slow,rsi:i<14?null:loss===0?(gain===0?50:100):100-100/(1+gain/loss)};
 });
}
