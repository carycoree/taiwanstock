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

## OpenAI 分析與熱力圖更新（2026-10-02）

本次更新需同時部署 `dist/server/index.js` 與 `dist/client/`，僅新增金鑰不會替舊網站加入功能。沿用現有 taiwanstock Worker、DB → db 綁定和登入設定。這次不新增資料表、不需要重建 DB。

### 取得 OpenAI API 金鑰

1. 開啟 https://platform.openai.com/ ，登入並建立專案（例如 TaiwanStock）。
2. 在 https://platform.openai.com/settings/organization/billing/overview 設定 API 付款／可用額度。API 按用量計費，請檢查帳務頁與 Usage。
3. 開啟 https://platform.openai.com/api-keys ，選擇網站專案並建立新的 Secret Key，名稱可用 TaiwanStock-Cloudflare。
4. 將金鑰存入密碼管理器並貼至 Cloudflare Secret。不要放在前端或傳到對話裡。

### Cloudflare 網頁設定

Workers & Pages → taiwanstock → Settings → Variables and Secrets → Add：

| 名稱 | Type | 值 |
| --- | --- | --- |
| OPENAI_API_KEY | Secret | 你的 OpenAI API 金鑰 |
| OPENAI_MODEL | Text | gpt-4o-mini |
| APP_AUTH_MODE | Text | account（保留原設定） |

儲存並 Deploy 至正式版本（100% 流量）。DB 綁定仍必須叫 DB，值仍選既有 db。不要以新 Worker 取代原網站。

### 使用與驗證

- 在「AI 分析」按「產生 AI 分析」；可填入最多500字的問題，之後的追問為根據當次行情的新分析，並不保存聊天歷史。
- 「AI Market Brief」也有市場／夜盤分析按鈕。夜盤只使用期交所盤後報表，不能當作即時夜盤報價。
- 沒有金鑰時顯示設定提示；登入後 /api/ai/status 僅顯示 configured 與 model，不回傳金鑰。
- 金鑰錯誤、額度受限、模型不可用與逾時有明確提示。沒有足夠行情不呼叫 AI。
- 每個帳號每小時最多30次 API 嘗試；按下按鈕才呼叫。OpenAI request 設定 store:false；本服務不保存分析內容。這不等同 OpenAI Zero Data Retention。
- 只傳公開行情與使用者輸入的問題；不自動传送持股、登入帳號、密碼或初始化碼。
- 原均線結論為「規則判讀」，AI 模型結果另行標示。移除原先以價格偏離均線推算的信心百分比。
- Heatmap 點類股可查看上市公司股票、收盤價、漲跌幅、成交股數，依漲／跌／成交量排序，篩選上漲股，再點股票進入研究。強勢標記代表類股漲幅前五且上漲，並非模型選股。
- 成分股清單依 TWSE 公司產業分類與可用當日行情對照，不代表指數權重名單；上櫃股票不混入上市類股。無法對應的類股不使用猜測清單。

程式已做模擬 API 與登入／限制測試。未使用真實 OpenAI 金鑰進行付費呼叫；需設定金鑰、部署更新後驗證正式連線。
