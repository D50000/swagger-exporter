#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * openapi-to-xlsx
 * Generate an Excel workbook from an OpenAPI 3.x spec.
 */

const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const https = require('https');
const { program } = require('commander');
const ExcelJS = require('exceljs');
const SwaggerParser = require('@apidevtools/swagger-parser');
const yaml = require('js-yaml');

// --------------------------- CLI ---------------------------
program
  .name('openapi-to-xlsx')
  .description('Generate an Excel workbook from an OpenAPI 3.x spec / Swagger UI URL.')
  .requiredOption('--url <url>', 'Swagger UI URL, OpenAPI JSON URL, or local file path')
  .option('--token <bearer>', 'Bearer token used when fetching from a URL')
  .option('--out <file>', 'Output xlsx file path (default: <api-title>-<version>.xlsx)')
  .option('--insecure', 'Ignore TLS certificate errors (for self-signed https)', false)
  .parse(process.argv);

const opts = program.opts();

if (opts.insecure) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

// --------------------------- helpers ---------------------------
function isHttpUrl(s) {
  return /^https?:\/\//i.test(s);
}

async function httpGet(url, token) {
  const headers = { Accept: 'application/json, text/html, */*' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const fetchOpts = { headers };

  // For HTTPS with --insecure, disable certificate validation
  if (opts.insecure && url.startsWith('https:')) {
    fetchOpts.agent = new https.Agent({ rejectUnauthorized: false });
  }

  const res = await fetch(url, fetchOpts);
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status} ${res.statusText}`);
  }
  return res;
}

/**
 * Try hard to obtain the OpenAPI JSON object from whatever URL/path the user gave us.
 */
async function loadSpec(input, token) {
  // 1) local file
  if (!isHttpUrl(input)) {
    const abs = path.resolve(input);
    console.log(`[load] local file: ${abs}`);
    let raw = fs.readFileSync(abs, 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // strip UTF-8 BOM
    try {
      return yaml.load(raw);
    } catch (e) {
      throw new Error(`Failed to parse local file as JSON or YAML: ${e.message}`);
    }
  }

  // 2) http(s) - first attempt
  console.log(`[load] GET ${input}`);
  const res = await httpGet(input, token);
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  let text = await res.text();
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM if any

  // try parse as JSON/YAML directly
  const isPossibleSpec =
    contentType.includes('json') ||
    contentType.includes('yaml') ||
    contentType.includes('yml') ||
    text.trim().startsWith('{') ||
    text.trim().startsWith('openapi:') ||
    text.trim().startsWith('swagger:');

  if (isPossibleSpec) {
    try {
      const obj = yaml.load(text);
      if (obj && (obj.openapi || obj.swagger)) return obj;
    } catch (e) {
      // fall through to HTML parsing
    }
  }

  // 3) probably the Swagger UI HTML - extract the real spec URL from it
  let specUrl = extractSpecUrlFromHtml(text, input);

  // 3a) If HTML references swagger-initializer.js, try to fetch that
  if (!specUrl && /swagger-initializer\.js/.test(text)) {
    const initUrl = new URL('swagger-initializer.js', input).toString();
    console.log(`[load] fetching initializer: ${initUrl}`);
    try {
      const initRes = await httpGet(initUrl, token);
      const initJs = await initRes.text();
      specUrl = extractSpecUrlFromHtml(initJs, input);
    } catch (e) {
      console.warn(`[warn] failed to fetch initializer: ${e.message}`);
    }
  }

  // 3b) If we found a configUrl, fetch that to get the real spec URL
  if (specUrl && /swagger-config/.test(specUrl)) {
    console.log(`[load] fetching config: ${specUrl}`);
    try {
      const cfgRes = await httpGet(specUrl, token);
      const cfg = await cfgRes.json();
      if (cfg && cfg.url) {
        specUrl = new URL(cfg.url, input).toString();
        console.log(`[load] resolved from config: ${specUrl}`);
      } else if (cfg && Array.isArray(cfg.urls) && cfg.urls[0] && cfg.urls[0].url) {
        specUrl = new URL(cfg.urls[0].url, input).toString();
        console.log(`[load] resolved from config: ${specUrl}`);
      }
    } catch (e) {
      console.warn(`[warn] failed to fetch config: ${e.message}`);
    }
  }

  if (!specUrl) {
    throw new Error(
      `Could not detect spec URL from HTML at ${input}. ` +
      `Please pass the OpenAPI JSON/YAML URL directly.`
    );
  }

  console.log(`[load] detected spec URL in HTML: ${specUrl}`);
  const res2 = await httpGet(specUrl, token);
  const text2 = await res2.text();
  let obj2;
  try {
    obj2 = yaml.load(text2);
  } catch (e) {
    throw new Error(`Failed to parse fetched spec from ${specUrl}: ${e.message}`);
  }
  if (!obj2 || (!obj2.openapi && !obj2.swagger)) {
    throw new Error(`Fetched ${specUrl} but it doesn't look like an OpenAPI doc.`);
  }
  return obj2;
}

