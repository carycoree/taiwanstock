// shared/portfolio.mjs
var emptyPortfolio = () => ({ holdings: [], fees: { rate: 0.1425, discount: 1, minimum: 20 } });
var finite = (n, min, max) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
function validatePortfolio(value) {
  if (!value || !Array.isArray(value.holdings) || value.holdings.length > 100) throw new Error("\u6700\u591A\u53EF\u8A2D\u5B9A 100 \u7B46\u6301\u80A1");
  const f = value.fees;
  if (!f || !finite(f.rate, 0, 5) || !finite(f.discount, 0, 1) || !finite(f.minimum, 0, 1e4)) throw new Error("\u8ACB\u78BA\u8A8D\u624B\u7E8C\u8CBB\u8A2D\u5B9A");
  const ids = /* @__PURE__ */ new Set();
  const holdings = value.holdings.map((h) => {
    if (!h || typeof h.id !== "string" || !/^[\w-]{1,64}$/.test(h.id) || ids.has(h.id)) throw new Error("\u6301\u80A1\u8B58\u5225\u78BC\u91CD\u8907\u6216\u7121\u6548");
    ids.add(h.id);
    if (!/^\d{4,6}$/.test(h.symbol) || typeof h.name !== "string" || !h.name.trim() || h.name.length > 80) throw new Error("\u8ACB\u586B\u5BEB\u80A1\u7968\u4EE3\u78BC\u8207\u540D\u7A31");
    if (!finite(h.shares, 1, 1e9) || !Number.isInteger(h.shares) || !finite(h.avgCost, 1e-4, 1e7)) throw new Error("\u80A1\u6578\u9808\u70BA\u6B63\u6574\u6578\uFF0C\u5E73\u5747\u6210\u672C\u9808\u5927\u65BC\u96F6");
    if (!finite(h.buyFees, 0, 1e12) || !finite(h.dividends, 0, 1e12) || !finite(h.taxRate, 0, 5)) throw new Error("\u8CBB\u7528\u3001\u80A1\u606F\u6216\u7A05\u7387\u7121\u6548");
    return { id: h.id, symbol: h.symbol, name: h.name.trim(), shares: h.shares, avgCost: h.avgCost, buyFees: h.buyFees, dividends: h.dividends, taxRate: h.taxRate };
  });
  return { holdings, fees: { rate: f.rate, discount: f.discount, minimum: f.minimum } };
}

