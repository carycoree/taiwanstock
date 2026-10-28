// Quote requests stay small; the saved watchlist has no application item cap.
export async function fetchWatchlistPrices(url,{signal}={},fetcher=fetch){
 const parsed=new URL(url,'https://app.local'),symbols=[...new Set((parsed.searchParams.get('symbols')||'').split(',').filter(Boolean))],quotes={};
 let fetchedAt=null;
 for(let i=0;i<symbols.length;i+=30){
  const batch=symbols.slice(i,i+30);
  const response=await fetcher(parsed.pathname+'?symbols='+encodeURIComponent(batch.join(',')),{signal});
  if(!response.ok)return response;
  const data=await response.json();
  Object.assign(quotes,data.quotes||{});
  // The earliest batch time describes the start of this complete refresh.
  fetchedAt ||= data.fetchedAt;
 }
 return Response.json({quotes,fetchedAt:fetchedAt||new Date().toISOString()});
}
