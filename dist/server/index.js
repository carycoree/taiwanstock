const FUGLE_BASE = "https://api.fugle.tw/marketdata/v1.0/stock";
const TWSE_BASE = "https://www.twse.com.tw/rwd/zh";
const TWSE_OPEN = "https://openapi.twse.com.tw/v1/opendata";
const TPEX_OPEN = "https://www.tpex.org.tw/openapi/v1";
let masterCache={at:0,rows:[]};

const fallbackSymbols = [
  ["0050","元大台灣50","ETF"],["0056","元大高股息","ETF"],["006208","富邦台50","ETF"],
  ["00878","國泰永續高股息","ETF"],["00919","群益台灣精選高息","ETF"],["00929","復華台灣科技優息","ETF"],
  ["1101","台泥","水泥"],["1301","台塑","塑膠"],
  ["2002","中鋼","鋼鐵"],["2303","聯電","半導體"],["2308","台達電","電子零組件"],
  ["2317","鴻海","電子零組件"],["2330","台積電","半導體"],["2379","瑞昱","半導體"],
  ["2382","廣達","電腦及週邊"],["2408","南亞科","半導體"],["2454","聯發科","半導體"],
  ["2881","富邦金","金融"],["2882","國泰金","金融"],["2891","中信金","金融"],
  ["3008","大立光","光電"],["3711","日月光投控","半導體"],["6505","台塑化","油電燃氣"]
].map(([symbol,name,industry])=>({symbol,name,industry,exchange:"TWSE"}));

const json = (data, status=200, headers={}) => new Response(JSON.stringify(data), {
  status, headers: {"content-type":"application/json; charset=utf-8","cache-control":"no-store",...headers}
});

const taipeiNow = () => new Intl.DateTimeFormat("sv-SE", {
  timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",
  hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false
}).format(new Date());

async function fugle(env, path) {
  if (!env.FUGLE_API_KEY) throw new Error("FUGLE_API_KEY_MISSING");
  const response = await fetch(`${FUGLE_BASE}${path}`, {
    headers: {"X-API-KEY": env.FUGLE_API_KEY, accept:"application/json"}
  });
  if (!response.ok) throw new Error(`FUGLE_${response.status}`);
  return response.json();
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      headers:{accept:"application/json","user-agent":"TaiwanStockIntelligence/1.0"},
      signal:controller.signal
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return response.json();
  } finally { clearTimeout(timeout); }
}

const number = value => Number(String(value ?? "").replace(/,/g,"").replace(/--/g,"")) || 0;
const isoFromRoc = value => {
  const m=String(value||"").match(/(\d{2,3})\/(\d{1,2})\/(\d{1,2})/);
  return m ? `${Number(m[1])+1911}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}` : value;
};
const dateKey = date => date.toISOString().slice(0,10).replaceAll("-","");
const dateCandidates = (count=8) => Array.from({length:count},(_,i)=>new Date(Date.now()-i*86400000));
const fieldIndex = (fields, patterns) => fields.findIndex(f=>patterns.some(p=>p.test(String(f))));
const findTableRow = (payload, symbol) => {
  for(const table of payload?.tables||[payload]){
    const fields=table?.fields||payload?.fields||[], rows=table?.data||payload?.data||[];
    const symbolIndex=Math.max(0,fieldIndex(fields,[/證券代號/,/股票代號/,/代號/]));
    const row=rows.find(x=>String(x[symbolIndex]||"").trim()===symbol);
    if(row)return{fields,row};
  }
  return null;
};

async function twseDaily(symbol) {
  const months=Array.from({length:6},(_,i)=>{const d=new Date();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-i);return dateKey(d)});
  const results=await Promise.all(months.map(async date=>{
    try{
      const raw=await fetchJson(`${TWSE_BASE}/afterTrading/STOCK_DAY?date=${date}&stockNo=${encodeURIComponent(symbol)}&response=json`);
      return (raw?.data||[]).map(x=>({date:isoFromRoc(x[0]),volume:number(x[1]),open:number(x[3]),high:number(x[4]),low:number(x[5]),close:number(x[6])}));
    }catch{return[]}
  }));
  return results.flat().filter(x=>x.date&&x.close).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
}

async function latestOfficial(path, symbol, parser, selectType="ALL") {
  for(const date of dateCandidates()){
    try{
      const raw=await fetchJson(`${TWSE_BASE}/${path}?date=${dateKey(date)}&selectType=${selectType}&response=json`);
      const found=findTableRow(raw,symbol);
      if(found)return parser(found.fields,found.row,dateKey(date));
    }catch{}
  }
  return null;
}

