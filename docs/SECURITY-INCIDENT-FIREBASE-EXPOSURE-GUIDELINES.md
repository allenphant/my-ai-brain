# 安全事後檢討與架構指引：Firebase 公開暴露與自帶資料庫 (BYOD) 遷移

文件編號：SEC-INC-2026-09-04
建立日期：2026-09-04
狀態：已確認成因，改善方案實施中
適用專案：My Personal AI Brain (my-ai-brain)

---

## 1. 事件摘要 (Executive Summary)

本專案原定位為「個人大腦資料庫與思緒緩衝區」，並透過 GitHub Pages 提供公開預覽與跨裝置存取。然而，前端靜態資源直接寫死了作者個人的 Firebase 專案連線資訊（含 Web API Key、專案 ID 等），同時 Firebase Authentication 啟用了未限制註冊來源的 Google Sign-In，且 Firestore 安全規則僅驗證「使用者是否登入」而非「是否為資料擁有者」。

此配置導致任何獲取網址的外部訪客皆能透過自己的 Google 帳號登入，並直接將其個人資料寫入作者的私有 Firebase Firestore 資料庫，造成多租戶資料混淆、配額消耗、以及重大的未授權讀寫安全隱患。

---

## 2. 成因分析 (Root Cause Analysis - RCA)

深入檢視架構與開發歷程，本次失誤由以下四個關鍵認知盲點與實作缺陷疊加而成：

### 2.1 混淆「靜態前端託管」與「無伺服器後端 (BaaS)」的界線
開發時直覺認為：將靜態頁面部署至 GitHub Pages，而使用者以「各自的 Google 帳號」登入，資料就會「自動隔離成各自的空間」。但忽視了靜態頁面上的 Firebase SDK 所初始化的實例（Instance），本質上就是連向同一個中央資料庫（作者的專案 `my-ai-brain-6867e`）。前端只是展示層，後端資料庫並沒有因為不同人登入而分裂成不同專案。

### 2.2 前端程式碼硬編碼私有憑證 (Hardcoded Credentials)
在 `app.js` 中直接定義了作者個人專案的 `firebaseConfig`：
* `projectId`: `my-ai-brain-6867e`
* `apiKey`: `AIzaSyC30YPS_CkGVBS8IBrq74sBW0pkP1-ev6w`
* `appId`: `1:755512158785:web:8376054556e01717f9b4c0`
此段程式碼完全暴露給全世界的瀏覽器，任何訪客下載該 JS 即可直接與作者的 Firebase 伺服器建立 Session。

### 2.3 認證機制缺乏存取控制列表 (Lack of Auth Whitelist)
在 Firebase Console 的 Authentication 設定中，啟用了 Google Sign-In，但沒有配置 Cloud Functions 阻擋外部註冊，也沒有在前端或 Security Rules 設定 Email / UID 白名單，造成任何持有有效 Google 帳號的第三方都能通過身分驗證。

