# OpenAPI to XLSX (Swagger Exporter)

這是一個基於 Node.js 撰寫的 CLI 工具，能將 OpenAPI 3.x 規範（Swagger 規格書）自動轉換為設計精美、結構清晰且具備內部超連結的 Excel 工作簿（`.xlsx` 檔案）。

不論是本地 JSON/YAML 檔案，抑或是 Swagger UI 的網頁 URL，本工具皆能嘗試自動解析並匯出完整的文件對照表。

---

## 🌟 核心特色

1. **多來源支援**：
   - 支援本地 OpenAPI/Swagger JSON 檔案。
   - 支援遠端 JSON/YAML URL 規格。
   - **自動 HTML 解析**：可直接輸入 Swagger UI 的網頁 URL（例如 `https://petstore.swagger.io/`），程式會自動解析並尋找底下的 Spec URL（包含解析 `swagger-initializer.js` 與 `swagger-config`）。
2. **直覺的目錄索引（API List）**：
   - 建立所有 API 的彙整清單（HTTP 方法、Endpoint、分類標籤、Summary、Operation ID）。
   - 依照 HTTP Method（GET, POST, PUT, PATCH, DELETE）自動套用對應的品牌顏色與底色，便於視覺識別。
   - 提供「Open」超連結，點擊即可直接跳轉至對應 API 的詳細規格工作表（Detail Sheet）。
3. **詳盡的 API 詳細表單（Detail Sheet）**：
   - 為每個 API 建立獨立的工作表，包含：方法、Endpoint、安全驗證（Security）、詳細參數（Parameters）、請求範例（Request Body & Request Example）。
   - **狀態碼語意顏色**：回應文件（Responses）與範例依狀態碼自動著色（`2xx` 綠色代表成功、`4xx` 橘色代表用戶端錯誤、`5xx` 紅色代表伺服器端錯誤）。
   - 提供「<< Back to API List」連結，方便快速回到總表。
4. **穩健的解析與展示**：
   - 使用 `@apidevtools/swagger-parser` 進行規範解析與循環引用處理。
   - 自動生成符合 schema 定義的模擬 JSON 請求/回應範例。

---

## ⚙️ 系統需求

* **Node.js**: `v18` 或更高版本。

---

## 📦 安裝步驟

1. 確保已將此專案複製至本地。
2. 於專案根目錄下執行以下指令以安裝所需依賴套件：
   ```bash
   npm install
   ```

---

## 🚀 使用說明

本工具主要透過 `build.js` 檔案來執行，可以利用 `node build.js` 或透過 `npm` 腳本執行。

### 命令列參數 (CLI Options)

| 參數 | 說明 | 必填 | 預設值 |
| :--- | :--- | :---: | :--- |
| `--url <url>` | 本地 JSON 檔案路徑、OpenAPI JSON 網址或 Swagger UI 網頁網址。 | **是** | - |
| `--token <bearer>` | 若 API 規格書網址需要身分驗證，可傳入 Bearer Token。 | 否 | - |
| `--out <file>` | 輸出的 `.xlsx` 檔案路徑。 | 否 | `archived/<api-title>-<version>.xlsx` |
| `--insecure` | 忽略 SSL/TLS 憑證錯誤（適用於測試環境的自簽憑證）。 | 否 | `false` |

---

### 💻 執行範例

#### 1. 解析本地 OpenAPI JSON 檔案
```bash
node build.js --url ./ly-v2-spec.json
```
*這將會在 `archived/` 目錄下自動生成一個以 API 標題命名的 `.xlsx` 檔案。*

#### 2. 解析遠端 OpenAPI JSON 網址
```bash
node build.js --url https://petstore.swagger.io/v2/swagger.json
```

#### 3. 直接解析 Swagger UI 網頁網址
```bash
node build.js --url https://petstore.swagger.io/
```
*程式會先下載該 HTML 網頁，偵測 Spec URL 後下載真正的 JSON 資料進行轉換。*

#### 4. 指定輸出檔案路徑
```bash
node build.js --url ./ly-v2-spec.json --out ./exports/my_api_document.xlsx
```

#### 5. 攜帶 Bearer Token 進行驗證
如果讀取 Swagger JSON 規格需要登入憑證：
```bash
node build.js --url https://api.example.com/swagger/v1/swagger.json --token "your_bearer_token_here"
```

#### 6. 忽略 SSL 憑證檢查（自簽憑證）
```bash
node build.js --url https://dev-server/swagger/v1/swagger.json --insecure
```

#### 7. 透過 npm 腳本執行
在 `package.json` 中已定義 `gen` 腳本，您也可以這樣執行（注意中間需要有 `--` 分隔符號傳遞參數）：
```bash
npm run gen -- --url ./ly-v2-spec.json
```

---

## 📊 Excel 匯出格式結構說明

### 1. API List 工作表 (首頁目錄)
* **No.**：流水號。
* **Method**：HTTP 方法，附帶顏色區分：
  * **GET** (綠底綠字)
  * **POST** (藍底藍字)
  * **PUT** (橘底橘字)
  * **PATCH** (紫底紫字)
  * **DELETE** (紅底紅字)
* **API Endpoint**：API 的路徑（以等寬字型 Consolas 顯示）。
* **Category**：API 分類（來自 OpenAPI Tags）。
* **Summary**：API 概要說明（若標示為 `deprecated` 則會套用刪除線與灰字）。
* **Operation ID**：API 唯一識別碼。
* **Detail**：提供超連結文字「Open」，點選後直接定位跳轉至該 API 的細部規格工作表。

### 2. API 詳細規格工作表 (Detail Sheets)
每個 API 會依據 `METHOD /path` 的組合生成獨立的工作表（工作表名稱會自動縮減並過濾特殊字元以符合 Excel 31 個字元的上限）。
* 欄位包含：
  * **API 基本資訊**：Method、API Endpoint、Category、Operation ID、Summary、Description、Deprecated。
  * **安全驗證**：列出該 API 要求的 Security Schemes。
  * **參數清單 (Parameters)**：詳細列出 Query、Path、Header 參數及其定義。
  * **請求格式 (Request Document)**：如果有 Request Body，顯示其資料結構。
  * **請求範例 (Request Example)**：自動生成的 JSON 請求格式範例（以 Consolas 顯示並上色）。
  * **回應狀態碼說明與範例**：
    * **2xx 成功**：綠色系列標示，包含 Response schema 與 JSON 範例。
    * **4xx 用戶端錯誤**：黃/橘色系列標示。
    * **5xx 伺服器端錯誤**：紅色系列標示。
  * **回目錄超連結**：最底部的 `<< Back to API List`，點選即可回到主目錄。

---

## 🛠️ 技術組件與模組

* **`loadSpec()`**: 智慧解析模組。判斷輸入是本地檔案還是 URL。如果是 URL 且回傳 HTML，則調用 `extractSpecUrlFromHtml()` 解析 Swagger 頁面結構以取得真正的規格 JSON。
* **`generateExample()`**: 範例生成器。遞迴走訪 JSON Schema，從 `example`、`default` 或 `enum` 中擷取資訊，或是根據資料型態（`string`、`integer`、`boolean`、`date-time` 等）生成模擬欄位值。
* **`makeSheetNamer()`**: 確保工作表名稱不重複且不超過 31 個字元（Excel 的限制），並清除 Excel 不支援的特殊符號。