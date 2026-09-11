# feat(graph): 完成知識圖譜群島拓撲、0 按鈕動態實體發掘與 AI 語意對齊工具列

> **更新時間**：2026-09-10 14:54
> **專案核心**：以 Vanilla JavaScript、Firebase、Tailwind CDN 與 Google Gemini API 打造之個人大腦 PWA，支援 Local-First / BYOD 資料庫架構、無人值守雲端研讀後端、遠端 MCP Server 與 Canvas 2D 互動式知識圖譜。

## 本次對話目標

解決知識圖譜中文字重疊、節點均質球狀堆疊（缺少分群語意）問題，並探討設計知識圖譜的持續維護演化機制，達成「日常 0 按鈕前端即時關聯成邊」與「按需 1 鍵 AI 語意對齊」的最佳架構。

## 已完成任務

* **[知識圖譜物理模擬與拓撲升級（消滅圓球與文字重疊）]**：
  * 實作群島型多焦點引力（Multi-focal cluster centers），依照卡片分類指派不同角度的空間環狀錨點，將各分類節點拉向獨立群島。
  * 實作跨叢集斥力屏障（Inter-cluster repulsion barrier），同群保持凝聚、異群施加額外排斥，徹底打破傳統均質圓球堆疊。
  * 實作 LinLog 對數彈簧模型與度數自適應斥力（Degree-adaptive repulsion），讓弱關聯節點自然沉澱於外圍。
  * 實作 AABB 包圍盒文字防撞碰撞偵測與視角自動適配（`fitToView`），支援「焦點模式」與「全顯防撞模式」。
  * `js/knowledge-graph-viewer.mjs`
  * `js/knowledge-graph-data.mjs`
  * `tests/knowledge-graph-data.test.mjs`
* **[0 按鈕前端即時動態實體發掘（Zero-Button Dynamic Extraction）]**：
  * 開啟圖譜時由純前端 15ms 內完成跨篇詞頻統計，自動偵測英文縮寫（如 CLABSI、FastAPI）、駝峰式與複合技術名詞。
  * 搭配停用詞過濾（Stop Words Filter），只要未寫死名詞在 2 篇以上卡片出現即自動成立共現邊（權重 +3）。
  * `js/knowledge-graph-data.mjs`
  * `tests/knowledge-graph-data.test.mjs`
* **[AI 語意對齊工具列按鈕（Semantic Alignment Helper）]**：
  * 圖譜頂端控制列新增單色 SVG 線條按鈕，按需呼叫 Gemini Flash 模型歸納卡片樣本的同義詞與跨領域抽象概念。
  * 對齊結果儲存於 `localStorage`（`my_ai_brain_dynamic_entities`），開啟圖譜時自動載入並即時局部重繪。
  * `index.html`
  * `app.js`
* **[既有任務保留（Firebase BYOD & MCP Server）]**：
  * Firebase 支援使用者本地設定 BYOD 架構，徹底避免金鑰暴露。
  * 遠端 MCP Server 支援 Streamable HTTP 與 Legacy SSE 雙通訊協議與 9 大領域工具。
  * `mcp-server/src/index.js`
  * `mcp-server/src/server.js`

## 進行中與卡點 (In Progress & Blockers)

* **目前進度**：知識圖譜視覺防撞、群島拓撲、0 按鈕動態抽取與 AI 語意對齊按鈕全數完成，全套 119 項單元測試通過，已部署至 `main` 分支。
* **下一步**：觀察實際卡片筆數大幅成長時（超過 500 篇）之力導向效能，評估是否將物理模擬遷移至 Web Worker 或加入 Barnes-Hut 樹狀演算法。
* **卡點 (Blocker)**：無。

## 避坑指南 (Failed Approaches)