/**
 * Look inside a Swagger UI page HTML and find the spec URL.
 */
function extractSpecUrlFromHtml(html, baseUrl) {
  const patterns = [
    // Explicit url property (e.g. url: "http://...") using word boundary
    { re: /\burl\s*:\s*['"]([^'"]+)['"]/i, priority: 1 },
    // Inside a urls array (e.g. urls: [{url: "http://..."}])
    { re: /\burls\s*:\s*\[\s*\{\s*url\s*:\s*['"]([^'"]+)['"]/i, priority: 2 },
    // Common variable names used for spec URL definition
    { re: /\b(?:defaultDefinitionUrl|definitionUrl|specUrl)\s*=\s*['"]([^'"]+)['"]/i, priority: 3 },
    // fetch("http://...")
    { re: /\bfetch\s*\(\s*['"]([^'"]+)['"]\s*\)/i, priority: 4 },
    // Any string ending with /swagger.json, /openapi.json, etc.
    { re: /['"]([^'"]+\/(?:swagger|openapi)\.(?:json|yaml|yml))['"]/i, priority: 5 },
    // Any string containing v2/swagger.json or v3/openapi.json etc.
    { re: /['"]([^'"]+\/(?:v2|v3|v31)\/[^'"]+\.(?:json|yaml|yml))['"]/i, priority: 6 }
  ];

  let bestMatch = null;
  let bestPriority = Infinity;

  for (const { re, priority } of patterns) {
    // Match globally in the html string
    const matches = html.matchAll(new RegExp(re.source, re.flags + 'g'));
    for (const m of matches) {
      if (m && m[1] && priority < bestPriority) {
        try {
          const candidate = m[1].trim();
          // Skip validatorUrl if it doesn't end with JSON/YAML
          if (candidate.includes('validator.swagger.io/validator') && !candidate.endsWith('.json') && !candidate.endsWith('.yaml')) {
            continue;
          }
          bestMatch = new URL(candidate, baseUrl).toString();
          bestPriority = priority;
        } catch (e) {
          /* ignore invalid URLs */
        }
      }
    }
  }

  // Fallback: search for any string ending in .json, .yaml, or .yml
  if (!bestMatch) {
    const anyJsonYamlRe = /['"]([^'"]+\.(?:json|yaml|yml)(?:\?[^'"]*)?)['"]/gi;
    let match;
    while ((match = anyJsonYamlRe.exec(html)) !== null) {
      const candidate = match[1].trim();
      if (!candidate.includes('package.json') && !candidate.includes('tsconfig.json')) {
        try {
          bestMatch = new URL(candidate, baseUrl).toString();
          break;
        } catch (e) {
          /* ignore */
        }
      }
    }
  }

  return bestMatch;
}

/**
 * Sheet name sanitizer
 */
function makeSheetNamer() {
  const used = new Set();
  return function nameFor(method, urlPath) {
    let raw = `${method.toUpperCase()} ${urlPath}`;
    let clean = raw.replace(/[:\\/\?\*\[\]]/g, '_').replace(/^'+|'+$/g, '_');
    if (clean.length > 31) clean = clean.slice(0, 31);
    let candidate = clean;
    let i = 1;
    while (used.has(candidate)) {
      const suffix = `~${i++}`;
      candidate = clean.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(candidate);
    return candidate;
  };
}

/**
 * Render any JS value into multi-line readable text.
 */
function formatValue(val, indent = 0) {
  const pad = '  '.repeat(indent);
  if (val === null || val === undefined) return `${pad}(none)`;
  const t = typeof val;
  if (t === 'string' || t === 'number' || t === 'boolean') return `${pad}${val}`;
  if (Array.isArray(val)) {
    if (val.length === 0) return `${pad}[]`;
    return val
      .map((x, i) => {
        if (x && typeof x === 'object') {
          return `${pad}- [${i}]\n${formatValue(x, indent + 1)}`;
        }
        return `${pad}- ${x}`;
      })
      .join('\n');
  }
  if (t === 'object') {
    const keys = Object.keys(val);
    if (keys.length === 0) return `${pad}{}`;
    return keys
      .map((k) => {
        const v = val[k];
        if (v && typeof v === 'object') {
          return `${pad}${k}:\n${formatValue(v, indent + 1)}`;
        }
        return `${pad}${k}: ${v}`;
      })
      .join('\n');
  }
  return `${pad}${String(val)}`;
}

/**
 * Walk a (dereferenced) JSON Schema and produce a representative example value.
 */
function generateExample(schema, depth = 0, seen = new WeakSet()) {
  if (!schema || typeof schema !== 'object') return null;
  if (depth > 8) return '...';
  if (seen.has(schema)) return null;
  seen.add(schema);

  if (schema.example !== undefined) return schema.example;
  if (schema.examples) {
    const first = Array.isArray(schema.examples)
      ? schema.examples[0]
      : Object.values(schema.examples)[0];
    if (first && typeof first === 'object' && 'value' in first) return first.value;
    if (first !== undefined) return first;
  }
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];

  if (Array.isArray(schema.allOf) && schema.allOf.length) {
    const merged = {};
    for (const s of schema.allOf) {
      const v = generateExample(s, depth + 1, seen);
      if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(merged, v);
    }
    if (Object.keys(merged).length) return merged;
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length) {
    return generateExample(schema.oneOf[0], depth + 1, seen);
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length) {
    return generateExample(schema.anyOf[0], depth + 1, seen);
  }

  const type = schema.type || (schema.properties ? 'object' : null);

  switch (type) {
    case 'object': {
      const obj = {};
      const props = schema.properties || {};
      for (const k of Object.keys(props)) {
        obj[k] = generateExample(props[k], depth + 1, seen);
      }
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        obj['<key>'] = generateExample(schema.additionalProperties, depth + 1, seen);
      }
      return obj;
    }
    case 'array': {
      return [generateExample(schema.items || {}, depth + 1, seen)];
    }
    case 'string': {
      switch (schema.format) {
        case 'date': return '2025-01-01';
        case 'date-time': return '2025-01-01T00:00:00Z';
        case 'uuid': return '00000000-0000-0000-0000-000000000000';
        case 'email': return 'user@example.com';
        case 'uri':
        case 'url': return 'https://example.com';
        case 'byte': return 'base64string';
        case 'binary': return '<binary>';
        case 'password': return '********';
        default: return 'string';
      }
    }
    case 'integer': return 0;
    case 'number': return 0;
    case 'boolean': return false;
    default: return null;
  }
}

/**
 * Pick the JSON-ish content schema from an OpenAPI content map.
 */
function pickJsonSchema(content) {
  if (!content || typeof content !== 'object') return null;
  const keys = Object.keys(content);
  const jsonKey =
    keys.find((k) => /^application\/json\b/i.test(k)) ||
    keys.find((k) => /\+json\b/i.test(k)) ||
    keys[0];
  if (!jsonKey) return null;
  return content[jsonKey] && content[jsonKey].schema ? content[jsonKey].schema : null;
}

function safeJsonStringify(v) {
  try {
    return JSON.stringify(v, null, 2);
  } catch (e) {
    return String(v);
  }
}

/**
 * Build a filesystem-safe filename fragment from any string.
 */
function slugify(s, fallback = 'openapi-spec') {
  if (!s) return fallback;
  return String(s)
    .trim()
    .replace(/[\\\/:\*\?"<>\|]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || fallback;
}

// --------------------------- build ---------------------------
async function build() {
  // 1. Load + dereference
  const rawSpec = await loadSpec(opts.url, opts.token);

  const cloneForDeref = JSON.parse(JSON.stringify(rawSpec));
  let spec;
  try {
    spec = await SwaggerParser.dereference(cloneForDeref, {
      dereference: { circular: 'ignore' },
    });
  } catch (e) {
    console.warn(`[warn] dereference failed (${e.message}). Falling back to raw spec.`);
    spec = rawSpec;
  }

  // 2. Collect operations
  const METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];
  const nameFor = makeSheetNamer();
  const ops = [];
  const paths = spec.paths || {};
  for (const p of Object.keys(paths)) {
    const pathItem = paths[p] || {};
    for (const m of Object.keys(pathItem)) {
      if (!METHODS.includes(m)) continue;
      const op = pathItem[m] || {};
      const sheetName = nameFor(m, p);
      ops.push({
        method: m.toUpperCase(),
        path: p,
        tag: (op.tags && op.tags[0]) || '',
        summary: op.summary || '',
        description: op.description || '',
        operationId: op.operationId || '',
        deprecated: !!op.deprecated,
        security: op.security || spec.security || null,
        parameters: op.parameters || [],
        requestBody: op.requestBody || null,
        responses: op.responses || {},
        sheetName,
      });
    }
  }
  console.log(
    `[spec] openapi=${spec.openapi || spec.swagger} title=${spec.info && spec.info.title} ` +
    `paths=${Object.keys(paths).length} ops=${ops.length}`
  );

  // 3. Workbook
  const wb = new ExcelJS.Workbook();
  wb.creator = 'openapi-to-xlsx';
  wb.created = new Date();

  // 3a. Index sheet
  const indexWs = wb.addWorksheet('API List', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  indexWs.columns = [
    { header: 'No.', key: 'idx', width: 6 },
    { header: 'Method', key: 'method', width: 10 },
    { header: 'API Endpoint', key: 'path', width: 55 },
    { header: 'Category', key: 'tag', width: 18 },
    { header: 'Summary', key: 'summary', width: 60 },
    { header: 'Operation ID', key: 'operationId', width: 35 },
    { header: 'Detail', key: 'detail', width: 12 },
  ];

  const headerRow = indexWs.getRow(1);
  headerRow.font = { bold: true, size: 11, name: 'Calibri', color: { argb: 'FFFFFF' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1976D2' } };
  headerRow.height = 22;
  indexWs.autoFilter = { from: 'A1', to: 'G1' };

  ops.forEach((o, i) => {
    const row = indexWs.addRow({
      idx: i + 1,
      method: o.method,
      path: o.path,
      tag: o.tag,
      summary: o.summary,
      operationId: o.operationId,
      detail: '',
    });

    row.font = { name: 'Calibri', size: 10 };
    row.alignment = { vertical: 'middle', wrapText: false };
    if (i % 2 === 0) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
    }

    const methodCell = row.getCell('method');
    methodCell.alignment = { horizontal: 'center', vertical: 'middle' };
    const methodColors = {
      GET: { bg: 'FFE8F5E9', fg: 'FF2E7D32' },
      POST: { bg: 'FFE3F2FD', fg: 'FF1565C0' },
      PUT: { bg: 'FFFFF3E0', fg: 'FFEF6C00' },
      PATCH: { bg: 'FFF3E5F5', fg: 'FF6A1B9A' },
      DELETE: { bg: 'FFFFEBEE', fg: 'FFC62828' },
    };
    const mc = methodColors[o.method];
    if (mc) {
      methodCell.font = { bold: true, color: { argb: mc.fg }, size: 10, name: 'Calibri' };
      methodCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: mc.bg } };
    }

    row.getCell('path').font = { name: 'Consolas', size: 9, color: { argb: 'FF37474F' } };

    if (o.deprecated) {
      row.getCell('summary').font = {
        italic: true,
        strikethrough: true,
        color: { argb: 'FF9E9E9E' },
        size: 10,
        name: 'Calibri'
      };
    }

    const cell = row.getCell('detail');
    cell.value = {
      text: 'Open',
      hyperlink: `#'${o.sheetName.replace(/'/g, "''")}'!A1`,
      tooltip: `${o.method} ${o.path}`,
    };
    cell.font = { color: { argb: 'FF0563C1' }, underline: 'single', bold: true, size: 10, name: 'Calibri' };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // 3b. Detail sheets
  for (const o of ops) {
    const ws = wb.addWorksheet(o.sheetName);
    ws.columns = [
      { header: 'Field', key: 'field', width: 24 },
      { header: 'Value', key: 'value', width: 110 },
    ];

    const dHeaderRow = ws.getRow(1);
    dHeaderRow.font = { bold: true, size: 11, name: 'Calibri', color: { argb: 'FFFFFF' } };
    dHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF455A64' } };
    dHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };
    dHeaderRow.height = 20;

    const addRow = (k, v, opts = {}) => {
      const r = ws.addRow({ field: k, value: v });
      r.getCell('field').font = {
        bold: true,
        size: 10,
        name: 'Calibri',
        color: opts.fieldColor || { argb: 'FF263238' }
      };
      r.getCell('field').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: opts.fieldBg || 'FFECEFF1' }
      };
      r.getCell('field').alignment = { vertical: 'top', horizontal: 'left', indent: 1 };

      r.getCell('value').font = {
        size: opts.mono ? 9 : 10,
        name: opts.mono ? 'Consolas' : 'Calibri',
        color: opts.valueColor || { argb: 'FF37474F' }
      };
      r.getCell('value').fill = opts.valueBg ? {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: opts.valueBg }
      } : undefined;
      r.getCell('value').alignment = { vertical: 'top', wrapText: true };
      return r;
    };

    addRow('Method', o.method, { valueBg: 'FFE3F2FD' });
    addRow('API Endpoint', o.path, { mono: true, valueBg: 'FFF5F5F5' });
    addRow('Category', o.tag);
    addRow('Operation ID', o.operationId, { mono: true });
    addRow('Summary', o.summary);
    addRow('Description', o.description);
    addRow('Deprecated', String(o.deprecated), {
      valueBg: o.deprecated ? 'FFFFEBEE' : undefined
    });
    if (o.security) addRow('Security', formatValue(o.security), { mono: true });
    if (o.parameters && o.parameters.length) {
      addRow('Parameters', formatValue(o.parameters), { mono: true, valueBg: 'FFFFF8E7' });
    }

    if (o.requestBody) {
      addRow('Request document', formatValue(o.requestBody), {
        fieldBg: 'FFE8F5E9',
        fieldColor: { argb: 'FF2E7D32' },
        mono: true
      });

      const reqSchema = pickJsonSchema(o.requestBody.content);
      if (reqSchema) {
        const example = generateExample(reqSchema);
        addRow('Request example', safeJsonStringify(example), {
          mono: true,
          valueBg: 'FFE8F5E9'
        });
      }
    }

    if (o.responses) {
      for (const code of Object.keys(o.responses)) {
        const resp = o.responses[code];
        const isSuccess = /^2\d\d$/.test(code);
        const isClientErr = /^4\d\d$/.test(code);
        const isServerErr = /^5\d\d$/.test(code);

        let respBg = 'FFE3F2FD';
        let respFieldBg = 'FFBBDEFB';
        let respFieldColor = { argb: 'FF1565C0' };
        if (isSuccess) {
          respBg = 'FFE8F5E9';
          respFieldBg = 'FFC8E6C9';
          respFieldColor = { argb: 'FF2E7D32' };
        } else if (isClientErr) {
          respBg = 'FFFFF3E0';
          respFieldBg = 'FFFFE0B2';
          respFieldColor = { argb: 'FFEF6C00' };
        } else if (isServerErr) {
          respBg = 'FFFFEBEE';
          respFieldBg = 'FFFFCDD2';
          respFieldColor = { argb: 'FFC62828' };
        }

        addRow(`Response document (${code})`, formatValue(resp), {
          fieldBg: respFieldBg,
          fieldColor: respFieldColor,
          mono: true,
          valueBg: respBg
        });

        const respSchema = pickJsonSchema(resp && resp.content);
        if (respSchema) {
          const example = generateExample(respSchema);
          addRow(`Response example (${code})`, safeJsonStringify(example), {
            mono: true,
            valueBg: respBg
          });
        }
      }
    }

    const backRow = ws.addRow({ field: '', value: '' });
    const backCell = backRow.getCell('field');
    backCell.value = {
      text: '<< Back to API List',
      hyperlink: "#'API List'!A1",
    };
    backCell.font = {
      color: { argb: 'FF0563C1' },
      underline: 'single',
      bold: true,
      size: 10,
      name: 'Calibri'
    };
  }

  // 4. Save to ./export/ directory
  const exportDir = path.join(process.cwd(), 'archived');
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  const defaultName = `${slugify(spec.info && spec.info.title, 'openapi-spec')}` +
    (spec.info && spec.info.version ? `-${slugify(spec.info.version, 'v')}` : '') +
    '.xlsx';

  const outPath = opts.out
    ? path.resolve(opts.out)
    : path.join(exportDir, defaultName);

  await wb.xlsx.writeFile(outPath);
  console.log(`[done] wrote ${outPath}`);
}

build().catch((e) => {
  console.error(`[error] ${e.stack || e.message || e}`);
  process.exit(1);
});