// worker/auth.js
var COOKIE = "__Host-tsi-session";
var HOURS = 8;
var encoder = new TextEncoder();
var hex = (bytes) => [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, "0")).join("");
var random = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
var digest = async (value) => hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
var reply = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
var cookie = (value, age = HOURS * 3600) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
var selfHosted = (env) => ["account", "password"].includes(env.APP_AUTH_MODE);
var ownerFor = (request, env) => selfHosted(env) ? "cloudflare-owner" : request.headers.get("oai-authenticated-user-id");
var userView = (row) => ({ username: row.username, expiresInHours: HOURS });
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations: 1e5, hash: "SHA-256" }, key, 256));
}
async function equal(a, b) {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
async function sessionUser(request, env) {
  if (!env.DB) return null;
  const token = (request.headers.get("cookie") || "").split(";").map((s) => s.trim()).find((s) => s.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await env.DB.prepare("SELECT a.owner_id, a.username, s.token_hash FROM auth_sessions s JOIN auth_accounts a ON a.owner_id = s.owner_id WHERE s.token_hash = ? AND s.expires_at > ?").bind(await digest(token), Date.now()).first();
  if (!row || row.owner_id !== ownerFor(request, env)) return null;
  return row;
}
async function createSession(env, row) {
  const token = random(32), now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").bind(now),
    env.DB.prepare("INSERT INTO auth_sessions (token_hash, owner_id, expires_at) VALUES (?, ?, ?)").bind(await digest(token), row.owner_id, now + HOURS * 36e5)
  ]);
  return reply({ authenticated: true, user: userView(row) }, 200, { "set-cookie": cookie(token) });
}
async function authApi(request, env, url) {
  if (!env.DB) return reply({ authenticated: false, databaseReady: false, message: "\u8ACB\u5148\u7D81\u5B9A\u6301\u80A1\u8CC7\u6599\u5EAB\u4E26\u5957\u7528\u767B\u5165\u8CC7\u6599\u8868" }, 503);
  const owner = ownerFor(request, env);
  if (!owner) return reply({ authenticated: false, message: "\u8ACB\u5148\u767B\u5165\u6B64\u7DB2\u7AD9\u7684 ChatGPT \u5E33\u865F" }, 401);
  try {
    const account = await env.DB.prepare("SELECT * FROM auth_accounts WHERE owner_id = ?").bind(owner).first();
    if (url.pathname === "/api/auth/session" && request.method === "GET") {
      const user2 = await sessionUser(request, env);
      const setupSecret = env.AUTH_SETUP_TOKEN || env.PORTFOLIO_PASSWORD;
      return reply({ authenticated: !!user2, user: user2 ? userView(user2) : null, needsSetup: !account, setupAllowed: !account && (!selfHosted(env) || Boolean(setupSecret?.length >= 16)), requiresSetupCode: selfHosted(env), databaseReady: true });
    }
    if (request.method !== "POST") return reply({ message: "\u4E0D\u652F\u63F4\u6B64\u64CD\u4F5C" }, 405);
    if (request.headers.get("origin") !== url.origin || !request.headers.get("content-type")?.startsWith("application/json")) return reply({ message: "\u4E0D\u5141\u8A31\u8DE8\u7AD9\u64CD\u4F5C\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u7DB2\u7AD9" }, 403);
    const text = await request.text();
    if (text.length > 4096) return reply({ message: "\u8F38\u5165\u5167\u5BB9\u904E\u9577" }, 413);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return reply({ message: "\u8F38\u5165\u683C\u5F0F\u6709\u8AA4" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ message: "\u8F38\u5165\u683C\u5F0F\u6709\u8AA4" }, 400);
    const validCredentials = (username2, password) => typeof username2 === "string" && /^[a-z0-9_.-]{3,64}$/.test(username2) && typeof password === "string" && password.length >= 12 && password.length <= 128;
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const now = Date.now(), attemptKey = await digest(`${request.headers.get("cf-connecting-ip") || owner}:${owner}`);
    const attempt = await env.DB.prepare("SELECT failures, reset_at FROM auth_attempts WHERE attempt_key = ?").bind(attemptKey).first();
    if (url.pathname !== "/api/auth/logout" && attempt?.reset_at > now && attempt.failures >= 5) return reply({ message: "\u5617\u8A66\u6B21\u6578\u904E\u591A\uFF0C\u8ACB\u65BC 15 \u5206\u9418\u5F8C\u518D\u8A66" }, 429, { "retry-after": String(Math.ceil((attempt.reset_at - now) / 1e3)) });
    const failure = async () => {
      await env.DB.prepare("INSERT INTO auth_attempts (attempt_key, failures, reset_at) VALUES (?, 1, ?) ON CONFLICT(attempt_key) DO UPDATE SET failures = CASE WHEN reset_at <= ? THEN 1 ELSE failures + 1 END, reset_at = CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END").bind(attemptKey, now + 9e5, now, now).run();
      return reply({ message: "\u5E33\u865F\u3001\u5BC6\u78BC\u6216\u521D\u59CB\u5316\u78BC\u4E0D\u6B63\u78BA" }, 401);
    };
    if (url.pathname === "/api/auth/setup") {
      if (account) return reply({ message: "\u5E33\u865F\u5DF2\u5EFA\u7ACB\uFF0C\u8ACB\u4F7F\u7528\u767B\u5165" }, 409);
      const secret = env.AUTH_SETUP_TOKEN || env.PORTFOLIO_PASSWORD;
      if (selfHosted(env) && (!secret || secret.length < 16)) return reply({ message: "\u8ACB\u5148\u8A2D\u5B9A AUTH_SETUP_TOKEN Secret\uFF08\u81F3\u5C11 16 \u5B57\u5143\uFF09" }, 503);
      if (selfHosted(env) && (typeof body.setupCode !== "string" || !await equal(body.setupCode, secret))) return failure();
      if (!validCredentials(username, body.password)) return reply({ message: "\u5E33\u865F\u9700\u70BA 3\u201364 \u500B\u82F1\u6578\u5B57\u6216 . _ -\uFF1B\u5BC6\u78BC\u9700\u70BA 12\u2013128 \u5B57\u5143" }, 400);
      const salt = random(16), hash = await passwordHash(body.password, salt);
      const result = await env.DB.prepare("INSERT INTO auth_accounts (owner_id, username, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_id) DO NOTHING").bind(owner, username, hash, salt, (/* @__PURE__ */ new Date()).toISOString()).run();
      if (!result.meta?.changes) return reply({ message: "\u5E33\u865F\u5DF2\u5EFA\u7ACB\uFF0C\u8ACB\u4F7F\u7528\u767B\u5165" }, 409);
      await env.DB.prepare("DELETE FROM auth_attempts WHERE attempt_key = ?").bind(attemptKey).run();
      return createSession(env, { owner_id: owner, username });
    }
    if (url.pathname === "/api/auth/login") {
      if (typeof body.password !== "string" || body.password.length > 128) return failure();
      const hash = await passwordHash(body.password, account?.salt || "00000000000000000000000000000000");
      if (!account || username !== account.username || !await equal(hash, account.password_hash)) return failure();
      await env.DB.prepare("DELETE FROM auth_attempts WHERE attempt_key = ?").bind(attemptKey).run();
      return createSession(env, account);
    }
    const user = await sessionUser(request, env);
    if (!user) return reply({ message: "\u767B\u5165\u5DF2\u904E\u671F\uFF0C\u8ACB\u91CD\u65B0\u767B\u5165" }, 401);
    if (url.pathname === "/api/auth/logout") {
      await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(user.token_hash).run();
      return reply({ authenticated: false }, 200, { "set-cookie": cookie("", 0) });
    }
    if (url.pathname === "/api/auth/password") {
      if (!validCredentials(account.username, body.newPassword)) return reply({ message: "\u65B0\u5BC6\u78BC\u9700\u70BA 12\u2013128 \u5B57\u5143" }, 400);
      if (typeof body.currentPassword !== "string" || body.currentPassword.length > 128 || !await equal(await passwordHash(body.currentPassword, account.salt), account.password_hash)) return failure();
      const salt = random(16), hash = await passwordHash(body.newPassword, salt);
      await env.DB.batch([
        env.DB.prepare("UPDATE auth_accounts SET password_hash = ?, salt = ? WHERE owner_id = ?").bind(hash, salt, owner),
        env.DB.prepare("DELETE FROM auth_sessions WHERE owner_id = ?").bind(owner),
        env.DB.prepare("DELETE FROM auth_attempts WHERE attempt_key = ?").bind(attemptKey)
      ]);
      return createSession(env, account);
    }
    return reply({ message: "\u627E\u4E0D\u5230\u6B64\u767B\u5165\u529F\u80FD" }, 404);
  } catch (e) {
    console.error("Authentication unavailable", e.message);
    return reply({ authenticated: false, message: "\u767B\u5165\u670D\u52D9\u66AB\u6642\u7121\u6CD5\u4F7F\u7528\uFF1B\u8ACB\u78BA\u8A8D\u8CC7\u6599\u5EAB\u9077\u79FB\u5DF2\u5B8C\u6210" }, 503);
  }
}

