/**
 * server.js
 * 简易 HTTP 服务，提供 Web UI 与 API：
 *  - GET /           ：返回表单页面
 *  - GET /config     ：返回当前配置默认值
 *  - GET /solve      ：根据查询参数计算并返回 JSON 结果
 *  - GET /excel      ：根据查询参数计算并返回 Excel 文件下载
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { solveTopK } = require("./src/solver");
const { exportToExcel } = require("./src/export");
const { xianfangRows } = require("./src/data");
const { Worker } = require("worker_threads");
const os = require("os");

const PORT = 3000;
const PUBLIC_DIR = path.resolve(__dirname, "public");
const CONFIG_PATH = path.resolve(__dirname, "config.json");

// Worker pool for concurrent solveTopK to support multiple users
class WorkerPool {
  constructor(workerPath, size) {
    this.workerPath = workerPath;
    this.size = Math.max(1, Number(size) || 1);
    this.idle = [];
    this.queue = [];
    this.currentTasks = new Map();
    for (let i = 0; i < this.size; i++) this._spawn();
  }
  _spawn() {
    const worker = new Worker(this.workerPath);
    worker.on("message", (msg) => {
      const task = this.currentTasks.get(worker);
      if (task) {
        this.currentTasks.delete(worker);
        if (msg && msg.ok) task.resolve(msg.results);
        else task.reject(new Error((msg && msg.error) || "Worker failed"));
      }
      this.idle.push(worker);
      this._dequeue();
    });
    worker.on("error", (err) => {
      const task = this.currentTasks.get(worker);
      if (task) {
        this.currentTasks.delete(worker);
        task.reject(err);
      }
      this._replace(worker);
    });
    worker.on("exit", (code) => {
      const task = this.currentTasks.get(worker);
      if (task) {
        this.currentTasks.delete(worker);
        task.reject(new Error(`Worker exited with code ${code}`));
      }
      this._replace(worker);
    });
    this.idle.push(worker);
  }
  _replace(oldWorker) {
    const i = this.idle.indexOf(oldWorker);
    if (i >= 0) this.idle.splice(i, 1);
    this._spawn();
    this._dequeue();
  }
  _run(worker, payload, resolve, reject) {
    this.currentTasks.set(worker, { resolve, reject });
    worker.postMessage(payload);
  }
  _dequeue() {
    if (!this.queue.length || !this.idle.length) return;
    const worker = this.idle.pop();
    const job = this.queue.shift();
    this._run(worker, job.payload, job.resolve, job.reject);
  }
  runTask(payload) {
    return new Promise((resolve, reject) => {
      const worker = this.idle.pop();
      if (worker) this._run(worker, payload, resolve, reject);
      else this.queue.push({ payload, resolve, reject });
    });
  }
}
// Default concurrency: CPU cores - 1 (keep 1 core for main thread)
const POOL = new WorkerPool(
  path.resolve(__dirname, "src/solve-worker.js"),
  Math.max(1, (os.cpus()?.length || 2) - 1)
);

/**
 * 配置缓存：避免每次请求同步读取磁盘
 * - 启动时加载一次
 * - 通过 fs.watchFile 监听变更并热更新缓存
 */
let CONFIG_CACHE = {};
function reloadConfig() {
  try {
    const txt = fs.readFileSync(CONFIG_PATH, "utf8");
    CONFIG_CACHE = JSON.parse(txt);
  } catch {
    CONFIG_CACHE = {};
  }
}
// 首次加载
reloadConfig();
// 监听文件变化，自动更新缓存
try {
  fs.watchFile(CONFIG_PATH, { interval: 1000 }, () => {
    reloadConfig();
    console.log("[LOG] config.json reloaded");
  });
} catch {}

function readConfig() {
  return CONFIG_CACHE;
}

function sendJson(res, obj, status = 200) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  res.end(body);
}