### 2.4 Firestore 安全性規則欠缺資料擁有權驗證 (Permissive Security Rules)
專案文檔與初始配置中採用的規則如下：
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```
此規則存在重大缺陷：只要 `request.auth` 不為空（即任何人只要登入任何 Google 帳號），該請求就享有對整個資料庫所有文件的全域讀寫權限，徹底失去了使用者隔離防線。

---

## 3. 後果 (Consequences)

1. **外部帳號自動註冊至私有 Firebase**：訪客登入時，其 Google 帳號資訊（姓名、Email、頭像與 UID）被直接建立在作者的 Firebase Authentication 用戶清單內。
2. **私有資料庫遭外部資料污染**：訪客輸入的筆記碎片、卡片、自訂分類，直接寫入作者 Firestore 的 `artifacts/my-personal-ai-brain/users/{訪客UID}/`。
3. **備份與資料維護困難**：作者若要匯出資料或執行統計分析，資料庫中夾雜大量外部訪客建立的零碎測試資料，清理成本高。

---

## 4. 影響範圍 (Blast Radius & Impact Scope)

### 4.1 受影響元件
* **Firebase Authentication**：出現非預期的外部第三方使用者帳號。
* **Cloud Firestore**：根集合 `artifacts/my-personal-ai-brain/users/` 下產生多個未知 UID 的文件樹。
* **GitHub Repository**：`README.md` 與 `package.json` 公開暴露了存取進入點。

### 4.2 未受影響元件（安全隔離處）
* **Google Gemini API**：API Key 是存放在訪客各自瀏覽器的 `localStorage` 中，訪客若未自備 Key 無法執行 AI 整理，未消耗作者的 Gemini API 配額。
* **遠端 MCP Server**：MCP Server 執行於伺服器端容器，依賴本地環境變數 `FIREBASE_SERVICE_ACCOUNT_KEY` 與嚴格的 Bearer Token 驗證，未對公開網路開放無授權存取。

---

## 5. 可能風險 (Potential Risks)

1. **免費額度枯竭 (Denial of Service via Quota Exhaustion)**：
   Cloud Firestore 免費層級限制為每日 50,000 次讀取、20,000 次寫入。若訪客高頻使用或撰寫爬蟲腳本寫入，將在數分鐘內耗盡作者全專案的每日配額，導致作者本人的手機與電腦端應用全面停擺。
2. **非預期財務帳單 (Financial Liability)**：
   若 Firebase 專案升級至 Blaze Plan（隨用隨付），惡意攻擊者或大量訪客灌入巨量文字與卡片，將直接產生高額的儲存費與網路傳輸費。
3. **法律與合規風險**：
   在未明確向使用者提供隱私權政策與服務條款的情況下，在作者私有資料庫中收集、儲存第三方的個人筆記或機密內容，可能涉及個資保護法規之爭議。

---

## 6. 最壞的情況 (Worst-Case Scenarios)

### 6.1 作者個人機密筆記全數遭竊 (Data Exfiltration)
在 `request.auth != null` 的規則下，任何訪客只需登入自己的 Google 帳號，並打開瀏覽器開發者工具（DevTools Console），輸入以下腳本：
```javascript
const snapshot = await getDocs(collection(db, "artifacts", "my-personal-ai-brain", "users"));
```
即可遍歷整個資料庫，讀取作者所有的待辦事項、個人私密靈感、收藏連結、甚至記在筆記裡的敏感帳號或工作紀錄。

### 6.2 資料庫全域勒索或惡意清除 (Data Destruction)
惡意攻擊者可撰寫批次刪除指令，將 `artifacts/` 底下包含作者本人 UID 在內的所有文件全部清空（`deleteDoc`），造成作者永久遺失累積的知識大腦與筆記。

### 6.3 專案淪為惡意內容暫存庫與帳號停權 (Platform Ban)
外部使用者可將此未防護的資料庫作為匿名貼文板或非法內容分發點，一旦遭檢舉，作者個人的 Google Cloud 帳號可能面臨停權或法律追訴。

---

## 7. 解決方法與應變程序 (Remediation & Action Plan)

### 7.1 即時止血步驟 (Immediate Containment)
1. **下架公開連結**：已完成。立即從 `README.md` 與專案描述中移除 GitHub Pages 直連網址，阻斷公開搜尋流量。
2. **修復 Firestore Security Rules**：前往 Firebase Console -> Firestore -> 規則，立即發布以下規則，強制落實 UID 隔離：
   ```javascript
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /artifacts/{appId}/users/{userId}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```
   若要完全禁止所有外人存取，只允許作者本人，應將 `request.auth.uid == userId` 改為：
   ```javascript
   allow read, write: if request.auth != null && request.auth.uid == "作者的_FIREBASE_UID";
   ```
3. **資料庫清查與孤兒資料刪除**：
   前往 Firebase Console -> Authentication 清查非本人建立的帳號；並前往 Firestore Database 檢查 `artifacts/my-personal-ai-brain/users/` 目錄，將未知 UID 的目錄手動刪除。

### 7.2 根本架構改善：落實「自帶資料庫模式 (BYOD)」
將前端設計從「中央專屬式」轉變為「開源無狀態客戶端」：
1. **代碼解耦**：徹底移除 `app.js` 中的預設硬編碼 `firebaseConfig`。
2. **客戶端儲存**：在系統設定彈窗新增 Firebase Config 輸入框，並將設定妥善保存在各使用者瀏覽器的 `localStorage`。
3. **無設定保護**：當使用者初次開啟且未設定時，系統進入引導模式，各項寫入與登入功能停用，不發起任何對外連線，保證零成本、零洩漏。

---

## 8. 未來開發防範守則 (Engineering Best Practices)

為杜絕此類架構與安全失誤再次發生，往後開發應嚴格遵守以下原則：

1. **永不在公開前端程式碼中寫死任何具個人歸屬權的後端連線設定**。
2. **靜態開源專案應預設為「無狀態 (Stateless)」或「BYOD 範本」**，任何涉及後端資料庫的連線必須由部署者或使用者於本地端提供。
3. **Firebase 安全規則設計原則：永不使用寬鬆的 `request.auth != null` 作為生產環境規則**，所有規則都必須以「資源歸屬者（Resource Owner）」為授權基準：
   `request.auth.uid == resource.data.userId` 或 `request.auth.uid == userId`。
4. **雲端專案必設預算警報 (Budget Alerts)**：在 Google Cloud Console 中為每個個人專案設定 1 美元、5 美元之預算上限與警報通知，避免帳單失控。