// shared/sessions.mjs
function normalizeNightReport(rows) {
  if (!Array.isArray(rows)) return [];
  const number2 = (v) => v == null || !String(v).trim() || /NULL|--|^-$/.test(String(v)) ? null : Number(String(v).replace(/[,%]/g, ""));
  const latest = rows.filter((r) => ["TX", "MTX"].includes(r.Contract) && r.TradingSession === "\u76E4\u5F8C" && /^\d{6}$/.test(r["ContractMonth(Week)"]) && /^\d{8}$/.test(r.Date)).sort((a, b) => b.Date.localeCompare(a.Date) || a["ContractMonth(Week)"].localeCompare(b["ContractMonth(Week)"]));
  return ["TX", "MTX"].map((contract) => {
    const r = latest.find((x) => x.Contract === contract);
    if (!r) return null;
    const last = number2(r.Last);
    if (!Number.isFinite(last) || last <= 0) return null;
    return { contract, name: contract === "TX" ? "\u81FA\u80A1\u671F\u8CA8" : "\u5C0F\u578B\u81FA\u6307\u671F\u8CA8", month: r["ContractMonth(Week)"], date: r.Date, last, change: number2(r.Change), changePercent: number2(r["%"]), volume: number2(r.Volume), kind: "official_after_hours_report" };
  }).filter(Boolean);
}

// worker/index.js
var FUGLE_BASE = "https://api.fugle.tw/marketdata/v1.0/stock";
var TWSE_BASE = "https://www.twse.com.tw/rwd/zh";
var TWSE_OPEN = "https://openapi.twse.com.tw/v1/opendata";
var TPEX_OPEN = "https://www.tpex.org.tw/openapi/v1";
var masterCache = { at: 0, rows: [] };
var nightCache = { at: 0, data: null };
var fallbackSymbols = [
  ["0050", "\u5143\u5927\u53F0\u706350", "ETF"],
  ["0056", "\u5143\u5927\u9AD8\u80A1\u606F", "ETF"],
  ["006208", "\u5BCC\u90A6\u53F050", "ETF"],
  ["00878", "\u570B\u6CF0\u6C38\u7E8C\u9AD8\u80A1\u606F", "ETF"],
  ["00919", "\u7FA4\u76CA\u53F0\u7063\u7CBE\u9078\u9AD8\u606F", "ETF"],
  ["00929", "\u5FA9\u83EF\u53F0\u7063\u79D1\u6280\u512A\u606F", "ETF"],
  ["1101", "\u53F0\u6CE5", "\u6C34\u6CE5"],
  ["1301", "\u53F0\u5851", "\u5851\u81A0"],
  ["2002", "\u4E2D\u92FC", "\u92FC\u9435"],
  ["2303", "\u806F\u96FB", "\u534A\u5C0E\u9AD4"],
  ["2308", "\u53F0\u9054\u96FB", "\u96FB\u5B50\u96F6\u7D44\u4EF6"],
  ["2317", "\u9D3B\u6D77", "\u96FB\u5B50\u96F6\u7D44\u4EF6"],
  ["2330", "\u53F0\u7A4D\u96FB", "\u534A\u5C0E\u9AD4"],
  ["2379", "\u745E\u6631", "\u534A\u5C0E\u9AD4"],
  ["2382", "\u5EE3\u9054", "\u96FB\u8166\u53CA\u9031\u908A"],
  ["2408", "\u5357\u4E9E\u79D1", "\u534A\u5C0E\u9AD4"],
  ["2454", "\u806F\u767C\u79D1", "\u534A\u5C0E\u9AD4"],
  ["2881", "\u5BCC\u90A6\u91D1", "\u91D1\u878D"],
  ["2882", "\u570B\u6CF0\u91D1", "\u91D1\u878D"],
  ["2891", "\u4E2D\u4FE1\u91D1", "\u91D1\u878D"],
  ["3008", "\u5927\u7ACB\u5149", "\u5149\u96FB"],
  ["3711", "\u65E5\u6708\u5149\u6295\u63A7", "\u534A\u5C0E\u9AD4"],
  ["6505", "\u53F0\u5851\u5316", "\u6CB9\u96FB\u71C3\u6C23"]
].map(([symbol, name, industry]) => ({ symbol, name, industry, exchange: "TWSE" }));
var json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
});
var taipeiNow = () => new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
}).format(/* @__PURE__ */ new Date());
async function fugle(env, path) {
  if (!env.FUGLE_API_KEY) throw new Error("FUGLE_API_KEY_MISSING");
  const response = await fetch(`${FUGLE_BASE}${path}`, {
    headers: { "X-API-KEY": env.FUGLE_API_KEY, accept: "application/json" }
  });
  if (!response.ok) throw new Error(`FUGLE_${response.status}`);
  return response.json();
}
async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8e3);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "TaiwanStockIntelligence/1.0" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}
var number = (value) => Number(String(value ?? "").replace(/,/g, "").replace(/--/g, "")) || 0;
var isoFromRoc = (value) => {
  const m = String(value || "").match(/(\d{2,3})\/(\d{1,2})\/(\d{1,2})/);
  return m ? `${Number(m[1]) + 1911}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}` : value;
};
var dateKey = (date) => date.toISOString().slice(0, 10).replaceAll("-", "");
var dateCandidates = (count = 8) => Array.from({ length: count }, (_, i) => new Date(Date.now() - i * 864e5));
var fieldIndex = (fields, patterns) => fields.findIndex((f) => patterns.some((p) => p.test(String(f))));
var findTableRow = (payload, symbol) => {
  for (const table of payload?.tables || [payload]) {
    const fields = table?.fields || payload?.fields || [], rows = table?.data || payload?.data || [];
    const symbolIndex = Math.max(0, fieldIndex(fields, [/證券代號/, /股票代號/, /代號/]));
    const row = rows.find((x) => String(x[symbolIndex] || "").trim() === symbol);
    if (row) return { fields, row };
  }
  return null;
};
async function twseDaily(symbol) {
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = /* @__PURE__ */ new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - i);
    return dateKey(d);
  });
  const results = await Promise.all(months.map(async (date) => {
    try {
      const raw = await fetchJson(`${TWSE_BASE}/afterTrading/STOCK_DAY?date=${date}&stockNo=${encodeURIComponent(symbol)}&response=json`);
      return (raw?.data || []).map((x) => ({ date: isoFromRoc(x[0]), volume: number(x[1]), open: number(x[3]), high: number(x[4]), low: number(x[5]), close: number(x[6]) }));
    } catch {
      return [];
    }
  }));
  return results.flat().filter((x) => x.date && x.close).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