function sendFile(res, filePath, contentType = "text/html; charset=utf-8") {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("文件未找到");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

function handleSolve(urlObj, res) {
  const q = Object.fromEntries(urlObj.searchParams.entries());
  const target = Number(q.target);
  if (!Number.isFinite(target) || target <= 0) {
    return sendJson(res, { error: "target 参数无效（需为正数）" }, 400);
  }
  // 赠送面积（0/15/30），默认0
  let giftArea = Number(q.giftArea);
  if (!Number.isFinite(giftArea)) giftArea = 0;
  if (![0, 15, 30].includes(giftArea)) giftArea = 0;
  const effectiveTarget = target + giftArea;

  const cfg = readConfig();

  // 解析参数，命令行/前端传入优先，其次 config.json 默认
  const topK = Number(q.topK ?? cfg.topK ?? 10);
  const source = String(q.source ?? cfg.source ?? "AB").toUpperCase();

  const minArea =
    q.minArea !== undefined
      ? Number(q.minArea)
      : cfg.minArea !== undefined
      ? Number(cfg.minArea)
      : undefined;
  const maxArea =
    q.maxArea !== undefined
      ? Number(q.maxArea)
      : cfg.maxArea !== undefined
      ? Number(cfg.maxArea)
      : undefined;

  {
    const xfCommunities = urlObj.searchParams.getAll("xfCommunities");
    const options = { topK, source, minArea, maxArea, xfCommunities };
    POOL.runTask({ target: effectiveTarget, options })
      .then((results) => sendJson(res, results))
      .catch((e) => sendJson(res, { error: (e && e.message) ? e.message : String(e) }, 500));
    return;
  }
}

function handleExcel(urlObj, res) {
  const q = Object.fromEntries(urlObj.searchParams.entries());
  const target = Number(q.target);
  if (!Number.isFinite(target) || target <= 0) {
    return sendJson(res, { error: "target 参数无效（需为正数）" }, 400);
  }
  // 赠送面积（0/15/30），默认0
  let giftArea = Number(q.giftArea);
  if (!Number.isFinite(giftArea)) giftArea = 0;
  if (![0, 15, 30].includes(giftArea)) giftArea = 0;
  const effectiveTarget = target + giftArea;

  const cfg = readConfig();

  const topK = Number(q.topK ?? cfg.topK ?? 10);
  const source = String(q.source ?? cfg.source ?? "AB").toUpperCase();

  const minArea =
    q.minArea !== undefined
      ? Number(q.minArea)
      : cfg.minArea !== undefined
      ? Number(cfg.minArea)
      : undefined;
  const maxArea =
    q.maxArea !== undefined
      ? Number(q.maxArea)
      : cfg.maxArea !== undefined
      ? Number(cfg.maxArea)
      : undefined;

  let tmpXlsx = path.resolve(__dirname, `output-${Date.now()}.xlsx`);
  {
    const xfCommunities = urlObj.searchParams.getAll("xfCommunities");
    const options = { topK, source, minArea, maxArea, xfCommunities };
    POOL.runTask({ target: effectiveTarget, options })
      .then((results) => {
        try {
          exportToExcel(results, tmpXlsx);
          const stat = fs.statSync(tmpXlsx);
          const tStr = String(effectiveTarget).trim();
          const safeName = (tStr && tStr !== 'NaN') ? `results-${tStr}.xlsx` : 'results.xlsx';
          res.writeHead(200, {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="${safeName}"`,
            "Content-Length": stat.size,
          });
          const stream = fs.createReadStream(tmpXlsx);
          stream.pipe(res);
          stream.on("close", () => {
            fs.unlink(tmpXlsx, () => {});
          });
        } catch (e) {
          try { fs.unlinkSync(tmpXlsx); } catch {}
          sendJson(res, { error: e.message }, 500);
        }
      })
      .catch((e) => {
        try { fs.unlinkSync(tmpXlsx); } catch {}
        sendJson(res, { error: (e && e.message) ? e.message : String(e) }, 500);
      });
    return;
  }
}

/**
 * 现房小区列名检测与列表生成
 */
function detectCommunityKey(rows) {
  const first = (rows && rows[0]) || {};
  const keys = Object.keys(first);
  const preferred = ["小区名称", "小区", "小区名", "项目名称", "楼盘名称"];
  for (const k of preferred) {
    if (keys.includes(k)) return k;
  }
  const fuzzy = keys.find((k) => /小区|项目|楼盘/.test(String(k)));
  return fuzzy;
}
function listXfCommunities() {
  const key = detectCommunityKey(xianfangRows);
  if (!key) return [];
  const set = new Set();
  for (const r of xianfangRows) {
    const v = r[key];
    if (v !== null && v !== undefined) {
      const name = String(v).trim();
      if (name) set.add(name);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = urlObj.pathname;

  if (req.method === "GET" && pathname === "/") {
    const indexPath = path.join(PUBLIC_DIR, "index.html");
    return sendFile(res, indexPath, "text/html; charset=utf-8");
  }

  if (req.method === "GET" && pathname === "/config") {
    const cfg = readConfig();
    return sendJson(res, cfg);
  }

  if (req.method === "GET" && pathname === "/solve") {
    return handleSolve(urlObj, res);
  }

  if (req.method === "GET" && pathname === "/excel") {
    return handleExcel(urlObj, res);
  }

  // 现房小区列表接口
  if (req.method === "GET" && pathname === "/communities") {
    const type = urlObj.searchParams.get("type");
    if (type === "xf") {
      return sendJson(res, listXfCommunities());
    }
    return sendJson(res, []);
  }

  // 静态资源（若需要可扩展）
  // Resolve static asset path safely under PUBLIC_DIR (avoid absolute override)
  const staticPath = path.resolve(PUBLIC_DIR, '.' + pathname);
  if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
    const ext = path.extname(staticPath).toLowerCase();
    const mimes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".svg": "image/svg+xml",
    };
    const ct = mimes[ext] || "application/octet-stream";
    return sendFile(res, staticPath, ct);
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("未找到接口或资源");
});

server.listen(PORT, () => {
  console.log("上海市闵行区梅陇镇城中村 选房程序（内部版）");
  console.log(`UI 服务已启动：http://localhost:${PORT}`);
});
