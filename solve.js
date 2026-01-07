/**
 * solve.js
 *
 * 功能：
 *  - 读取 A.txt（qifang）和 B.txt（xianfang）里的二维数组数据：[[area, type], ...]
 *  - 从候选集合中选 3 或 4 条组合，满足：
 *      1) 覆盖户型 A/B/C（各至少 1）
 *      2) 结果条目数只能为 3 或 4：
 *         - 3条：A,B,C 各一条
 *         - 4条：在 A,B,C 基础上多一条，且只能重复 A/B/C 中的一类
 *      3) 总面积 sum ≤ target，并且 sum 尽量大（即 gap = target - sum 尽量小）
 *      4) 额外约束：最终结果必须至少包含 1 条来自 B.txt（xianfang）
 *  - 输出 TopK 个最优结果（K 由参数控制），并按 sum 从大到小排序
 *
 * 输出格式（每条结果）：
 * {
 *   result: [ [area, type, "A.txt|B.txt"], ... ],
 *   sum: 318.63,
 *   target: 318.64,
 *   gap: 0.01
 * }
 *
 * 运行方式（命令行）：
 *   node solve.js --target 318.64 --topK 10 --A ./A.txt --B ./B.txt
 *
 * 运行方式（代码调用）：
 *   const { solveTopK } = require("./solve");
 *   const results = solveTopK(318.64, { topK: 10, fileAPath:"./A.txt", fileBPath:"./B.txt" });
 */

const fs = require("fs");
const vm = require("vm");
const path = require("path");

/* ===========================
 * 1) 读取文件为数组
 * =========================== */

/** 尝试把文件内容直接当 JSON 数组解析 */
function tryParseJsonArray(text) {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * 从 txt 文件中读取数组
 * 支持：
 *  - 纯 JSON 数组：[[..],[..]]
 *  - JS 赋值：qifang = [...], xianfang = [...]
 */
function loadArrayFromTxt(filePath, preferredVarNames = []) {
  const code = fs.readFileSync(filePath, "utf8");

  // 1) 纯 JSON
  const jsonArr = tryParseJsonArray(code.trim());
  if (jsonArr) return jsonArr;

  // 2) JS 变量赋值
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: 1000 });

  // 优先按指定变量名取
  for (const name of preferredVarNames) {
    if (Array.isArray(sandbox[name])) return sandbox[name];
  }
  // 兜底：找到第一个数组
  for (const v of Object.values(sandbox)) {
    if (Array.isArray(v)) return v;
  }

  throw new Error(`文件中未找到数组：${filePath}`);
}

/* ===========================
 * 2) 户型归一化
 * =========================== */

/**
 * 支持 "A"/"B"/"C"/"D" 或 "A类"/"B类"/"C类"/"D类"
 * 输出统一为 "A"/"B"/"C"/"D"
 */
function normalizeType(t) {
  if (typeof t !== "string") return null;
  const m = t.trim().match(/^([ABCD])(?:类)?$/i);
  return m ? m[1].toUpperCase() : null;
}

/* ===========================
 * 3) 二分查找工具（按 area）
 * =========================== */

/** 在 arr（按 area 升序）中找到第一个 area > maxArea 的位置 */
function bisectRightByArea(arr, maxArea) {
  let lo = 0,
    hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].area <= maxArea) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 在 arr 中选出 area ≤ maxArea 的最大元素，不存在则返回 null */
function pickBestUnderOrEqual(arr, maxArea) {
  const idx = bisectRightByArea(arr, maxArea) - 1;
  return idx >= 0 ? arr[idx] : null;
}

/* ===========================
 * 4) 维护 TopK 最优结果（去重）
 * =========================== */

/**
 * picked => 去重 key（与顺序无关）
 * 注意：这里用 area+type+srcFile 做 key，如果你担心 area 浮点展示差异，可改成 toFixed
 */
function makeKey(picked) {
  return picked
    .map((x) => `${x.area}-${x.type}-${x.srcFile}`)
    .sort()
    .join("|");
}

/**
 * 向 topList 里尝试插入一个候选解（sum 越大越好）
 * topList 始终按 sum 降序，最多保留 topK 条
 */
function pushTopK(topList, seenKeys, candidate, topK) {
  const { sum, picked } = candidate;
  const key = makeKey(picked);
  if (seenKeys.has(key)) return;

  seenKeys.add(key);
  topList.push(candidate);

  // 按 sum 从大到小排序
  topList.sort((a, b) => b.sum - a.sum);

  // 超过 topK 就删掉最差的那条
  if (topList.length > topK) {
    const removed = topList.pop();
    const removedKey = makeKey(removed.picked);
    seenKeys.delete(removedKey);
  }
}

/* ===========================
 * 5) 核心求解：返回 TopK
 * =========================== */

/**
 * candidates: Array<[area, type, srcFileName]>
 * srcFileName: "A.txt" 或 "B.txt"
 */