async function officialPayload(symbol) {
  const institutional=latestOfficial("fund/T86",symbol,(f,r,date)=>{
    const pick=p=>number(r[fieldIndex(f,p)]);
    return {date,foreign:pick([/外陸資買賣超股數.*不含外資自營商/,/外資及陸資.*買賣超/]),trust:pick([/投信買賣超/]),dealer:pick([/自營商買賣超/,/自營商.*合計/]),total:pick([/三大法人買賣超/]),source:"臺灣證券交易所"};
  },"ALLBUT0999");
  const margin=latestOfficial("marginTrading/MI_MARGN",symbol,(f,r,date)=>{
    const pick=p=>number(r[fieldIndex(f,p)]);
    return {date,marginBalance:pick([/融資.*今日餘額/,/融資餘額/]),shortBalance:pick([/融券.*今日餘額/,/融券餘額/]),source:"臺灣證券交易所"};
  });
  const revenue=(async()=>{
    try{
      const list=await fetchJson(`${TWSE_OPEN}/t187ap05_L`);
      const row=(Array.isArray(list)?list:[]).find(x=>String(x["公司代號"]||x["公司代碼"]||"").trim()===symbol);
      if(!row)return null;
      return {period:row["資料年月"]||row["出表日期"]||"",monthly:number(row["當月營收"]),yoy:number(row["去年同月增減(%)"]||row["去年同月增減％"]),mom:number(row["上月比較增減(%)"]||row["上月比較增減％"]),source:"公開資訊觀測站／TWSE OpenAPI"};
    }catch{return null}
  })();
  const [institutionData,marginData,revenueData]=await Promise.all([institutional,margin,revenue]);
  return {
    institutional:institutionData,margin:marginData,revenue:revenueData,
    links:[
      {label:"證交所基本市況",url:`https://mis.twse.com.tw/stock/fibest.jsp?stock=${symbol}`,provider:"TWSE"},
      {label:"公開資訊觀測站",url:"https://mops.twse.com.tw/mops/web/index",provider:"MOPS"},
      {label:"Yahoo 股市新聞",url:`https://tw.stock.yahoo.com/quote/${symbol}.TW/news`,provider:"Yahoo"}
    ]
  };
}

async function stockMaster(){
  if(Date.now()-masterCache.at<3600000&&masterCache.rows.length)return masterCache.rows;
  const [listed,otc]=await Promise.all([
    fetchJson(`${TWSE_OPEN}/t187ap03_L`).catch(()=>[]),
    fetchJson(`${TPEX_OPEN}/mopsfin_t187ap03_O`).catch(()=>[])
  ]);
  const normalize=(x,exchange)=>({
    symbol:String(x["公司代號"]||x["公司代碼"]||x["SecuritiesCompanyCode"]||"").trim(),
    name:String(x["公司簡稱"]||x["公司名稱"]||x["CompanyName"]||"").trim(),
    industry:String(x["產業別"]||x["產業類別"]||x["SecuritiesIndustryCode"]||"其他").trim(),
    exchange
  });
  const official=[...(Array.isArray(listed)?listed:[]).map(x=>normalize(x,"TWSE")),...(Array.isArray(otc)?otc:[]).map(x=>normalize(x,"TPEx"))].filter(x=>/^\d{4,6}$/.test(x.symbol)&&x.name);
  // 公司基本資料不包含多數 ETF；固定合併保底清單，避免官方端點正常時反而找不到 0050 等商品。
  const merged=new Map(fallbackSymbols.map(x=>[x.symbol,x]));
  official.forEach(x=>merged.set(x.symbol,x));
  const rows=[...merged.values()];
  masterCache={at:Date.now(),rows};return masterCache.rows;
}

