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

## 套件內容

- `dist/client/`：前端網站
- `dist/server/index.js`：Cloudflare Worker 與資料代理
- `wrangler.jsonc`：Cloudflare 部署設定

