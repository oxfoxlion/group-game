# 同頻嗎？

1–10 刻度的即時多人派對遊戲。前端使用 Vite，可部署至 Vercel；房間連線由 `LineLanguageBot` 的 Socket.IO 服務提供。

## 本機開發

1. 在 `LineLanguageBot` 執行 `npm run dev`（預設 port 3000）。
2. 在本專案複製 `.env.example` 為 `.env.local`。
3. 執行 `npm run dev`，開啟 Vite 顯示的網址。

題目位於 [`questions.md`](./questions.md)。每題用 `##` 開頭，下一行用 `左：...｜右：...` 設定刻度兩端說明，最多讀取 10 題。

## Vercel

在 Vercel 設定環境變數：

```text
VITE_SOCKET_URL=https://你的後端網址
```

後端的 `CORS_ORIGIN` 需加入 Vercel 正式網址；多個網址以逗號分隔。房間只保存在後端記憶體，伺服器重啟或房間閒置兩小時後會消失。
