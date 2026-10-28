export function validateWatchlist(items) {
  if(!Array.isArray(items))throw new Error('自選股格式錯誤');
  const seen=new Set();
  return items.map(item=>{
    if(!Array.isArray(item)||item.length!==2||typeof item[0]!=='string'||!/^(?:\d{4,6}|\d{4,5}[A-Z])$/.test(item[0])||typeof item[1]!=='string'||item[1].length>60||seen.has(item[0]))throw new Error('自選股格式錯誤或代碼重複');
    seen.add(item[0]);return [item[0],item[1].trim()||item[0]];
  });
}