function bestTopKCombos(candidates, target, fileAName, fileBName, topK = 10) {
  // 保障 topK 合法
  topK = Math.max(1, Math.floor(Number(topK) || 1));

  // 过滤+归一化+只保留户型 A/B/C（D 不允许进最终组合）
  const items = [];
  for (const it of candidates) {
    if (!Array.isArray(it) || it.length < 3) continue;

    const area = Number(it[0]);
    const type = normalizeType(it[1]);
    const srcFile = it[2];

    if (!Number.isFinite(area) || area <= 0) continue;
    if (!type || !["A", "B", "C"].includes(type)) continue;
    if (srcFile !== fileAName && srcFile !== fileBName) continue;

    items.push({ area, type, srcFile });
  }

  // 按户型分组
  const byType = { A: [], B: [], C: [] };
  for (const x of items) byType[x.type].push(x);

  // 排序（为二分服务）
  for (const t of ["A", "B", "C"]) {
    byType[t].sort((p, q) => p.area - q.area);
  }

  // 覆盖不足直接无解（返回空数组）
  if (!byType.A.length || !byType.B.length || !byType.C.length) return [];

  // TopK 容器 + 去重集合
  const topList = [];
  const seenKeys = new Set();

  // 必须至少包含 1 条来自 B.txt（xianfang）
  function hasAtLeastOneFromB(picked) {
    return picked.some((x) => x.srcFile === fileBName);
  }

  // 尝试收集一个合法解
  function tryCollect(picked, sum) {
    if (sum > target) return; // sum ≤ target
    if (!hasAtLeastOneFromB(picked)) return;

    pushTopK(topList, seenKeys, { sum, picked }, topK);
  }

  /* -------- 3条：A + B + C --------
   * 枚举 A、B，用二分从 C 里找最接近的（≤ limit 的最大）
   */
  for (const a of byType.A) {
    for (const b of byType.B) {
      const partial = a.area + b.area;
      if (partial > target) continue;

      const c = pickBestUnderOrEqual(byType.C, target - partial);
      if (c) tryCollect([a, b, c], partial + c.area);
    }
  }

  /* -------- 4条：某一类重复 --------
   * 形态：
   *  - A×2 + B + C
   *  - B×2 + A + C
   *  - C×2 + A + B
   *
   * 通用枚举方法：
   *  - 枚举重复类 X 的两两组合
   *  - 枚举单个 Y
   *  - 二分找 Z
   */
  function enumFour(X, Y, Z) {
    for (let i = 0; i < X.length; i++) {
      for (let j = i + 1; j < X.length; j++) {
        const sumXX = X[i].area + X[j].area;
        if (sumXX > target) continue;

        for (const y of Y) {
          const partial = sumXX + y.area;
          if (partial > target) continue;

          const z = pickBestUnderOrEqual(Z, target - partial);
          if (z) tryCollect([X[i], X[j], y, z], partial + z.area);
        }
      }
    }
  }

  enumFour(byType.A, byType.B, byType.C);
  enumFour(byType.B, byType.A, byType.C);
  enumFour(byType.C, byType.A, byType.B);

  // 把 topList 转成你要的输出格式
  return topList.map(({ sum, picked }) => {
    const sumFixed = Number(sum.toFixed(6));
    return {
      result: picked.map((x) => [x.area, x.type, x.srcFile]),
      sum: sumFixed,
      target,
      gap: Number((target - sumFixed).toFixed(6)),
    };
  });
}

/* ===========================
 * 6) 对外入口：solveTopK
 * =========================== */

function solveTopK(
  target,
  {
    topK = 10,
    source = "AB", // 可选："A" | "B" | "AB"
    fileAPath = "./A.txt",
    fileBPath = "./B.txt",
  } = {}
) {
  const fileAName = path.basename(fileAPath);
  const fileBName = path.basename(fileBPath);

  const Araw = loadArrayFromTxt(fileAPath, ["qifang", "A", "a", "data", "list"]);
  const Braw = loadArrayFromTxt(fileBPath, ["xianfang", "B", "b", "data", "list"]);

  // 给每条加来源文件名
  const A = Araw.map(([area, type]) => [area, type, fileAName]);
  const B = Braw.map(([area, type]) => [area, type, fileBName]);

  let candidates;
  const src = String(source).toUpperCase();
  if (src === "A") candidates = A; // 注意：此时可能无解，因为必须包含 B.txt
  else if (src === "B") candidates = B;
  else candidates = [...A, ...B];

  return bestTopKCombos(candidates, Number(target), fileAName, fileBName, topK);
}

/* ===========================
 * 7) CLI：命令行参数解析并打印
 * =========================== */

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) continue;
    const key = k.slice(2);
    const val = argv[i + 1];
    if (val && !val.startsWith("--")) {
      args[key] = val;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

if (require.main === module) {
  const args = parseArgs(process.argv);

  const target = Number(args.target ?? args.t);
  if (!Number.isFinite(target) || target <= 0) {
    console.error("用法：node solve.js --target 318.64 --topK 10 --A ./A.txt --B ./B.txt [--source AB]");
    process.exit(1);
  }

  const topK = Number(args.topK ?? 10);
  const fileAPath = path.resolve(args.A ?? "./qifang.txt");
  const fileBPath = path.resolve(args.B ?? "./xianfang.txt");
  const source = (args.source ?? "AB").toUpperCase();

  const results = solveTopK(target, { topK, source, fileAPath, fileBPath });
  console.log(JSON.stringify(results, null, 2));
}

module.exports = { solveTopK, bestTopKCombos, normalizeType, loadArrayFromTxt };
