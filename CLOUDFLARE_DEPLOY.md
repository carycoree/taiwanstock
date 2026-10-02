# Taiwan Stock Intelligence — Cloudflare 部署

此套件必須部署至 **Cloudflare Workers**，不能只上傳至純靜態 Pages，否則 `/api/*` 資料介面無法運作。

## 部署

1. 安裝 Node.js 20 或更新版本。
2. 解壓縮本套件並進入資料夾。
3. 登入 Cloudflare：

   ```bash
   npx wrangler login
   ```

4. 部署網站：

   ```bash
   npx wrangler deploy
   ```

## 選用：啟用 Fugle 免費即時行情

若尚未設定，網站仍可使用 TWSE／MOPS 盤後公開資料。需要盤中即時價格時，再執行：

```bash
npx wrangler secret put FUGLE_API_KEY
npx wrangler deploy
```

金鑰會由 Cloudflare 加密保存，請勿寫入程式、`.env` 或公開儲存庫。

## 必要：啟用私人持股儲存

持股損益頁使用 Cloudflare D1，不以瀏覽器儲存作為持股紀錄。手動試算不需要資料庫；新增或儲存持股需要完成以下設定。

1. 建立 D1（已有持股資料庫請沿用，不要重建）：

   ```bash
   npx wrangler d1 create tsi-portfolio
   ```

2. 將指令回傳的真實 `database_id` 加入 `wrangler.jsonc` 的最外層（不要填範例或虛構 ID）：

   ```json
   "d1_databases": [{
     "binding": "DB",
     "database_name": "tsi-portfolio",
     "database_id": "貼上剛建立資料庫回傳的 ID",
     "migrations_dir": "dist/drizzle"
   }]
   ```

3. 套用所有登入與持股資料表遷移。更新既有網站也要執行；請保留同一個資料庫：

   ```bash
   npx wrangler d1 migrations apply tsi-portfolio --remote
   npx wrangler secret put AUTH_SETUP_TOKEN
   npx wrangler deploy
   ```

   `AUTH_SETUP_TOKEN` 請使用至少 16 字元的隨機初始化碼。這不是登入密碼，也不是 Fugle 金鑰。已有至少 16 字元 `PORTFOLIO_PASSWORD` 而未設定新初始化碼時，可直接沿用它建立帳號。

4. 開啟網站，第一次會出現「建立你的登入帳號」：填入帳號（3–64 個英數字或 `. _ -`）、新密碼（12–128 字元）、確認密碼、初始化碼。建立完成後自動登入。之後使用帳號和新密碼登入。

5. 在「設定」可修改密碼；右上角可以登出。登入有效 8 小時。改密碼會取消其他裝置登入。帳號建立後可以從 Cloudflare 刪除 `AUTH_SETUP_TOKEN` 與舊 `PORTFOLIO_PASSWORD`，它們不再提供持股存取權。

`APP_AUTH_MODE` 已設為 `account`，請保留。未綁定 `DB`、未套用遷移或初始化碼缺少時，帳號建立與持股讀寫會停用。此版本為私人單人網站，禁止公開註冊；使用同一帳號登入可看到原有持股，資料所有者仍為 `cloudflare-owner`。

若使用 Cloudflare 後台，Workers → Settings → Bindings 綁定 D1（名称 `DB`），Variables and Secrets 設定初始化碼。資料表需依序套用 `dist/drizzle/` 內尚未執行的 SQL，建議使用 migrations apply，以免重複執行。更新時保留 D1 綁定、Fugle 金鑰與所有持股紀錄；不要重建資料庫。

密碼以獨立 salt 和 PBKDF2-SHA256 儲存，不存明文。登入票證使用 HttpOnly／Secure／SameSite Cookie；伺服器只保存票證雜湊。連續錯誤會暫停嘗試 15 分鐘。正式站必須使用 HTTPS。

### 忘記密碼（管理員復原）

