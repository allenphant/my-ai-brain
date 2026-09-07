# 2D 知識圖譜視覺化 (Knowledge Graph View) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 為「我的筆記區」實作全螢幕 2D 知識圖譜互動檢視器，支援物理力導向模擬、雙向鏈結脈絡抽屜、檢索聚焦與觸控手勢適配。

**Architecture:** 採純前端 Local-First 架構，直接從已載入之記憶體卡片與標籤中提取節點與加權關聯邊；使用 HTML5 Canvas 2D 自行實作輕量 Force-Directed 物理引擎；嚴格以特徵偵測（`('ontouchstart' in window) || (navigator.maxTouchPoints > 0)`）適配觸控熱區與雙指縮放；全面採用單色 SVG 線條設計，零外部重量級相依性，零 GCP 計費風險。

**Tech Stack:** 原生 JavaScript (ES Modules), HTML5 Canvas 2D, Tailwind CSS, Node.js Test Runner.

## Global Constraints

- 永遠禁止在任何回覆、引導、說明、文件或程式碼註解中使用任何 emoji（無論任何情境均嚴格禁用）。
- 用繁體中文顯示回應和引導，但專有名詞保留英文。
- 判斷裝置時，不要使用螢幕寬度（Screen Width），應該直接使用特徵偵測（Feature Detection）：`('ontouchstart' in window) || (navigator.maxTouchPoints > 0)`。
- 開發 HTML/Web 介面時，所有的圖示都必須使用單色 SVG 線條 icon，避免使用彩色系統預設 emoji。
- 嚴格維持零 GCP 額外帳單風險，不向 Firestore 發起額外查詢。

---

### Task 1: 實作客戶端拓撲資料運算模組 (`js/knowledge-graph-data.mjs`)

**Files:**
- Create: `js/knowledge-graph-data.mjs`
- Test: `tests/knowledge-graph-data.test.mjs`

**Interfaces:**
- Produces: `export function buildClientGraphData({ cards = [], tagMap = new Map(), minWeight = 2, maxNodes = 200 }): { nodes: Array, edges: Array, entityClusters: Map }`

- [ ] **Step 1: 撰寫拓撲資料計算單元測試**

```javascript
// tests/knowledge-graph-data.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClientGraphData, TECH_ENTITIES } from '../js/knowledge-graph-data.mjs';

test('buildClientGraphData correctly calculates nodes, edges, and entity weights', () => {
  const cards = [
    {
      id: 'c1',
      col: 'learning',
      text: 'Claude Code MCP 工具開發教學',
      tagIds: ['tag-1'],
      tags: ['AI Agent']
    },
    {
      id: 'c2',
      col: 'bookmarks',
      text: 'Obsidian 與 Claude Code 打造 Agentic OS',
      tagIds: ['tag-1', 'tag-2'],
      tags: ['AI Agent', '軟體開發']
    },
    {
      id: 'c3',
      col: 'todos',
      text: '健身運動指南',
      tagIds: ['tag-3'],
      tags: ['生活與健康']
    }
  ];

  const graph = buildClientGraphData({ cards, minWeight: 2 });
  assert.equal(graph.nodes.length, 3);
  
  // c1 與 c2 共享 'Claude Code' (權重 +3) 與標籤 'AI Agent' (權重 +2) -> 權重 5 >= 2
  const edge = graph.edges.find(e => 
    (e.source === 'c1' && e.target === 'c2') || (e.source === 'c2' && e.target === 'c1')
  );
  assert.ok(edge);
  assert.equal(edge.weight, 5);

  // c3 無共享實體與標籤 -> 無邊線
  const c3Edges = graph.edges.filter(e => e.source === 'c3' || e.target === 'c3');
  assert.equal(c3Edges.length, 0);
});
```

- [ ] **Step 2: 執行測試確認失敗**

執行：`node --test tests/knowledge-graph-data.test.mjs`
預期：FAIL（找不到模組 `js/knowledge-graph-data.mjs`）。

- [ ] **Step 3: 實作 `js/knowledge-graph-data.mjs`**

實作實體表對齊（35 個核心實體）、標題與 TL;DR 萃取、權重計算、節點半徑映射邏輯。

- [ ] **Step 4: 再次執行測試確認通過**

執行：`node --test tests/knowledge-graph-data.test.mjs`
預期：PASS。

- [ ] **Step 5: 提交變更**

執行：`git add js/knowledge-graph-data.mjs tests/knowledge-graph-data.test.mjs && git commit -m "feat(graph): implement client-side knowledge graph topology builder"`

---

### Task 2: 實作 2D 物理引擎與 Canvas 渲染器 (`js/knowledge-graph-engine.mjs`)

**Files:**
- Create: `js/knowledge-graph-engine.mjs`
- Test: `tests/knowledge-graph-engine.test.mjs`

**Interfaces:**
- Produces:
  - `export class ForceSimulation2D`: 物理力導向模擬器（斥力、彈簧引力、中心重力、速度阻尼）
  - `export class KnowledgeGraphViewer`: 整合 Canvas 渲染、手勢互動（特徵偵測）、節點高亮、縮放平移

- [ ] **Step 1: 撰寫物理模擬器數學與收斂性測試**