async function latestOfficial(path, symbol, parser, selectType = "ALL") {
  for (const date of dateCandidates()) {
    try {
      const raw = await fetchJson(`${TWSE_BASE}/${path}?date=${dateKey(date)}&selectType=${selectType}&response=json`);
      const found = findTableRow(raw, symbol);
      if (found) return parser(found.fields, found.row, dateKey(date));
    } catch {
    }
  }
  return null;
}
async function officialPayload(symbol) {
  const institutional = latestOfficial("fund/T86", symbol, (f, r, date) => {
    const pick = (p) => number(r[fieldIndex(f, p)]);
    return { date, foreign: pick([/外陸資買賣超股數.*不含外資自營商/, /外資及陸資.*買賣超/]), trust: pick([/投信買賣超/]), dealer: pick([/自營商買賣超/, /自營商.*合計/]), total: pick([/三大法人買賣超/]), source: "\u81FA\u7063\u8B49\u5238\u4EA4\u6613\u6240" };
  }, "ALLBUT0999");
  const margin = latestOfficial("marginTrading/MI_MARGN", symbol, (f, r, date) => {
    const pick = (p) => number(r[fieldIndex(f, p)]);
    return { date, marginBalance: pick([/融資.*今日餘額/, /融資餘額/]), shortBalance: pick([/融券.*今日餘額/, /融券餘額/]), source: "\u81FA\u7063\u8B49\u5238\u4EA4\u6613\u6240" };
  });
  const revenue = (async () => {
    try {
      const list = await fetchJson(`${TWSE_OPEN}/t187ap05_L`);
      const row = (Array.isArray(list) ? list : []).find((x) => String(x["\u516C\u53F8\u4EE3\u865F"] || x["\u516C\u53F8\u4EE3\u78BC"] || "").trim() === symbol);
      if (!row) return null;
      return { period: row["\u8CC7\u6599\u5E74\u6708"] || row["\u51FA\u8868\u65E5\u671F"] || "", monthly: number(row["\u7576\u6708\u71DF\u6536"]), yoy: number(row["\u53BB\u5E74\u540C\u6708\u589E\u6E1B(%)"] || row["\u53BB\u5E74\u540C\u6708\u589E\u6E1B\uFF05"]), mom: number(row["\u4E0A\u6708\u6BD4\u8F03\u589E\u6E1B(%)"] || row["\u4E0A\u6708\u6BD4\u8F03\u589E\u6E1B\uFF05"]), source: "\u516C\u958B\u8CC7\u8A0A\u89C0\u6E2C\u7AD9\uFF0FTWSE OpenAPI" };
    } catch {
      return null;
    }
  })();
  const [institutionData, marginData, revenueData] = await Promise.all([institutional, margin, revenue]);
  return {
    institutional: institutionData,
    margin: marginData,
    revenue: revenueData,
    links: [
      { label: "\u8B49\u4EA4\u6240\u57FA\u672C\u5E02\u6CC1", url: `https://mis.twse.com.tw/stock/fibest.jsp?stock=${symbol}`, provider: "TWSE" },
      { label: "\u516C\u958B\u8CC7\u8A0A\u89C0\u6E2C\u7AD9", url: "https://mops.twse.com.tw/mops/web/index", provider: "MOPS" },
      { label: "Yahoo \u80A1\u5E02\u65B0\u805E", url: `https://tw.stock.yahoo.com/quote/${symbol}.TW/news`, provider: "Yahoo" }
    ]
  };
}
async function stockMaster() {
  if (Date.now() - masterCache.at < 36e5 && masterCache.rows.length) return masterCache.rows;
  const [listed, otc] = await Promise.all([
    fetchJson(`${TWSE_OPEN}/t187ap03_L`).catch(() => []),
    fetchJson(`${TPEX_OPEN}/mopsfin_t187ap03_O`).catch(() => [])
  ]);
  const normalize = (x, exchange) => ({
    symbol: String(x["\u516C\u53F8\u4EE3\u865F"] || x["\u516C\u53F8\u4EE3\u78BC"] || x["SecuritiesCompanyCode"] || "").trim(),
    name: String(x["\u516C\u53F8\u7C21\u7A31"] || x["\u516C\u53F8\u540D\u7A31"] || x["CompanyName"] || "").trim(),
    industry: String(x["\u7522\u696D\u5225"] || x["\u7522\u696D\u985E\u5225"] || x["SecuritiesIndustryCode"] || "\u5176\u4ED6").trim(),
    exchange
  });
  const official = [...(Array.isArray(listed) ? listed : []).map((x) => normalize(x, "TWSE")), ...(Array.isArray(otc) ? otc : []).map((x) => normalize(x, "TPEx"))].filter((x) => /^\d{4,6}$/.test(x.symbol) && x.name);
  const merged = new Map(fallbackSymbols.map((x) => [x.symbol, x]));
  official.forEach((x) => merged.set(x.symbol, x));
  const rows = [...merged.values()];
  masterCache = { at: Date.now(), rows };
  return masterCache.rows;
}
async function marketPayload() {
  for (const date of dateCandidates()) {
    try {
      const raw = await fetchJson(`${TWSE_BASE}/afterTrading/MI_INDEX?date=${dateKey(date)}&type=ALLBUT0999&response=json`);
      if (raw?.stat !== "OK" && !raw?.tables?.length) continue;
      let index = null, breadth = { up: 0, down: 0, flat: 0 }, stocks = [];
      const sectorMap = /* @__PURE__ */ new Map();
      for (const table of raw.tables || []) {
        const f = table.fields || [], d = table.data || [];
        const code = fieldIndex(f, [/證券代號/]), name = fieldIndex(f, [/證券名稱/]), close = fieldIndex(f, [/收盤價/]), diff = fieldIndex(f, [/漲跌價差/]), sign = fieldIndex(f, [/漲跌\(\+\/-\)/]), volume2 = fieldIndex(f, [/成交股數/]), value = fieldIndex(f, [/成交金額/]);
        if (code >= 0 && close >= 0) stocks = d.map((r) => {
          const c = number(r[close]), delta = number(r[diff]) * (String(r[sign] || "").includes("-") ? -1 : 1), prev = c - delta;
          return { symbol: String(r[code]).trim(), name: String(r[name] || "").trim(), close: c, change: delta, changePercent: prev ? delta / prev * 100 : 0, volume: number(r[volume2]), value: number(r[value]) };
        }).filter((x) => x.symbol && x.close);
        const idxName = fieldIndex(f, [/^指數$/, /指數名稱/]), idxClose = fieldIndex(f, [/收盤指數/]), idxDiff = fieldIndex(f, [/漲跌點數/]), idxPct = fieldIndex(f, [/漲跌百分比/]), idxSign = fieldIndex(f, [/漲跌\(\+\/-\)/]);
        if (idxName >= 0) {
          const row = d.find((r) => String(r[idxName]).includes("\u767C\u884C\u91CF\u52A0\u6B0A\u80A1\u50F9\u6307\u6578"));
          if (row) {
            const dir = String(row[idxSign] || "").includes("-") ? -1 : 1;
            index = { name: "TAIEX", close: number(row[idxClose]), change: Math.abs(number(row[idxDiff])) * dir, changePercent: Math.abs(number(row[idxPct])) * dir };
          }
          for (const r of d) {
            const rawName = String(r[idxName] || "").trim();
            if (!/類指數$/.test(rawName) || /報酬|兩倍|反向|槓桿/.test(rawName)) continue;
            const dir = String(r[idxSign] || "").includes("-") ? -1 : 1, changePercent = Math.abs(number(r[idxPct])) * dir;
            if (Number.isFinite(changePercent)) sectorMap.set(rawName, { name: rawName.replace(/指數$/, ""), changePercent });
          }
        }
        for (const r of d) {
          const label = String(r[0] || "").trim(), match = r.slice(1).join(" ").match(/[\d,]+/), count = match ? number(match[0]) : 0;
          if (label.startsWith("\u4E0A\u6F32")) breadth.up = Math.max(breadth.up, count);
          if (label.startsWith("\u4E0B\u8DCC")) breadth.down = Math.max(breadth.down, count);
          if (label.startsWith("\u6301\u5E73") || label.startsWith("\u672A\u6210\u4EA4")) breadth.flat += count;
        }
      }
      const sectors = [...sectorMap.values()].sort((a, b) => b.changePercent - a.changePercent).slice(0, 12);
      let institutional = { buys: [], sells: [] };
      try {
        const inst = await fetchJson(`${TWSE_BASE}/fund/T86?date=${dateKey(date)}&selectType=ALLBUT0999&response=json`), table = (inst.tables || []).find((t) => fieldIndex(t.fields || [], [/證券代號/]) >= 0);
        if (table) {
          const f = table.fields || [], ci = fieldIndex(f, [/證券代號/]), ni = fieldIndex(f, [/證券名稱/]), ti = fieldIndex(f, [/三大法人買賣超/, /合計買賣超/]);
          const rows = (table.data || []).map((r) => ({ symbol: String(r[ci] || "").trim(), name: String(r[ni] || "").trim(), net: number(r[ti]) })).filter((x) => x.symbol && x.net);
          institutional = { buys: [...rows].sort((a, b) => b.net - a.net).slice(0, 5), sells: [...rows].sort((a, b) => a.net - b.net).slice(0, 5) };
        }
      } catch {
      }
      const turnover = stocks.reduce((sum, x) => sum + x.value, 0), volume = stocks.reduce((sum, x) => sum + x.volume, 0), maxVolume = Math.max(...stocks.map((x) => x.volume), 1);
      const aiPicks = stocks.filter((x) => x.changePercent > 0 && x.volume > 0).map((x) => {
        const momentum = Math.min(40, x.changePercent * 4), liquidity = Math.min(30, Math.log10(x.volume + 1) / Math.log10(maxVolume + 1) * 30), score = Math.round(30 + momentum + liquidity);
        return { symbol: x.symbol, name: x.name, close: x.close, changePercent: x.changePercent, volume: x.volume, score: Math.min(99, score), signal: x.changePercent >= 7 ? "\u5F37\u52E2\u52D5\u80FD" : x.changePercent >= 3 ? "\u91CF\u50F9\u8F49\u5F37" : "\u76F8\u5C0D\u5F37\u52E2" };
      }).sort((a, b) => b.score - a.score || b.changePercent - a.changePercent).slice(0, 6);
      return { status: "ok", date: dateKey(date), index, breadth, sectors, liquidity: { turnover, volume, listed: stocks.length }, institutional, aiPicks, movers: [...stocks].sort((a, b) => b.changePercent - a.changePercent).slice(0, 8), laggards: [...stocks].sort((a, b) => a.changePercent - b.changePercent).slice(0, 5), total: stocks.length, source: "\u81FA\u7063\u8B49\u5238\u4EA4\u6613\u6240" };
    } catch {
    }
  }
  return { status: "unavailable", date: null, index: null, breadth: { up: 0, down: 0, flat: 0 }, sectors: [], liquidity: null, institutional: { buys: [], sells: [] }, aiPicks: [], movers: [], laggards: [], source: "\u81FA\u7063\u8B49\u5238\u4EA4\u6613\u6240" };
}
async function cached(request, seconds, loader) {
  const cache = caches.default;
  const cachedResponse = await cache.match(request);
  const privateResponse = (response2) => {
    const out = new Response(response2.body, response2);
    out.headers.set("cache-control", "no-store");
    return out;
  };
  if (cachedResponse) return privateResponse(cachedResponse);
  const response = await loader();
  if (response.ok) {
    const copy = new Response(response.body, response);
    copy.headers.set("cache-control", `public, max-age=${seconds}`);
    await cache.put(request, copy.clone());
    return privateResponse(copy);
  }
  return response;
}
var normalizeQuote = (raw, symbol) => {
  const d = raw?.data || raw || {};
  const last = Number(d.lastPrice ?? d.closePrice ?? d.close ?? 0);
  const previous = Number(d.previousClose ?? d.previousClosePrice ?? d.referencePrice ?? 0);
  return {
    symbol,
    name: d.name || (symbol === "2330" ? "\u53F0\u7A4D\u96FB" : symbol),
    lastPrice: last,
    previousClose: previous,
    change: Number(d.change ?? (last && previous ? last - previous : 0)),
    changePercent: Number(d.changePercent ?? (last && previous ? (last - previous) / previous * 100 : 0)),
    openPrice: Number(d.openPrice ?? d.open ?? 0),
    highPrice: Number(d.highPrice ?? d.high ?? 0),
    lowPrice: Number(d.lowPrice ?? d.low ?? 0),
    totalVolume: Number(d.total?.tradeVolume ?? d.totalVolume ?? d.volume ?? 0),
    totalValue: Number(d.total?.tradeValue ?? d.totalValue ?? 0),
    lastUpdated: d.lastUpdated || d.lastUpdate || null,
    isClose: Boolean(d.isClose),
    source: "Fugle MarketData"
  };
};
var normalizeCandles = (raw) => (raw?.data || raw || []).map((x) => ({
  date: x.date || x.time || x.timestamp,
  open: Number(x.open),
  high: Number(x.high),
  low: Number(x.low),
  close: Number(x.close),
  volume: Number(x.volume || 0)
})).filter((x) => x.date && Number.isFinite(x.close));
async function stockPayload(env, symbol) {
  const to = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const fromDate = new Date(Date.now() - 1e3 * 60 * 60 * 24 * 180).toISOString().slice(0, 10);
  const officialPromise = officialPayload(symbol);
  let quote = null, candles = [], error = null;
  try {
    const [quoteRaw, candleRaw] = await Promise.all([
      fugle(env, `/intraday/quote/${encodeURIComponent(symbol)}`),
      fugle(env, `/historical/candles/${encodeURIComponent(symbol)}?from=${fromDate}&to=${to}&timeframe=D`)
    ]);
    quote = normalizeQuote(quoteRaw, symbol);
    candles = normalizeCandles(candleRaw);
  } catch (e) {
    error = String(e.message || e);
  }
  if (!candles.length) candles = await twseDaily(symbol);
  const official = await officialPromise;
  const hasOfficial = Boolean(candles.length || official.institutional || official.margin || official.revenue);
  return {
    status: quote ? "live" : hasOfficial ? "official_only" : error === "FUGLE_API_KEY_MISSING" ? "not_configured" : "error",
    provider: quote ? "Fugle MarketData + TWSE" : "TWSE\uFF0FMOPS \u516C\u958B\u8CC7\u6599",
    fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
    taipeiTime: taipeiNow(),
    quote,
    candles,
    official,
    error,
    sources: [
      { label: "\u5373\u6642\u884C\u60C5", provider: "Fugle MarketData", state: quote ? "live" : "unavailable", updatedAt: quote?.lastUpdated },
      { label: "\u6B77\u53F2\u65E5\u7DDA", provider: candles.length && quote ? "Fugle MarketData" : "\u81FA\u7063\u8B49\u5238\u4EA4\u6613\u6240", state: candles.length ? "available" : "unavailable", updatedAt: candles.at(-1)?.date },
      { label: "\u4E09\u5927\u6CD5\u4EBA\uFF0F\u878D\u8CC7\u878D\u5238", provider: "\u81FA\u7063\u8B49\u5238\u4EA4\u6613\u6240", state: official.institutional || official.margin ? "available" : "unavailable" },
      { label: "\u6708\u71DF\u6536", provider: "\u516C\u958B\u8CC7\u8A0A\u89C0\u6E2C\u7AD9\uFF0FTWSE OpenAPI", state: official.revenue ? "available" : "unavailable" }
    ]
  };
}
async function api(request, env, url) {
  if (url.pathname.startsWith("/api/auth/")) return authApi(request, env, url);
  if (!["/api/health", "/api/search", "/api/market", "/api/night"].includes(url.pathname) && !/^\/api\/stock\/\d{4,6}$/.test(url.pathname) && !url.pathname.startsWith("/api/portfolio")) {
    await env.ASSETS.fetch(request);
    return json({ error: "NOT_FOUND" }, 404);
  }
  if (url.pathname !== "/api/health") {
    try {
      if (!await sessionUser(request, env)) return json({ error: "UNAUTHORIZED", message: "\u8ACB\u5148\u767B\u5165\u7DB2\u7AD9" }, 401);
    } catch {
      return json({ message: "\u767B\u5165\u670D\u52D9\u66AB\u6642\u7121\u6CD5\u4F7F\u7528" }, 503);
    }
  }
  if (url.pathname.startsWith("/api/portfolio")) return portfolioApi(request, env, url);
  if (url.pathname === "/api/health") return json({
    ok: true,
    provider: "Fugle MarketData",
    configured: Boolean(env.FUGLE_API_KEY),
    serverTime: (/* @__PURE__ */ new Date()).toISOString(),
    taipeiTime: taipeiNow()
  });
  if (url.pathname === "/api/search") {
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const master = await stockMaster();
    const results = master.filter((x) => !q || x.symbol.includes(q) || x.name.toLowerCase().includes(q)).slice(0, 12);
    return json({ status: "ok", results, source: "TWSE\uFF0FTPEx \u80A1\u7968\u4E3B\u6A94", updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  }
  if (url.pathname === "/api/market") return cached(request, 300, async () => json(await marketPayload()));
  if (url.pathname === "/api/night") {
    if (Date.now() - nightCache.at < 3e5 && nightCache.data) return json(nightCache.data);
    try {
      const rows = normalizeNightReport(await fetchJson("https://openapi.taifex.com.tw/v1/DailyMarketReportFut"));
      const data = { status: rows.length ? "available" : "unavailable", rows, fetchedAt: (/* @__PURE__ */ new Date()).toISOString(), source: "\u81FA\u7063\u671F\u8CA8\u4EA4\u6613\u6240", realtime: false };
      if (rows.length) nightCache = { at: Date.now(), data };
      return json(data);
    } catch {
      return json({ status: "unavailable", rows: [], source: "\u81FA\u7063\u671F\u8CA8\u4EA4\u6613\u6240", realtime: false });
    }
  }
  const match = url.pathname.match(/^\/api\/stock\/(\d{4,6})$/);
  if (match) return cached(request, 30, async () => json(await stockPayload(env, match[1])));
  await env.ASSETS.fetch(request);
  return json({ error: "NOT_FOUND" }, 404);
}
async function portfolioOwner(request, env) {
  return (await sessionUser(request, env))?.owner_id || null;
}
async function portfolioPrices(env, symbols) {
  let official = [];
  try {
    official = await fetchJson(`${TWSE_OPEN}/STOCK_DAY_ALL`);
  } catch {
  }
  const quotes = {};
  for (let i = 0; i < symbols.length; i += 5) await Promise.all(symbols.slice(i, i + 5).map(async (symbol) => {
    let quote = null;
    if (env.FUGLE_API_KEY) try {
      const raw = await fugle(env, `/intraday/quote/${symbol}`), d = raw?.data || raw || {}, q = normalizeQuote(raw, symbol);
      if (q.lastPrice > 0) quote = { price: q.lastPrice, source: q.source, asOf: d.lastUpdated || d.lastUpdate || null, kind: q.isClose ? "close" : "quote" };
    } catch {
    }
    if (!quote) {
      const row = (Array.isArray(official) ? official : []).find((x) => String(x.Code || x["\u8B49\u5238\u4EE3\u865F"] || "").trim() === symbol);
      const price = number(row?.ClosingPrice ?? row?.["\u6536\u76E4\u50F9"]);
      if (price > 0) {
        let date = String(row.Date || row["\u65E5\u671F"] || "");
        if (/^\d{7}$/.test(date)) date = `${Number(date.slice(0, 3)) + 1911}-${date.slice(3, 5)}-${date.slice(5, 7)}`;
        else if (/^\d{8}$/.test(date)) date = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
        quote = { price, source: "\u81FA\u7063\u8B49\u5238\u4EA4\u6613\u6240", asOf: date || null, kind: "official_close" };
      }
    }
    quotes[symbol] = quote || { price: null, source: null, asOf: null, kind: "unavailable" };
  }));
  return { quotes, fetchedAt: (/* @__PURE__ */ new Date()).toISOString() };
}
async function portfolioApi(request, env, url) {
  if (url.pathname === "/api/portfolio/access" && request.method === "GET") return json({ mode: "account", databaseReady: Boolean(env.DB), passwordReady: true });
  const owner = await portfolioOwner(request, env);
  if (!owner) return json({ error: "UNAUTHORIZED", message: "\u8ACB\u5148\u767B\u5165\u7DB2\u7AD9" }, 401);
  if (url.pathname === "/api/portfolio/prices" && request.method === "GET") {
    const symbols = [...new Set((url.searchParams.get("symbols") || "").split(",").filter((x) => /^\d{4,6}$/.test(x)))];
    if (symbols.length > 30) return json({ message: "\u6BCF\u6279\u6700\u591A\u67E5\u8A62 30 \u6A94" }, 400);
    return json(await portfolioPrices(env, symbols));
  }
  if (url.pathname !== "/api/portfolio") return json({ message: "\u627E\u4E0D\u5230\u6301\u80A1\u4ECB\u9762" }, 404);
  if (!env.DB) return json({ error: "DATABASE_NOT_CONFIGURED", message: "\u6301\u80A1\u8CC7\u6599\u5EAB\u5C1A\u672A\u7D81\u5B9A\uFF0C\u640D\u76CA\u8A66\u7B97\u4ECD\u53EF\u4F7F\u7528" }, 503);
  try {
    if (request.method === "GET") {
      const row = await env.DB.prepare("SELECT payload, revision, updated_at FROM portfolios WHERE owner_id = ?").bind(owner).first();
      return json({ portfolio: row ? JSON.parse(row.payload) : emptyPortfolio(), revision: row?.revision || 0, updatedAt: row?.updated_at || null });
    }
    if (request.method !== "PUT") return json({ message: "\u4E0D\u652F\u63F4\u6B64\u64CD\u4F5C" }, 405);
    const origin = request.headers.get("origin");
    if (origin !== url.origin) return json({ message: "\u4E0D\u5141\u8A31\u8DE8\u7AD9\u5132\u5B58" }, 403);
    if (Number(request.headers.get("content-length") || 0) > 1e5) return json({ message: "\u8CC7\u6599\u91CF\u8D85\u904E\u9650\u5236" }, 413);
    const bodyText = await request.text();
    if (bodyText.length > 1e5) return json({ message: "\u8CC7\u6599\u91CF\u8D85\u904E\u9650\u5236" }, 413);
    let body, portfolio;
    try {
      body = JSON.parse(bodyText);
      portfolio = validatePortfolio(body.portfolio);
    } catch (e) {
      return json({ message: e.message || "\u8CC7\u6599\u683C\u5F0F\u6709\u8AA4" }, 400);
    }
    if (!Number.isInteger(body.revision) || body.revision < 0) return json({ message: "\u8CC7\u6599\u7248\u672C\u7121\u6548" }, 400);
    const now = (/* @__PURE__ */ new Date()).toISOString(), payload = JSON.stringify(portfolio);
    const result = body.revision === 0 ? await env.DB.prepare("INSERT INTO portfolios (owner_id, payload, revision, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(owner_id) DO NOTHING").bind(owner, payload, now).run() : await env.DB.prepare("UPDATE portfolios SET payload = ?, revision = revision + 1, updated_at = ? WHERE owner_id = ? AND revision = ?").bind(payload, now, owner, body.revision).run();
    if (!result.meta?.changes) return json({ error: "CONFLICT", message: "\u53E6\u4E00\u500B\u8996\u7A97\u5DF2\u66F4\u65B0\u6301\u80A1\uFF0C\u8ACB\u91CD\u65B0\u8F09\u5165\u5F8C\u518D\u4FEE\u6539" }, 409);
    return json({ portfolio, revision: body.revision + 1, updatedAt: now });
  } catch (e) {
    console.error("Portfolio storage unavailable", e.message);
    return json({ message: "\u6301\u80A1\u8CC7\u6599\u5EAB\u66AB\u6642\u7121\u6CD5\u4F7F\u7528\uFF1B\u8F38\u5165\u5167\u5BB9\u5DF2\u4FDD\u7559\uFF0C\u8ACB\u7A0D\u5F8C\u91CD\u8A66" }, 503);
  }
}
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return api(request, env, url);
    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) return response;
    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  }
};
export {
  index_default as default
};
