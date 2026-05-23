# OpenAPI to XLSX (Swagger Exporter)

A robust Node.js-based CLI utility that converts OpenAPI 3.x and Swagger 2.0 specifications into elegant, professionally styled, and fully hyperlinked Excel workbooks (`.xlsx`).

Whether you provide a local JSON/YAML file, a direct remote spec URL, or a Swagger UI webpage URL, the tool automatically resolves, parses, and exports a comprehensive API catalog.

---

## 🌟 Key Features

1. **Flexible Source Ingestion**:
   - Parses local OpenAPI/Swagger files in both **JSON** and **YAML** formats.
   - Fetches remote spec URLs.
   - **Automated Swagger UI HTML Extraction**: Accepts a Swagger UI URL directly (e.g., `https://petstore.swagger.io/`). It automatically extracts the underlying specification URL by parsing the HTML, `swagger-initializer.js`, or the `swagger-config` endpoints.
2. **Interactive API Directory (`API List` Sheet)**:
   - Generates a consolidated table of all API endpoints featuring HTTP methods, tags, summaries, and Operation IDs.
   - Distinct HTTP method branding (GET in green, POST in blue, PUT in orange, PATCH in purple, DELETE in red) for rapid visual scanning.
   - Embeds "Open" hyperlinks for instant jumping to the dedicated dedicated detailed worksheet.
3. **Granular Detail Sheets**:
   - Generates an isolated worksheet for each API operation (names sanitized and truncated to meet the Excel 31-character limit).
   - Includes full metadata: Method, Endpoint, Category, Operation ID, Summary, Description, Deprecated status, Security schemes, and Parameters.
   - **Semantic Response Styling**: Color-codes API response documents and simulated payload examples based on HTTP status codes (2xx Success in green, 4xx Client Error in orange, 5xx Server Error in red).
   - Back-navigation hyperlinks (`<< Back to API List`) at the bottom of every sheet.
4. **Robust Schema Resolution & Mocking**:
   - Powered by `@apidevtools/swagger-parser` to handle complex schema dereferencing and circular dependencies.
   - Dynamically generates representative mock JSON payloads for both requests and responses based on schema rules.

---

## ⚙️ System Requirements

* **Node.js**: `v18` or higher.

---

## 📦 Installation

1. Clone or download this repository.
2. In the root directory of the project, run:
   ```bash
   npm install
   ```

---

## 🚀 Usage

Execute the tool directly with Node.js or run it via the pre-configured npm scripts.

### CLI Options

| Option | Description | Required | Default |
| :--- | :--- | :---: | :--- |
| `--url <url>` | Path to a local JSON/YAML file, a direct OpenAPI URL, or a Swagger UI webpage URL. | **Yes** | - |
| `--token <bearer>` | Bearer token to include in the Authorization header when fetching from a remote URL. | No | - |
| `--out <file>` | Custom file path for the output `.xlsx` file. | No | `archived/<api-title>-<version>.xlsx` |
| `--insecure` | Bypass TLS/SSL certificate validation (useful for self-signed development servers). | No | `false` |

---

### 💻 Execution Examples

#### 1. Parse a Local OpenAPI YAML or JSON File
```bash
node build.js --url ./ly-v2-spec.yaml
```
*This exports the parsed workbook to the `archived/` directory by default, named after the API title.*

#### 2. Convert a Remote OpenAPI JSON/YAML Specification
```bash
node build.js --url https://petstore.swagger.io/v2/swagger.json
```

#### 3. Parse a Swagger UI Webpage URL Directly
```bash
node build.js --url https://petstore.swagger.io/
```
*The utility fetches the webpage HTML, dynamically extracts the spec URL from the UI bundle setup, downloads the schema, and executes the build.*

#### 4. Specify a Custom Output Path
```bash
node build.js --url ./ly-v2-spec.json --out ./exports/my_api_document.xlsx
```

#### 5. Authenticate via Bearer Token
For secured Swagger endpoints requiring authorization:
```bash
node build.js --url https://api.example.com/swagger/v1/swagger.json --token "your_bearer_token_here"
```

#### 6. Skip SSL Verification (Self-Signed Certificates)
```bash
node build.js --url https://dev-server/swagger/v1/swagger.json --insecure
```

#### 7. Execute via npm Scripts
You can pass arguments to the npm script using the `--` separator:
```bash
npm run gen -- --url ./ly-v2-spec.yaml
```

---

## 📊 Excel Output Structure

### 1. The `API List` Sheet (Index)
* **No.**: Auto-incremented sequence number.
* **Method**: Styled badge representing the HTTP verb:
  * **GET** (Green text on light green background)
  * **POST** (Blue text on light blue background)
  * **PUT** (Orange text on light orange background)
  * **PATCH** (Purple text on light purple background)
  * **DELETE** (Red text on light red background)
* **API Endpoint**: The endpoint path, styled with a monospaced `Consolas` font.
* **Category**: Category label derived from OpenAPI tags.
* **Summary**: Short description of the operation (styled with a strikethrough and gray text if the API is marked as `deprecated`).
* **Operation ID**: The unique API operation identifier.
* **Detail**: An interactive `Open` hyperlink that jumps directly to the operation's detailed sheet.

### 2. Operation Detail Sheets
Every API route is compiled into its own sheet, named according to its unique `METHOD /path` signature.
* **Metadata Fields**: Basic information including HTTP Method, Endpoint, Tag/Category, Operation ID, Summary, Description, and Deprecation flags.
* **Security & Authentication**: Lists the security schemes required to execute the API.
* **Parameters Table**: Formatted list of query, path, and header parameters, along with their schemas and descriptions.
* **Request & Response Schema Representation**: Displays the object properties and types.
* **Autogenerated Mock Payloads**: Valid mock JSON request/response objects (styled using monospaced Consolas) to assist developers in testing.
* **Semantic Status Groups**:
  * **Success (2xx)**: Green highlight, with response documentation and mockup.
  * **Client Error (4xx)**: Orange/yellow highlight, displaying validation or authorization schemas.
  * **Server Error (5xx)**: Red highlight, showing error response structure.
* **Navigation Link**: A `<< Back to API List` link located at the bottom of the worksheet.

---

## 🛠️ Key Technical Modules

* **`loadSpec()`**: Resolves input sources. For local paths, it reads and parses YAML or JSON. For URLs, it fetches the content and attempts JSON/YAML parsing; if it receives HTML, it delegates to `extractSpecUrlFromHtml()` to locate the underlying spec URL.
* **`generateExample()`**: Recursively traverses OpenAPI schemas, utilizing `example`, `default`, or `enum` values when present, or generating logical placeholder data depending on data types (e.g., ISO date-times, mock emails, UUIDs).
* **`makeSheetNamer()`**: Dynamically filters characters invalid in Excel worksheet names, handles name collisions, and truncates names to a maximum of 31 characters.

  TODO: electron app