```javascript
// tests/knowledge-graph-engine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { ForceSimulation2D } from '../js/knowledge-graph-engine.mjs';

test('ForceSimulation2D converges and dampens velocity', () => {
  const nodes = [
    { id: '1', x: 0, y: 0, vx: 10, vy: 10, radius: 10 },
    { id: '2', x: 10, y: 10, vx: -10, vy: -10, radius: 10 }
  ];
  const edges = [{ source: '1', target: '2', weight: 3 }];
  
  const sim = new ForceSimulation2D({ nodes, edges, width: 800, height: 600 });
  sim.tick(50);

  // 驗證速度在阻尼下逐漸收斂降低
  assert.ok(Math.abs(nodes[0].vx) < 5);
  assert.ok(Math.abs(nodes[0].vy) < 5);
});
```

- [ ] **Step 2: 執行測試確認失敗**

執行：`node --test tests/knowledge-graph-engine.test.mjs`
預期：FAIL。

- [ ] **Step 3: 實作 `js/knowledge-graph-engine.mjs`**

實作物理模擬、Canvas 2D 渲染、Retina 高解析調整、特徵偵測：
```javascript
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
```
包含節點點擊高亮、1-Hop 鄰居高亮、平移縮放矩陣變換。

- [ ] **Step 4: 再次執行測試確認通過**

執行：`node --test tests/knowledge-graph-engine.test.mjs`
預期：PASS。

- [ ] **Step 5: 提交變更**

執行：`git add js/knowledge-graph-engine.mjs tests/knowledge-graph-engine.test.mjs && git commit -m "feat(graph): implement 2D force simulation and canvas renderer"`

---

### Task 3: 介面整合：頂部按鈕、全螢幕 Modal 與脈絡抽屜 (`index.html`)

**Files:**
- Modify: `index.html`

- [ ] **Step 1: 在頂部工具列加入知識圖譜按鈕**

在 `#tag-browser-btn` 旁邊加入 `#knowledge-graph-btn`（單色 SVG 節點圖示，無彩色 emoji）。

- [ ] **Step 2: 在 `index.html` 加入全螢幕圖譜 Modal 與抽屜結構**

加入 `#knowledge-graph-modal`：
- 包含搜尋輸入框、實體 Chips 列、重設視野按鈕、關閉按鈕（均為單色 SVG）。
- 包含全螢幕 `<canvas id="knowledge-graph-canvas"></canvas>`。
- 包含右側 `#knowledge-graph-drawer`（標題、分類、標籤、TL;DR、雙向關聯節點列表、在看板定位按鈕）。

- [ ] **Step 3: 驗證 HTML 結構與單色圖示**

確認無任何 emoji 出現，無語法錯誤。

- [ ] **Step 4: 提交變更**

執行：`git add index.html && git commit -m "feat(ui): add knowledge graph modal, toolbar, and inspector drawer to index.html"`

---

### Task 4: 應用層事件綁定與漫遊跳轉聯動 (`app.js`)

**Files:**
- Modify: `app.js`

- [ ] **Step 1: 動態載入並初始化圖譜模組**

在點擊 `#knowledge-graph-btn` 時，動態 import `js/knowledge-graph-engine.mjs` 與 `js/knowledge-graph-data.mjs`。
從目前記憶體中的 `currentItemsByCollection` 與 `currentInboxItems` 匯集全庫卡片，建立圖譜實例並啟動渲染循環。

- [ ] **Step 2: 綁定抽屜互動與雙向漫遊跳轉**

- 當選取節點時，將卡片詳細資訊與雙向鏈結填入 `#knowledge-graph-drawer`，並平滑滑入。
- 點擊抽屜中的關聯節點，直接平滑移動畫布鏡頭並聚焦該節點。
- 點擊「在看板中定位」，關閉圖譜 Modal，平滑滾動主頁至該卡片並添加短暫的 Indigo 光暈動畫。

- [ ] **Step 3: 綁定搜尋輸入框與實體 Chips 快速過濾**

搜尋或點擊 Chip 時，圖譜自動高亮並聚焦相應節點。

- [ ] **Step 4: 提交變更**

執行：`git add app.js && git commit -m "feat(app): wire knowledge graph modal and interactive navigation to app.js"`

---

### Task 5: 完整端到端驗證與程式碼審查

**Files:**
- Verify: `index.html`, `app.js`, `js/knowledge-graph-*.mjs`, `tests/*.mjs`

- [ ] **Step 1: 執行既有與新增測試套件**

執行：`npm test`（含根目錄與 mcp-server）。

- [ ] **Step 2: 檢驗規範相符性**

1. 特徵偵測：確認無任何以螢幕寬度判斷行動裝置的程式碼，均採用 `('ontouchstart' in window) || (navigator.maxTouchPoints > 0)`。
2. 圖示：全局搜尋確認無任何 emoji，皆為單色 SVG 線條。
3. 零 GCP 計費：確認圖譜開啟與漫遊無任何額外 Firestore 查詢。

- [ ] **Step 3: 提交並推送至遠端**

執行：`git commit -m "feat: complete 2D knowledge graph interactive visualization"` 並 `git push origin main`。