* **嘗試過的方法**：傳統單中心力導向加上單純調大斥力（Repulsion）。
  * **為什麼失敗**：均質向心力會把所有節點拉向原點形成實心大圓球，調大斥力只會等比例放大球體直徑，節點依然在球面外緣均勻堆積，完全缺乏拓撲結構與分群特徵。
  * **教訓**：必須依分類設定多焦點（Multi-focal anchors），並在跨分類節點間加入空間斥力懲罰屏障（Inter-cluster barrier），才能自然形成群島效應。
* **嘗試過的方法**：在圖譜上強制每次自動發送卡片給 AI Agent 重建索引。
  * **為什麼失敗**：成本高、延遲長（需等數秒甚至數十秒），且每次開啟圖譜或新增卡片都會消耗 API 配額，破壞流暢閱讀體驗。
  * **教訓**：95% 拓撲連線應採用純前端正則與詞頻統計（0 延遲、0 成本），僅在需要跨領域同義詞提煉時才提供按需 1 鍵 AI 輔助。
* **嘗試過的方法**（保留既有）：分步複製與刪除 `details/note` 子集合。
  * **為什麼失敗**：分步執行非原子操作，中途若斷線會遺失卡片或殘留孤兒筆記資料。
  * **教訓**：全數使用 Firestore `runTransaction` 保證搬移與刪除的原子性。
* **嘗試過的方法**（保留既有）：傳統 URL Query Token (`?token=...`) 認證與僅支援舊版 SSE 傳輸。
  * **為什麼失敗**：URL Token 會留存於代理伺服器日誌中造成金鑰洩漏；且 MCP 2025-11-25 規範已由 Streamable HTTP (`/mcp`) 取代舊版 SSE。
  * **教訓**：強制採用 Header `Authorization: Bearer` 與常數時間比對，以 Streamable HTTP 為主力、Legacy SSE 為向後相容 fallback。

## 關鍵決策 (Key Decisions)

* **[群島拓撲架構代替 PCA / UMAP 靜態降維]**：
  * **原因**：PCA / t-SNE / UMAP 需要依賴完整的卡片向量嵌入（Embeddings）與重矩陣運算，在純靜態前端難以實時更新；採用多焦點引力（Multi-focal anchors）+ LinLog 彈簧模型，能在純前端 15ms 內達到高辨識度的群島分群效果，並保持節點拖曳互動性。
  * **被否決的方案**：每次計算呼叫 Embedding API 產生 768 維向量再做 PCA 投影（計算量大且拖慢互動）。
* **[0 按鈕動態抽取 + 1 鍵語意對齊分流]**：
  * **原因**：兼顧日常 0 延遲體驗與深度語意理解，日常記錄專有名詞（如 FastAPI、CLABSI）出現兩次即自動成邊；遇到概念同義時再由使用者手動點擊「語意對齊」快取至 `localStorage`。
  * **被否決的方案**：兩個繁複按鈕（全庫重構與單次更新），或每次強制由 AI 背景掃描。
* **[自建專屬 Domain MCP 而非泛用型 Firestore MCP]**（保留既有）：
  * **原因**：專屬 MCP 提供 `move_item`、`batch_classify_items` 等高階語意工具，自動處理 Editor.js JSON 封裝、`order` 排序與子集合遷移，大幅降低 Agent Token 消耗與路徑出錯率。
  * **被否決的方案**：直接使用現成 `@firebase/mcp-server`。

## 交接備忘錄 (Handover Context)

目前程式碼位於 `main` 分支，工作目錄乾淨。
接手此專案的第一步，請先閱讀 `/home/cdc/CCdevelopment/my-ai-brain/CURRENT_STATE.md`。
若要驗證前端功能與圖譜演算法，請在專案根目錄執行 `npm test`（目前共 119 項測試通過）；
若要啟動本地靜態伺服器驗證介面，可執行 `npx serve .` 或以瀏覽器直接開啟 `index.html`；
若要進行 MCP 伺服器驗證，請進入 `mcp-server/` 目錄執行 `npm test`。
