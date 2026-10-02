export const emptyPortfolio = () => ({ holdings: [], fees: { rate: 0.1425, discount: 1, minimum: 20 } });
const finite = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
export function validatePortfolio(value) {
  if (!value || !Array.isArray(value.holdings) || value.holdings.length > 100) throw new Error('最多可設定 100 筆持股');
  const f = value.fees;
  if (!f || !finite(f.rate, 0, 5) || !finite(f.discount, 0, 1) || !finite(f.minimum, 0, 10000)) throw new Error('請確認手續費設定');
  const ids = new Set();
  const holdings = value.holdings.map(h => {
    if (!h || typeof h.id !== 'string' || !/^[\w-]{1,64}$/.test(h.id) || ids.has(h.id)) throw new Error('持股識別碼重複或無效');
    ids.add(h.id);
    if (!/^\d{4,6}$/.test(h.symbol) || typeof h.name !== 'string' || !h.name.trim() || h.name.length > 80) throw new Error('請填寫股票代碼與名稱');
    if (!finite(h.shares, 1, 1e9) || !Number.isInteger(h.shares) || !finite(h.avgCost, 0.0001, 1e7)) throw new Error('股數須為正整數，平均成本須大於零');
    if (!finite(h.buyFees, 0, 1e12) || !finite(h.dividends, 0, 1e12) || !finite(h.taxRate, 0, 5)) throw new Error('費用、股息或稅率無效');
    return { id:h.id, symbol:h.symbol, name:h.name.trim(), shares:h.shares, avgCost:h.avgCost, buyFees:h.buyFees, dividends:h.dividends, taxRate:h.taxRate };
  });
  return { holdings, fees: { rate:f.rate, discount:f.discount, minimum:f.minimum } };
}
// 費用以單筆委託估算，四捨五入到元；實際拆單與券商進位規則可能不同。
export function sellFee(gross, fees) {
  return gross > 0 ? Math.max(fees.minimum, Math.round(gross * fees.rate / 100 * fees.discount)) : 0;
}
export function valuation(h, price, fees, shares = h.shares) {
  const ratio = shares / h.shares;
  const cost = h.avgCost * shares + h.buyFees * ratio;
  const dividends = h.dividends * ratio;
  if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(shares) || shares < 1 || shares > h.shares) return { cost, dividends, available:false };
  const gross = price * shares;
  const fee = sellFee(gross, fees);
  const tax = Math.floor(gross * h.taxRate / 100);
  const grossPnl = gross - cost;
  const netPnl = gross - fee - tax + dividends - cost;
  return { available:true, cost, dividends, gross, fee, tax, proceeds:gross-fee-tax, grossPnl, netPnl, returnPercent:netPnl/cost*100 };
}
export function breakEven(h, fees) {
  // 數值二分求解，含最低手續費與證交稅元以下捨去。
  let low = 0, high = Math.max(h.avgCost * 2, 1);
  while (valuation(h, high, fees).netPnl < 0 && high < 1e9) high *= 2;
  for (let i=0; i<64; i++) {
    const mid=(low+high)/2;
    if (valuation(h, mid, fees).netPnl >= 0) high=mid; else low=mid;
  }
  return Math.ceil(high * 100) / 100;
}
