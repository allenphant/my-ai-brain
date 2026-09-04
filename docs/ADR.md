# Architecture Decision Record (Initial)

## 專案現狀 (Current State)
這是一個前端主導的小型專案，核心程式目前集中在 HTML ([index.html](/home/cdc/CCdevelopment/my-ai-brain/index.html:445)) 內的 module script，另有一份輔助的 Python 腳本 (patch.py)。專案使用了文件驅動的開發流程，在 `docs/superpowers` 中有明確的 spec 和 plan。

## 核心設計 (Core Design)
- **UI 渲染機制**：目前以 `index.html` 內的單一 module script 為核心，包含大量與畫面渲染與互動相關的函數，例如 `renderList`, `renderMainGrid`, `initDragAndDrop`, `escapeHtml` 等。
- **功能模組**：主要環繞著清單 (Todos, Bookmarks) 以及分類管理 (Category Manager, saveCategory)。
- **資料流**：透過 `setupRealtimeListeners` 可能有實時資料同步機制。

## 架構決策 (Decisions)
1. 採用 Vanilla JavaScript 直接操作 DOM，不依賴大型前端框架（如 React/Vue）。
2. 功能目前依賴 `index.html` 內的單一 module script 運作，按功能叢集（UI 渲染、資料操作、事件綁定）來組織代碼，形成高度內聚的模組。
