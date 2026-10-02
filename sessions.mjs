export function tradingWindows(now=new Date()) {
  const local=new Date(now.getTime()+8*3600000),day=local.getUTCDay(),minutes=local.getUTCHours()*60+local.getUTCMinutes();
  const weekday=day>=1&&day<=5,previousWeekday=day>=2&&day<=6;
  const stock=weekday&&minutes>=540&&minutes<810?'現貨日盤時段':weekday&&minutes<540?'現貨開盤前':'現貨收盤時段';
  const futures=weekday&&minutes>=525&&minutes<825?'期貨日盤時段':(weekday&&minutes>=900)||(previousWeekday&&minutes<300)?'期貨夜盤時段':'期貨非交易時段';
  return {stock:!weekday?'現貨週末休市':stock,futures,estimated:true};
}
export function quoteState(quote,now=Date.now()) {
  if(!quote)return {label:'報價未連線',kind:'unavailable'};
  const raw=quote.lastUpdated;
  let ms=typeof raw==='number'||/^\d{13,16}$/.test(String(raw))?Number(raw):Date.parse(raw);
  if(ms>1e14)ms/=1000;
  if(!Number.isFinite(ms))return {label:'報價時間未提供',kind:'unknown'};
  if(quote.isClose)return {label:'收盤報價',kind:'close',asOf:ms};
  const age=now-ms;
  if(age < -10000)return {label:'報價時間異常',kind:'unknown',asOf:ms};
  if(age>90000)return {label:'報價逾時／延遲',kind:'stale',asOf:ms};
  return {label:'近期報價',kind:'fresh',asOf:ms};
}
export function normalizeNightReport(rows) {
  if(!Array.isArray(rows))return [];
  const number=v=>v==null||!String(v).trim()||/NULL|--|^-$/.test(String(v))?null:Number(String(v).replace(/[,%]/g,''));
  const latest=rows.filter(r=>['TX','MTX'].includes(r.Contract)&&r.TradingSession==='盤後'&&/^\d{6}$/.test(r['ContractMonth(Week)'])&&/^\d{8}$/.test(r.Date)).sort((a,b)=>b.Date.localeCompare(a.Date)||a['ContractMonth(Week)'].localeCompare(b['ContractMonth(Week)']));
  return ['TX','MTX'].map(contract=>{
    const r=latest.find(x=>x.Contract===contract);if(!r)return null;
    const last=number(r.Last);if(!Number.isFinite(last)||last<=0)return null;
    return {contract,name:contract==='TX'?'臺股期貨':'小型臺指期貨',month:r['ContractMonth(Week)'],date:r.Date,last,change:number(r.Change),changePercent:number(r['%']),volume:number(r.Volume),kind:'official_after_hours_report'};
  }).filter(Boolean);
}
