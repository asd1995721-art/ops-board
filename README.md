# 追蹤儀表板（靜態網站）

純靜態網站：`index.html`、`assets/app.js`、`assets/style.css`，開啟時讀取 `data/dashboard-data.json`（網址加時間參數避免快取）。無框架、無建置步驟、無後端、不載入外部資源。頁面設定 `noindex` 並附 `robots.txt` 禁止搜尋引擎收錄。

## 每日更新方式（給 Codex）

每日晨報產出 `dashboard-data.json` 後：

1. 把工作區的 `.採購追蹤/reports/dashboard-data.json` 複製到本儲存庫的 `data/dashboard-data.json`（覆蓋）。
2. 只提交這一個檔並推送：

   ```bash
   git add data/dashboard-data.json
   git commit -m "更新資料"
   git push
   ```

3. GitHub Pages 約 1～2 分鐘後生效。

注意事項：

- **只更新 `data/dashboard-data.json` 這一個檔**。本儲存庫是公開的，工作區的其他檔案一律不得放入。
- 資料檔須維持 `schema_version` 1 的欄位格式；欄位變動時需同步修改 `assets/app.js`。
- 使用者需先在 Codex 對話中確認本儲存庫的位置，Codex 才執行上述更新。

## 本機預覽

瀏覽器直接開啟 `index.html` 會因安全限制讀不到資料檔，請在本資料夾執行：

```bash
python -m http.server 18931 --bind 127.0.0.1
```

再開啟 `http://127.0.0.1:18931/`。

## 尚未做的項目

- 晨報連結：`report_anchor` 目前全為 `null`，且晨報網址未定，第一版不顯示。
- 得標率圖表：待累積十件以上投標後再加。
