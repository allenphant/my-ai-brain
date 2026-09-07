# 系統設計規格書：2D 知識圖譜視覺化 (Knowledge Graph View) 與雙向鏈結漫遊系統

- **文件日期**：2026-09-07
- **狀態**：使用者已確認 (Approved)
- **架構原則**：2D Canvas 輕量物理模擬、純客戶端運算 (零 GCP 帳單風險)、特徵偵測觸控適配、單色 SVG 線條設計、Obsidian 風格雙向鏈結

---

## 1. 背景與目標

### 1.1 背景
在完成 Wave 2 與 Wave 3 全庫多模態解析與標籤同步後，知識大腦已具備 577 張結構化卡片與豐富的技術實體關聯。後端 MCP 已實作 `get_knowledge_graph` 工具，但前端網頁介面仍缺乏直觀的網絡視覺化瀏覽工具。使用者需要在瀏覽器中以直觀的 2D 關聯星空圖探索知識脈絡，擺脫傳統單一分類的割裂感。

### 1.2 核心目標
1. **全螢幕沉浸式互動 (Fullscreen Modal View)**：由頂部工具列一鍵啟動 2D 關聯圖譜畫布，具備縮放 (Zoom)、拖曳 (Pan) 與節點拖拉能力。
2. **零雲端費用與高效能 (Zero-Cost & 60 FPS)**：直接從前端現有快取（`currentItemsByCollection` / `currentInboxItems`）在客戶端記憶體中構建拓撲，不對 Firebase 發送額外計費查詢。
3. **特徵偵測觸控適配 (Touch Feature Detection)**：不使用螢幕寬度，嚴格使用特徵偵測判斷觸控環境，提供雙指縮放與加大的觸控感應熱區。
4. **雙向鏈結脈絡抽屜 (Knowledge Inspector Drawer)**：點擊任一節點時，右側展開抽屜展示卡片詳情、TL;DR 摘要與所有關聯節點清單，並支援點擊跳轉漫遊。
5. **單色 SVG 設計規範**：所有按鈕、圖示與節點狀態完全採用單色 SVG 線條，禁止出現任何彩色 emoji。

---

## 2. 系統架構與資料流

```
+-------------------------------------------------------------------+
|                        使用者操作介面                             |
|  頂部導覽列按鈕 (#knowledge-graph-btn) -> 開啟 #knowledge-graph-modal |
+-------------------------------------------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------+
|                     圖譜模組 (js/knowledge-graph.mjs)              |
|                                                                   |
| 1. 資料管道 (Data Pipeline)                                       |
|    讀取 app.js 記憶體卡片 -> buildClientGraphData() 計算節點與關聯邊  |
|                                                                   |
| 2. 物理模擬引擎 (ForceSimulation2D)                                |
|    - 斥力 (Charge Repulsion, -120)                                |
|    - 彈簧連桿引力 (Link Spring Force, distance: 80, strength: 0.2)  |
|    - 中心重力 (Center Gravity, 0.05)                               |
|    - 速度阻尼與衰減 (Alpha Decay: 0.02)                            |
|                                                                   |
| 3. Canvas 2D 渲染引擎 (GraphCanvasRenderer)                        |
|    - Retina 高 DPI 自適應 (window.devicePixelRatio)               |
|    - 節點繪製：依權重決定半徑，分類色彩分群，聚焦發光環             |
|    - 邊線繪製：依權重決定寬度與透明度，相鄰高亮，非相關淡化         |
|                                                                   |
| 4. 互動手勢管理器 (GraphInteractionManager)                        |
|    - 特徵偵測：('ontouchstart' in window) || (maxTouchPoints > 0)  |
|    - 滑鼠滾輪 / 雙指捏合縮放 (Pinch-to-zoom, 0.2x ~ 4.0x)         |
|    - 畫布平移 (Pan) / 節點拖動 (Drag Node)                        |
|    - 點擊命中測試 (Hit-testing with touch padding)                |
+-------------------------------------------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------+
|               右側知識脈絡抽屜 (#knowledge-graph-drawer)           |
| - 標題、所屬分類徽章、技術標籤                                      |
| - TL;DR 摘要與筆記內文重點                                         |
| - 關聯節點雙向鏈結清單 (點擊漫遊切換)                               |
| - 「在看板中定位」按鈕 (跳轉並高亮卡片)                            |
+-------------------------------------------------------------------+
```