此版本沒有 Email 重設密碼。先备份資料，再由 Cloudflare D1 管理員刪除 `cloudflare-owner` 的 auth_sessions、auth_accounts 資料；保留 portfolios。重新設定 AUTH_SETUP_TOKEN 後，再開啟網站重建帳號。不要刪除持股表或整個資料庫。

### 夜盤與即時狀態

- 期交所 `DailyMarketReportFut` 提供「官方盤後報表」，顯示 TX／MTX 最近近月契約的夜盤資料，每 5 分鐘檢查。交易歸屬日不是報價時間，資料不會標成即時。
- 交易時段依台北時間與週別推估；假日、颱風休市、臨時停盤需參考交易所公告。
- 股票 Fugle 金鑰不等於期貨行情授權。真實夜盤逐筆報價需另外接有授權的期貨來源；目前提供期交所官方即時行情入口。
- 近期報價、逾時／延遲、收盤報價、未提供時間戳與未連線分開顯示。

行情優先查 Fugle，無法取得時使用 TWSE 盤後收盤價；未涵蓋商品不填零價。手動試算仍在持股頁。此版本不自動處理分割、除權配股或已實現交易，請更新庫存成本。

### 本機測試

將 `.dev.vars.example` 複製為 `.dev.vars`，再填入真實金鑰：

```env
FUGLE_API_KEY=請填入你的_Fugle_API_Key
```

啟動本機測試：

```bash
npx wrangler dev
```

## 套件內容

- `dist/client/`：前端網站
- `dist/server/index.js`：Cloudflare Worker 與資料代理
- `dist/shared/portfolio.mjs`：共用損益公式
- `dist/drizzle/`：D1 持股與登入資料表遷移
- `wrangler.jsonc`：Cloudflare 部署設定
- `.dev.vars.example`：本機 Cloudflare 環境變數範本
- `.env.example`：一般環境變數範本

## Workers AI 免費方案與熱力圖更新（2026-10-02）

本版本改用 Cloudflare Workers AI 的 Gemma 4 模型（@cf/google/gemma-4-26b-a4b-it），不是 ChatGPT。程式固定使用免費方案支援的模型，不會改用 OpenAI 或其他付費模型。

### Cloudflare 網頁設定

1. 在帳戶 Billing / Workers 方案確認為 Workers Free。此程式不會更改帳戶訂閱；若目前是 Paid，請先在帳務頁確認改回 Free 的條件與生效時間。
2. 上傳本包的前端與 Worker 更新。
3. Workers & Pages → taiwanstock → Bindings → Add binding → Workers AI，變數名稱填 AI，儲存並部署。
4. 保留 D1 綁定 DB → 原本的 db，以及 APP_AUTH_MODE=account、登入相關 Secrets。若更新後 DB 綁定消失，重新綁定原資料庫，不要建立或刪除資料庫。
5. 登入網站，按下「產生 AI 分析」確認連線。AI 不需要 OpenAI API 金鑰；舊 OPENAI_MODEL 和 OPENAI_API_KEY 已不被使用。

Workers AI 每日有 10,000 Neurons 免費配置，UTC 00:00（台灣 08:00）重置。Workers Free 超過額度會停止請求；若帳戶是 Paid，超額仍可能收費。額度由帳戶共享，分析次數取決於輸入、輸出長度，不等同固定次數。

每個帳號每小時最多 30 次分析嘗試；僅按下按鈕才呼叫，失敗不自動重試或切換其他模型。只送公開行情與問題，不傳登入資訊或持股。行情時間與來源會保留，AI 結果需核對。

Heatmap 可點擊產業，查看分類成員、漲跌幅與成交量，並點擊股票查看個股。

已完成模擬綁定、登入與速率限制測試；未連接使用者的 Cloudflare 帳戶或執行真實模型呼叫。需上傳更新並完成 AI 綁定後驗證。

官方文件：https://developers.cloudflare.com/workers-ai/platform/pricing/
