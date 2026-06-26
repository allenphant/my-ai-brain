# 動態自訂分類與 AI 魔法提示詞架構設計 (Design Spec)

## 1. 核心目標 (Context & Purpose)
將「我的筆記區」從原先寫死的四大分類（待辦、學習、點子、收藏），升級為「使用者可完全自訂」的動態分類系統。
此系統必須支援拖曳自訂排序、分類屬性切換（待辦/純文字），並且結合 Gemini API 實現高精準度的 AI 自動分類與使用者自訂分類規則。

## 2. 資料庫 Schema 設計 (Database Architecture)
採用 **獨立子集合 (Subcollection)** 方案，充分利用 Firestore 的 `onSnapshot` 即時同步特性與現有的小數點排序邏輯。

- **路徑**: `/artifacts/{appId}/users/{uid}/categories/{categoryId}`
- **資料結構 (Document Model)**:
  - `name` (String): 分類名稱，例如 "購物清單"
  - `icon` (String): FontAwesome 樣式，例如 "fas fa-shopping-cart"
  - `type` (String): 顯示模式，支援 `"todo"` (待辦清單，具備 Checkbox) 與 `"text"` (純文字)
  - `promptRule` (String): 使用者自訂的 AI 分類規則（Prompt Injection）
  - `order` (Number): 小數點排序值 (Fractional Index)，用於 UI 拖曳排序

## 3. 使用者介面設計 (UI/UX Design)

### 3.1 進入點 (Entry Point)
- 於頂部右側現有「⚙️ 設定」按鈕旁，新增一個「🏷️ 管理分類」按鈕。

### 3.2 分類管理面板 (Category Manager Modal)
彈出式管理介面，分為兩區塊：
1. **列表區 (List View)**: 
   - 顯示所有自訂分類。
   - 支援 SortableJS 上下拖曳排序，拖曳結束後自動更新該文件的 `order` 值。
2. **編輯表單區 (Edit Form)**:
   - **名稱輸入框**：分類的顯示名稱。
   - **圖示選擇器 (Icon Picker)**：提供 15~20 個高質感的 FontAwesome 常用圖示按鈕供直接點選（取代手動輸入字串）。
   - **模式切換**：`📝 純文字模式` 與 `✅ 待辦清單模式` 的明顯切換按鈕。
   - **AI 魔法規則 (Prompt Rule)**：多行文字框。
     - ✨ **Copilot 建議功能**：輸入框旁設置「✨ 讓 AI 給建議」按鈕。點擊時，立刻調用 Gemini API，根據當前的「分類名稱」，自動生成並填入一段適合的分類規則建議（例如：判斷類別為"購物清單"，AI 建議填入"只要提到買、補貨、超市等字眼皆歸類於此"）。

### 3.3 主畫面動態渲染 (Main Board Rendering)
- 移除 `index.html` 寫死的四個卡片區塊。
- 監聽 `/categories` 的 `onSnapshot` 事件，根據 `order` 順序動態生成卡片容器（Grid 佈局）。
- 新增碎片的「分類下拉選單」也改由這份清單動態生成選項。

## 4. AI 魔法整理邏輯設計 (AI Dynamic Prompt Engine)

為解決字串比對的脆弱性，全面改用 **ID Mapping (ID 映射)** 機制。

1. **資料準備**：擷取 Inbox 內所有碎片，組裝成包含 ID 的物件陣列：`[{ "id": "doc_123", "text": "買牛奶" }]`。
2. **動態 Text Prompt**：將使用者建立的分類清單（包含 ID、名稱與 promptRule）組裝成一段說明書，並明確指示 AI 如果都不符合則放進 `unclassified`。
3. **動態 JSON Schema**：根據使用者實際的 Category IDs 動態生成 Gemini 的 `responseSchema`。
   ```json
   {
     "type": "OBJECT",
     "properties": {
       "cat_001": { "type": "ARRAY", "items": { "type": "STRING" } },
       "cat_002": { "type": "ARRAY", "items": { "type": "STRING" } },
       "unclassified": { "type": "ARRAY", "items": { "type": "STRING" } }
     }
   }
   ```
4. **批次更新 (Batch Update)**：收到 AI 回傳的精準 ID 清單後，前端使用 Firestore 的寫入操作，將各碎片移動到對應的分類集合（或寫入對應的 categoryId 標記）。

## 5. 後續實作步驟規劃 (Implementation Steps)
1. **資料結構與 UI 實作**：建立 Category Manager Modal，實作 CRUD 與拖曳排序。
2. **動態渲染重構**：將主畫面改為動態讀取 Categories 並綁定個別的 `onSnapshot`。
3. **AI 引擎升級**：實作「✨ 讓 AI 給建議」功能，並改寫主按鈕的 AI 動態 Schema 與 ID Mapping 邏輯。
