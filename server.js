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

const PORT = 3000;
const PUBLIC_DIR = path.resolve(__dirname, "public");
const CONFIG_PATH = path.resolve(__dirname, "config.json");

function readConfig() {
  try {
    const txt = fs.readFileSync(CONFIG_PATH, "utf8");
    return JSON.parse(txt);
  } catch {
    return {};
  }
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

  const cfg = readConfig();

  // 解析参数，命令行/前端传入优先，其次 config.json 默认
  const topK = Number(q.topK ?? cfg.topK ?? 10);
  const source = String(q.source ?? cfg.source ?? "AB").toUpperCase();
  const fileAPath = path.resolve(q.A ?? cfg.fileAPath ?? "./data/qifang.txt");
  const fileBPath = path.resolve(q.B ?? cfg.fileBPath ?? "./data/xianfang.txt");

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

  try {
    const results = solveTopK(target, {
      topK,
      source,
      fileAPath,
      fileBPath,
      minArea,
      maxArea,
    });
    return sendJson(res, results);
  } catch (e) {
    return sendJson(res, { error: e.message }, 500);
  }
}

function handleExcel(urlObj, res) {
  const q = Object.fromEntries(urlObj.searchParams.entries());
  const target = Number(q.target);
  if (!Number.isFinite(target) || target <= 0) {
    return sendJson(res, { error: "target 参数无效（需为正数）" }, 400);
  }

  const cfg = readConfig();

  const topK = Number(q.topK ?? cfg.topK ?? 10);
  const source = String(q.source ?? cfg.source ?? "AB").toUpperCase();
  const fileAPath = path.resolve(q.A ?? cfg.fileAPath ?? "./data/qifang.txt");
  const fileBPath = path.resolve(q.B ?? cfg.fileBPath ?? "./data/xianfang.txt");

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
  try {
    const results = solveTopK(target, {
      topK,
      source,
      fileAPath,
      fileBPath,
      minArea,
      maxArea,
    });
    exportToExcel(results, tmpXlsx);

    // 返回下载
    const stat = fs.statSync(tmpXlsx);
    res.writeHead(200, {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="results.xlsx"`,
      "Content-Length": stat.size,
    });
    const stream = fs.createReadStream(tmpXlsx);
    stream.pipe(res);
    stream.on("close", () => {
      // 尝试删除临时文件
      fs.unlink(tmpXlsx, () => {});
    });
  } catch (e) {
    // 若出错，尝试删除临时文件
    try {
      fs.unlinkSync(tmpXlsx);
    } catch {}
    return sendJson(res, { error: e.message }, 500);
  }
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

  // 静态资源（若需要可扩展）
  const staticPath = path.join(PUBLIC_DIR, pathname);
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
  console.log(`UI 服务已启动：http://localhost:${PORT}`);
});