async function marketPayload(){
  for(const date of dateCandidates()){
    try{
      const raw=await fetchJson(`${TWSE_BASE}/afterTrading/MI_INDEX?date=${dateKey(date)}&type=ALLBUT0999&response=json`);
      if(raw?.stat!=="OK"&&!raw?.tables?.length)continue;
      let index=null,breadth={up:0,down:0,flat:0},stocks=[],sectors=[];
      for(const table of raw.tables||[]){
        const f=table.fields||[],d=table.data||[];
        const code=fieldIndex(f,[/證券代號/]),name=fieldIndex(f,[/證券名稱/]),close=fieldIndex(f,[/收盤價/]),diff=fieldIndex(f,[/漲跌價差/]),sign=fieldIndex(f,[/漲跌\(\+\/-\)/]),volume=fieldIndex(f,[/成交股數/]),value=fieldIndex(f,[/成交金額/]);
        if(code>=0&&close>=0)stocks=d.map(r=>{const c=number(r[close]),delta=number(r[diff])*(String(r[sign]||"").includes("-")?-1:1),prev=c-delta;return{symbol:String(r[code]).trim(),name:String(r[name]||"").trim(),close:c,change:delta,changePercent:prev?delta/prev*100:0,volume:number(r[volume]),value:number(r[value])}}).filter(x=>x.symbol&&x.close);
        const idxName=fieldIndex(f,[/^指數$/, /指數名稱/]),idxClose=fieldIndex(f,[/收盤指數/]),idxDiff=fieldIndex(f,[/漲跌點數/]),idxPct=fieldIndex(f,[/漲跌百分比/]),idxSign=fieldIndex(f,[/漲跌\(\+\/-\)/]);
        if(idxName>=0){
          const row=d.find(r=>String(r[idxName]).includes("發行量加權股價指數"));
          if(row){const dir=String(row[idxSign]||"").includes("-")?-1:1;index={name:"TAIEX",close:number(row[idxClose]),change:Math.abs(number(row[idxDiff]))*dir,changePercent:Math.abs(number(row[idxPct]))*dir}}
          sectors=d.map(r=>{const dir=String(r[idxSign]||"").includes("-")?-1:1;return{name:String(r[idxName]||"").replace(/類指數.*$/,"類"),changePercent:Math.abs(number(r[idxPct]))*dir}}).filter(x=>x.name.endsWith("類")&&Number.isFinite(x.changePercent)).sort((a,b)=>b.changePercent-a.changePercent).slice(0,12);
        }
        for(const r of d){
          const label=String(r[0]||"").trim(),match=r.slice(1).join(" ").match(/[\d,]+/),count=match?number(match[0]):0;
          if(label.startsWith("上漲"))breadth.up=Math.max(breadth.up,count);
          if(label.startsWith("下跌"))breadth.down=Math.max(breadth.down,count);
          if(label.startsWith("持平")||label.startsWith("未成交"))breadth.flat+=count;
        }
      }
      let institutional={buys:[],sells:[]};
      try{
        const inst=await fetchJson(`${TWSE_BASE}/fund/T86?date=${dateKey(date)}&selectType=ALLBUT0999&response=json`),table=(inst.tables||[]).find(t=>fieldIndex(t.fields||[],[/證券代號/])>=0);
        if(table){const f=table.fields||[],ci=fieldIndex(f,[/證券代號/]),ni=fieldIndex(f,[/證券名稱/]),ti=fieldIndex(f,[/三大法人買賣超/,/合計買賣超/]);const rows=(table.data||[]).map(r=>({symbol:String(r[ci]||"").trim(),name:String(r[ni]||"").trim(),net:number(r[ti])})).filter(x=>x.symbol&&x.net);institutional={buys:[...rows].sort((a,b)=>b.net-a.net).slice(0,5),sells:[...rows].sort((a,b)=>a.net-b.net).slice(0,5)}}
      }catch{}
      const turnover=stocks.reduce((sum,x)=>sum+x.value,0),volume=stocks.reduce((sum,x)=>sum+x.volume,0),maxVolume=Math.max(...stocks.map(x=>x.volume),1);
      const aiPicks=stocks.filter(x=>x.changePercent>0&&x.volume>0).map(x=>{const momentum=Math.min(40,x.changePercent*4),liquidity=Math.min(30,Math.log10(x.volume+1)/Math.log10(maxVolume+1)*30),score=Math.round(30+momentum+liquidity);return{symbol:x.symbol,name:x.name,close:x.close,changePercent:x.changePercent,volume:x.volume,score:Math.min(99,score),signal:x.changePercent>=7?"強勢動能":x.changePercent>=3?"量價轉強":"相對強勢"}}).sort((a,b)=>b.score-a.score||b.changePercent-a.changePercent).slice(0,6);
      return{status:"ok",date:dateKey(date),index,breadth,sectors,liquidity:{turnover,volume,listed:stocks.length},institutional,aiPicks,movers:[...stocks].sort((a,b)=>b.changePercent-a.changePercent).slice(0,8),laggards:[...stocks].sort((a,b)=>a.changePercent-b.changePercent).slice(0,5),total:stocks.length,source:"臺灣證券交易所"};
    }catch{}
  }
  return{status:"unavailable",date:null,index:null,breadth:{up:0,down:0,flat:0},sectors:[],liquidity:null,institutional:{buys:[],sells:[]},aiPicks:[],movers:[],laggards:[],source:"臺灣證券交易所"};
}

async function cached(request, seconds, loader) {
  const cache = caches.default;
  const cachedResponse = await cache.match(request);
  if (cachedResponse) return cachedResponse;
  const response = await loader();
  if (response.ok) {
    const copy = new Response(response.body, response);
    copy.headers.set("cache-control", `public, max-age=${seconds}`);
    await cache.put(request, copy.clone());
    return copy;
  }
  return response;
}