---

## 3. 詳細模組規格

### 3.1 介面結構 (`index.html`)

1. **進入點按鈕**：
   位於頂部導覽列 `#tag-browser-btn` 旁邊：
   - 按鈕 ID：`#knowledge-graph-btn`
   - 圖示：單色 SVG 關聯節點圖示。
   - 文字：知識圖譜。

2. **全螢幕 Modal 架構 (`#knowledge-graph-modal`)**：
   - 頂部導覽欄：
     - 搜尋框：支援模糊過濾節點，動態縮放鏡頭至匹配項目。
     - 實體膠囊：列出高頻實體（`Claude Code`、`MCP`、`Obsidian`、`Cursor`、`Codex`、`Tailwind` 等），點擊即篩選。
     - 重設視野按鈕：重置平移與縮放至預設視角。
     - 關閉按鈕：關閉 Modal 並暫停 Canvas 動畫循環以節省效能。
   - 主畫布容器：`<canvas id="knowledge-graph-canvas"></canvas>`。
   - 脈絡抽屜 (`#knowledge-graph-drawer`)：寬度 360px，預設收合於右側，選取節點時平滑滑入。

### 3.2 拓撲資料計算 (`buildClientGraphData`)

- **實體表對齊**：與後端 MCP `graph.js` 的 35 個核心技術實體保持完全對齊。
- **節點屬性**：
  - `id`: 卡片 ID
  - `title`: 卡片標題（由 Note 標題區塊或文字前綴提取）
  - `category`: 所屬分類 ID
  - `tags`: 標籤名稱陣列
  - `entities`: 匹配到的技術實體清單
  - `tldr`: 卡片重點摘要
  - `x`, `y`, `vx`, `vy`: 物理模擬位置與速度向量
  - `radius`: 節點繪製半徑（根據總連線數動態賦予 6px ~ 16px）
- **關聯邊計算規則**：
  - 兩節點若共享技術實體：每共享 1 個實體權重 +3。
  - 兩節點若共享受控標籤：每共享 1 個標籤權重 +2。
  - 權重 `>= 2` 建立雙向連線。

### 3.3 物理引擎 (`ForceSimulation2D`)

- 採用微型物理引擎（內建 Verlet 積分器）：
  - **Repulsion**：所有節點互相排斥（庫倫定律反平方近似）。
  - **Spring**：相鄰連線產生引力，彈簧自然長度 90px。
  - **Center**：輕微引力拉向畫布中心，避免圖譜飄散。
  - **Damping**：速度阻尼系數 0.92，每幀衰減 alpha，當系統動能低於閥值時自動進入睡眠狀態，停止重繪以節省電力。

### 3.4 特徵偵測與互動支援

- **特徵偵測**：
  ```javascript
  const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  const hitRadiusPadding = isTouchDevice ? 12 : 4;
  ```
- **手勢支援**：
  - 單指 / 滑鼠左鍵拖曳空白處：平移畫布（Pan）。
  - 單指 / 滑鼠左鍵點擊或拖曳節點：固定節點位置並即時高亮相鄰脈絡（Drag & Inspect）。
  - 滾輪 / 雙指捏合：以滑鼠或觸控中心點為錨點進行縮放（Zoom 0.2x ~ 4x）。
  - 點擊空白畫布：取消選取，收合抽屜，恢復全域亮度。

---

## 4. 測試與驗證要點

1. **單元與邏輯測試**：
   - 驗證 `buildClientGraphData` 能正確從卡片集合產出節點與邊線。
   - 驗證權重計算公式符合實體與標籤規則。
2. **渲染與效能驗證**：
   - 驗證在 60 FPS 物理模擬下無畫面撕裂或卡頓。
   - 驗證在 Retina / 高分屏下線條不模糊。
   - 驗證 Modal 關閉後，`requestAnimationFrame` 完全停止，CPU 佔用率歸零。
3. **觸控與無障礙驗證**：
   - 驗證在無滑鼠環境下，特徵偵測正確啟用觸控熱區擴展。
   - 驗證無任何 emoji，全數為單色 SVG。
