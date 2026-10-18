/**
 * server.js
 * 零相依套件的小型後端：
 *   - 提供前端靜態檔案（index.html、css/、js/、vendor/）
 *   - POST /api/analyze      第二階段的 LLM 分析（需 LLM_API_KEY，否則回 503）
 *   - POST /api/submissions  記錄一份問卷結果（含暱稱）
 *   - GET  /api/submissions  列出已記錄的結果（僅供本機查看）
 * 資料以 JSON 檔存在 data/submissions.json。
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");

// 讀取專案根目錄的 .env（沒有就略過）；系統已設定的環境變數優先
try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch (e) {
  if (e.code !== "ENOENT") console.warn("讀取 .env 失敗：", e.message);
}
const llm = require("./llm");

const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "submissions.json");
const PORT = Number(process.env.PORT) || 3000;
// 本機預設只聽 127.0.0.1；雲端平台（如 Railway）的代理要連得進來，必須聽 0.0.0.0
const HOST = process.env.HOST || (process.env.RAILWAY_ENVIRONMENT || process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const MAX_BODY_BYTES = 100 * 1024;
const NICKNAME_MAX = 20;
const ANALYZE_LIMIT = { max: 10, windowMs: 60_000 }; // 每個 IP 每分鐘最多幾次，避免額度被刷

// 只公開前端會用到的檔案，避免 server/、data/、.git 被讀走
const PUBLIC_PATHS = [/^\/$/, /^\/index\.html$/, /^\/(css|js|vendor)\/[\w./-]+$/];
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

// ---- 儲存 ----

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

// 單一行程內的寫入以 Promise 串接，避免同時寫入互相覆蓋
let writeQueue = Promise.resolve();

function append(record) {
  const task = writeQueue.then(async () => {
    const all = readAll();
    all.push(record);
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(all, null, 2));
    await fs.promises.rename(tmp, DATA_FILE);
  });
  writeQueue = task.catch(() => { });
  return task;
}

// ---- 驗證 ----

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** 回傳 { error } 或 { record }；只留下白名單欄位。 */
function validate(body) {
  if (!isPlainObject(body)) return { error: "請求內容必須是 JSON 物件" };

  const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
  if (!nickname) return { error: "請輸入暱稱" };
  if ([...nickname].length > NICKNAME_MAX) return { error: `暱稱最多 ${NICKNAME_MAX} 個字` };

  const { phase1, phase2 } = body;
  if (!isPlainObject(phase1) || !isPlainObject(phase1.answers)) return { error: "缺少第一階段結果" };
  if (!isPlainObject(phase2) || !Array.isArray(phase2.responses)) return { error: "缺少第二階段結果" };

  return {
    record: {
      id: crypto.randomUUID(),
      nickname,
      submittedAt: new Date().toISOString(),
      phase1,
      phase2,
    },
  };
}

// ---- 簡易限流 ----

const hits = new Map(); // ip -> [timestamps]

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < ANALYZE_LIMIT.windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 1000) {
    for (const [key, times] of hits) {
      if (now - times[times.length - 1] >= ANALYZE_LIMIT.windowMs) hits.delete(key);
    }
  }
  return recent.length > ANALYZE_LIMIT.max;
}

// ---- HTTP ----

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("內容過大"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** 第二階段的 LLM 分析；任何失敗都回非 2xx，前端會改用關鍵字版。 */
async function handleAnalyze(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "不支援此方法" });
  }
  if (!llm.isConfigured()) return sendJson(res, 503, { error: "未設定 LLM_API_KEY" });
  if (rateLimited(req.socket.remoteAddress)) return sendJson(res, 429, { error: "請求太頻繁，請稍後再試" });

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    const status = e.status || 400;
    return sendJson(res, status, { error: status === 413 ? "內容過大" : "JSON 格式錯誤" });
  }
  const responses = body && body.responses;
  const valid =
    Array.isArray(responses) &&
    responses.length > 0 &&
    responses.length <= 10 &&
    responses.every((r) => r && typeof r.prompt === "string" && typeof r.text === "string");
  if (!valid) return sendJson(res, 400, { error: "回答格式錯誤" });

  try {
    return sendJson(res, 200, await llm.analyze(responses));
  } catch (e) {
    console.error("LLM 分析失敗：", e.message);
    return sendJson(res, 502, { error: "LLM 分析失敗" });
  }
}

async function handleApi(req, res, pathname) {
  if (pathname === "/api/analyze") return handleAnalyze(req, res);
  if (pathname !== "/api/submissions") return sendJson(res, 404, { error: "找不到此 API" });

  if (req.method === "POST") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      const status = e.status || 400;
      return sendJson(res, status, { error: status === 413 ? "內容過大" : "JSON 格式錯誤" });
    }
    const { error, record } = validate(body);
    if (error) return sendJson(res, 400, { error });
    await append(record);
    return sendJson(res, 201, { id: record.id });
  }

  if (req.method === "GET") {
    // 部署到公開網址後，這個清單不能被任何人讀走；只允許本機直接連線（經代理轉發的請求不算）
    const addr = req.socket.remoteAddress || "";
    const isLocal = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(addr) && !req.headers["x-forwarded-for"];
    if (!isLocal) return sendJson(res, 403, { error: "僅供本機查看" });
    return sendJson(res, 200, readAll());
  }

  res.setHeader("Allow", "GET, POST");
  return sendJson(res, 405, { error: "不支援此方法" });
}

function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (e) {
    res.writeHead(400).end();
    return;
  }
  if (decoded.includes("..") || !PUBLIC_PATHS.some((re) => re.test(decoded))) {
    res.writeHead(404).end("Not found");
    return;
  }
  const file = path.join(ROOT, decoded === "/" ? "index.html" : decoded);
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : data);
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (pathname.startsWith("/api/")) {
    handleApi(req, res, pathname).catch((e) => {
      console.error(e);
      sendJson(res, 500, { error: "伺服器錯誤" });
    });
  } else {
    serveStatic(req, res, pathname);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Robo-Advisor 已啟動：http://${HOST}:${PORT}`);
  console.log(llm.isConfigured() ? "第二階段分析：LLM" : "第二階段分析：關鍵字（未設定 LLM_API_KEY）");
});