const normalizeQuote = (raw, symbol) => {
  const d = raw?.data || raw || {};
  const last = Number(d.lastPrice ?? d.closePrice ?? d.close ?? 0);
  const previous = Number(d.previousClose ?? d.previousClosePrice ?? d.referencePrice ?? 0);
  return {
    symbol, name:d.name || (symbol==="2330"?"台積電":symbol),
    lastPrice:last, previousClose:previous,
    change:Number(d.change ?? (last && previous ? last-previous : 0)),
    changePercent:Number(d.changePercent ?? (last && previous ? (last-previous)/previous*100 : 0)),
    openPrice:Number(d.openPrice ?? d.open ?? 0), highPrice:Number(d.highPrice ?? d.high ?? 0),
    lowPrice:Number(d.lowPrice ?? d.low ?? 0), totalVolume:Number(d.total?.tradeVolume ?? d.totalVolume ?? d.volume ?? 0),
    totalValue:Number(d.total?.tradeValue ?? d.totalValue ?? 0),
    lastUpdated:d.lastUpdated || d.lastUpdate || new Date().toISOString(),
    isClose:Boolean(d.isClose), source:"Fugle MarketData"
  };
};

const normalizeCandles = raw => (raw?.data || raw || []).map(x=>({
  date:x.date || x.time || x.timestamp, open:Number(x.open), high:Number(x.high),
  low:Number(x.low), close:Number(x.close), volume:Number(x.volume || 0)
})).filter(x=>x.date && Number.isFinite(x.close));

async function stockPayload(env, symbol) {
  const to = new Date().toISOString().slice(0,10);
  const fromDate = new Date(Date.now()-1000*60*60*24*180).toISOString().slice(0,10);
  const officialPromise=officialPayload(symbol);
  let quote=null,candles=[],error=null;
  try {
    const [quoteRaw,candleRaw]=await Promise.all([
      fugle(env,`/intraday/quote/${encodeURIComponent(symbol)}`),
      fugle(env,`/historical/candles/${encodeURIComponent(symbol)}?from=${fromDate}&to=${to}&timeframe=D`)
    ]);
    quote=normalizeQuote(quoteRaw,symbol);candles=normalizeCandles(candleRaw);
  } catch(e){error=String(e.message||e)}
  if(!candles.length)candles=await twseDaily(symbol);
  const official=await officialPromise;
  const hasOfficial=Boolean(candles.length||official.institutional||official.margin||official.revenue);
  return {
    status:quote?"live":hasOfficial?"official_only":error==="FUGLE_API_KEY_MISSING"?"not_configured":"error",
    provider:quote?"Fugle MarketData + TWSE":"TWSE／MOPS 公開資料",
    fetchedAt:new Date().toISOString(),taipeiTime:taipeiNow(),quote,candles,official,error,
    sources:[
      {label:"即時行情",provider:"Fugle MarketData",state:quote?"live":"unavailable",updatedAt:quote?.lastUpdated},
      {label:"歷史日線",provider:candles.length&&quote?"Fugle MarketData":"臺灣證券交易所",state:candles.length?"available":"unavailable",updatedAt:candles.at(-1)?.date},
      {label:"三大法人／融資融券",provider:"臺灣證券交易所",state:official.institutional||official.margin?"available":"unavailable"},
      {label:"月營收",provider:"公開資訊觀測站／TWSE OpenAPI",state:official.revenue?"available":"unavailable"}
    ]
  };
}

async function api(request, env, url) {
  if (url.pathname === "/api/health") return json({
    ok:true, provider:"Fugle MarketData", configured:Boolean(env.FUGLE_API_KEY),
    serverTime:new Date().toISOString(), taipeiTime:taipeiNow()
  });
  if (url.pathname === "/api/search") {
    const q=(url.searchParams.get("q")||"").trim().toLowerCase();
    const master=await stockMaster();
    const results=master.filter(x=>!q||x.symbol.includes(q)||x.name.toLowerCase().includes(q)).slice(0,12);
    return json({status:"ok",results,source:"TWSE／TPEx 股票主檔",updatedAt:new Date().toISOString()});
  }
  if(url.pathname==="/api/market")return cached(request,300,async()=>json(await marketPayload()));
  const match=url.pathname.match(/^\/api\/stock\/(\d{4,6})$/);
  if (match) return cached(request, 300, async()=>json(await stockPayload(env,match[1])));
  await env.ASSETS.fetch(request);
  return json({error:"NOT_FOUND"},404);
}

export default {
  async fetch(request, env) {
    const url=new URL(request.url);
    if(url.pathname.startsWith("/api/")) return api(request,env,url);
    const response=await env.ASSETS.fetch(request);
    const acceptsHtml=request.headers.get("accept")?.includes("text/html");
    if(response.status!==404||!acceptsHtml||!["GET","HEAD"].includes(request.method)) return response;
    const indexUrl=new URL(request.url);indexUrl.pathname="/index.html";indexUrl.search="";
    return env.ASSETS.fetch(new Request(indexUrl,request));
  }
};
