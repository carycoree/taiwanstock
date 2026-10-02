// TWSE company industry codes. A company classification is not an index weight.
const groups = {
  '水泥':['01'], '食品':['02'], '塑膠':['03'], '紡織纖維':['04'], '電機機械':['05'],
  '電器電纜':['06'], '化學生技醫療':['07','21','22'], '玻璃陶瓷':['08'], '造紙':['09'],
  '鋼鐵':['10'], '橡膠':['11'], '汽車':['12'], '電子':['13','24','25','26','27','28','29','30','31'],
  '建材營造':['14'], '航運':['15'], '觀光餐旅':['16'], '金融保險':['17'], '貿易百貨':['18'],
  '其他':['20'], '化學':['21'], '生技醫療':['22'], '油電燃氣':['23'], '半導體':['24'],
  '電腦及週邊設備':['25'], '光電':['26'], '通信網路':['27'], '電子零組件':['28'],
  '電子通路':['29'], '資訊服務':['30'], '其他電子':['31'], '文化創意':['32'],
  '農業科技':['33'], '電子商務':['34'], '綠能環保':['35'], '數位雲端':['36'], '運動休閒':['37'], '居家生活':['38']
};
export function sectorStocks(name, stocks, master) {
  const label = name.replace(/類(?:指數)?$/, '');
  const codes = groups[label==='電子工業'?'電子':label];
  if (!codes) return {supported:false, rows:[]};
  const members = new Map(master.filter(x=>x.exchange==='TWSE' && (codes.includes(x.industry.padStart(2,'0')) || x.industry===label)).map(x=>[x.symbol,x]));
  return {supported:true, rows:stocks.filter(x=>members.has(x.symbol)).map(x=>({...x,industry:members.get(x.symbol).industry})).sort((a,b)=>b.changePercent-a.changePercent||b.volume-a.volume)};
}

// Scores rank observed closing data, never predict returns. Composite sectors overlap.
export function sectorHeat(sectors, stocks, master) {
  const listed=new Set(master.filter(x=>x.exchange==='TWSE').map(x=>x.symbol));
  const marketValue=stocks.filter(x=>listed.has(x.symbol)).reduce((sum,x)=>sum+Math.max(0,Number(x.value)||0),0);
  return sectors.map(sector=>{
    const group=sectorStocks(sector.name,stocks,master);
    const rows=group.rows.filter(x=>Number.isFinite(x.changePercent)&&x.volume>0);
    const count=rows.length,up=rows.filter(x=>x.changePercent>0).length;
    const value=rows.reduce((sum,x)=>sum+Math.max(0,Number(x.value)||0),0);
    const upRatio=count?up/count*100:null,turnoverShare=marketValue>0?value/marketValue*100:null;
    const heatScore=count&&turnoverShare!==null&&Number.isFinite(sector.changePercent)?Math.round((upRatio/100*50+Math.max(0,Math.min(1,sector.changePercent/5))*30+Math.min(1,turnoverShare/20)*20)*10)/10:null;
    return {...sector,count,up,upRatio,turnoverShare,heatScore,supported:group.supported};
  }).sort((a,b)=>(b.heatScore??-1)-(a.heatScore??-1)||b.changePercent-a.changePercent);
}
