/**
 * src/solver.js
 * 核心求解模块：由各工具模块（normalize/bisect/topk/io）组装，实现组合搜索与 TopK 维护。
 */

const path = require("path");
const fs = require("fs");
const { normalizeType } = require("./normalize");
const { pickBestUnderOrEqual } = require("./bisect");
const { pushTopK } = require("./topk");
const { qifangRows, xianfangRows, FILE_A_NAME, FILE_B_NAME } = require("./data");

// 缓存 JSON 行，避免每次请求重复读取与解析
const jsonRowCache = new Map();
const REFRESH_JSON = Array.isArray(process.argv) && process.argv.includes("--refresh");
/**
 * 读取并缓存 JSON 行数据
 * - 若未设置 --refresh，则优先返回缓存
 * - 解析失败时返回空数组
 */
function readJsonRowsCached(filePath) {
  try {
    const abs = path.resolve(filePath);
    if (!REFRESH_JSON && jsonRowCache.has(abs)) return jsonRowCache.get(abs);
    const txt = fs.readFileSync(abs, "utf8");
    const arr = JSON.parse(txt);
    const rows = Array.isArray(arr) ? arr : [];
    jsonRowCache.set(abs, rows);
    return rows;
  } catch {
    return [];
  }
}
  
  // 配置缓存（solver 侧）：避免每次调用 solveTopK 都从磁盘读取 config.json
  const CFG_PATH = path.resolve(__dirname, "../config.json");
  let CFG_CACHE = {};
  function reloadConfigCache() {
    try {
      const txt = fs.readFileSync(CFG_PATH, "utf8");
      CFG_CACHE = JSON.parse(txt);
    } catch {
      CFG_CACHE = {};
    }
  }
  reloadConfigCache();
  try {
    fs.watchFile(CFG_PATH, { interval: 1000 }, () => {
      reloadConfigCache();
      console.log("[LOG] solver: config.json reloaded");
    });
  } catch {}
  function getConfig() {
    return CFG_CACHE;
  }
  
  // 数据派生缓存：缓存 toAreaTypeRows + 按类型分组并按面积排序的结果
  const derivedCache = new Map();
  /**
   * 从原始行提取 {area, type}
   */
  function extractAreaTypeRows(rows, typeKey) {
    const out = [];
    for (const r of rows || []) {
      const area = Number(r["建筑面积"]);
      const type = normalizeType(r[typeKey]);
      if (!Number.isFinite(area) || area <= 0) continue;
      if (!type || !["A", "B", "C"].includes(type)) continue;
      const buildingNo = r["幢号"] != null ? String(r["幢号"]).trim() : '';
      const doorNo = r["门牌号"] != null ? String(r["门牌号"]).trim() : '';
      const roomNo = r["室号"] != null ? String(r["室号"]).trim() : '';
      out.push({ area, type, buildingNo, roomNo, doorNo });
    }
    return out;
  }
  function extractAreaTypeRowsWithCommunity(rows, typeKey, communityKey) {
    const out = [];
    for (const r of rows || []) {
      const area = Number(r["建筑面积"]);
      const type = normalizeType(r[typeKey]);
      if (!Number.isFinite(area) || area <= 0) continue;
      if (!type || !["A", "B", "C"].includes(type)) continue;
      const community = communityKey ? (r[communityKey] != null ? String(r[communityKey]).trim() : '') : undefined;
      const buildingNo = r["幢号"] != null ? String(r["幢号"]).trim() : '';
      const doorNo = r["门牌号"] != null ? String(r["门牌号"]).trim() : '';
      const roomNo = r["室号"] != null ? String(r["室号"]).trim() : '';
      if (communityKey) out.push({ area, type, community, buildingNo, roomNo, doorNo });
      else out.push({ area, type, buildingNo, roomNo, doorNo });
    }
    return out;
  }
  function groupAndSortByType(areaTypeRows) {
    const byType = { A: [], B: [], C: [] };
    for (const x of areaTypeRows) byType[x.type].push(x);
    for (const t of ["A", "B", "C"]) byType[t].sort((p, q) => p.area - q.area);
    return byType;
  }
  function getDerivedGroupedSorted(key, rows, typeKey) {
    const k = String(key) + "::" + String(typeKey || "");
    if (!REFRESH_JSON && derivedCache.has(k)) return derivedCache.get(k);
    const areaTypeRows = extractAreaTypeRows(rows, typeKey);
    const grouped = groupAndSortByType(areaTypeRows);
    derivedCache.set(k, grouped);
    return grouped;
  }
  // 二分辅助：在按面积升序数组上取 [min,max] 闭区间
  function lowerBound(arr, min) {
    if (min === undefined) return 0;
    let l = 0, r = arr.length;
    while (l < r) {
      const m = (l + r) >> 1;
      if (arr[m].area < min) l = m + 1;
      else r = m;
    }
    return l;
  }
  function upperBound(arr, max) {
    if (max === undefined) return arr.length;
    let l = 0, r = arr.length;
    while (l < r) {
      const m = (l + r) >> 1;
      if (arr[m].area <= max) l = m + 1;
      else r = m;
    }
    return l; // 返回第一个 > max 的位置
  }
  function sliceRange(arr, min, max) {
    const start = lowerBound(arr, min);
    const end = upperBound(arr, max);
    if (end <= start) return [];
    return arr.slice(start, end);
  }
  
  /**
 * 计算满足约束条件的 TopK 最优组合。
 * candidates: Array<[area, type, srcFileName]>
 * srcFileName: 通常为 "A.txt" 或 "B.txt"
 *
 * 约束回顾：
 *  - 只能选 3 或 4 条
 *  - 必须覆盖 A/B/C（各至少 1 条）
 *  - 4 条时，仅允许某一类重复一次（两条同类 + 另外两类各一条）
 *  - sum ≤ target，且尽量接近 target
 *  - 至少包含 1 条来自 B.txt（xianfang）
 *
 * 返回：
 *  - 按 sum 降序的 TopK 结果，每项包含 { result, sum, target, gap }
 */
function bestTopKCombos(candidates, target, fileAName, fileBName, topK = 10, disallowDominant, dominantMoreThan, othersLessThan) {
  // 规整 topK
  topK = Math.max(1, Math.floor(Number(topK) || 1));
  const targetNum = Number(target);

  // 过滤 + 归一化 + 仅允许 A/B/C（排除 D）
  const items = [];
  for (const it of candidates) {
    let area, type, srcFile, community, buildingNo, roomNo, doorNo;
    if (Array.isArray(it)) {
      if (it.length < 3) continue;
      area = Number(it[0]);
      type = normalizeType(it[1]);
      srcFile = it[2];
    } else if (it && typeof it === 'object') {
      area = Number(it.area);
      type = normalizeType(it.type);
      srcFile = it.srcFile;
      community = it.community;
      buildingNo = it.buildingNo;
      roomNo = it.roomNo;
      doorNo = it.doorNo;
    } else {
      continue;
    }

    if (!Number.isFinite(area) || area <= 0) continue;
    if (!type || !["A", "B", "C"].includes(type)) continue;
    if (srcFile !== fileAName && srcFile !== fileBName) continue;

    items.push({ area, type, srcFile, community, buildingNo, roomNo, doorNo });
  }

  // 按类型分组
  const byType = { A: [], B: [], C: [] };
  for (const x of items) byType[x.type].push(x);

  // 为后续二分查找按 area 升序排序
  for (const t of ["A", "B", "C"]) {
    byType[t].sort((p, q) => p.area - q.area);
  }
  // 任何单条面积超过 target 都不可能参与合法组合，提前剔除
  for (const t of ["A", "B", "C"]) {
    byType[t] = byType[t].filter((x) => x.area <= targetNum);
  }

  // 若任一类型缺失，则无解
  if (!byType.A.length || !byType.B.length || !byType.C.length) return [];

  // TopK 容器与去重集合
  const topList = [];
  const seenKeys = new Set();

  // 是否至少包含 1 条来自 B.txt（xianfang）
  function hasAtLeastOneFromB(picked) {
    return picked.some((x) => x.srcFile === fileBName);
  }

  // 收集一个合法候选
  function tryCollect(picked, sum) {
    if (sum > targetNum) return; // 必须满足 sum ≤ target
    if (!hasAtLeastOneFromB(picked)) return;

    // 规则：不允许出现“两套大面积（>100）且均来自期房”的组合
    const largeQCount = picked.reduce((acc, x) => {
      return acc + ((x.srcFile === fileAName && x.area > 100) ? 1 : 0);
    }, 0);
    if (largeQCount >= 2) return;

    // 规则过滤：不允许“恰好 1 条面积 > dominantMoreThan，且其余所有条目面积 < othersLessThan”
    if (disallowDominant && Number.isFinite(dominantMoreThan) && Number.isFinite(othersLessThan)) {
      const areas = picked.map((x) => x.area);
      const dominantCount = areas.filter((a) => a > dominantMoreThan).length;
      if (dominantCount === 1) {
        const others = areas.filter((a) => a <= dominantMoreThan);
        const allOthersSmall = others.every((a) => a < othersLessThan);
        if (allOthersSmall) return; // 违反规则，丢弃该组合
      }
    }

    pushTopK(topList, seenKeys, { sum, picked }, topK);
  }

  // 3 条：A + B + C（降序遍历 + 上界剪枝）
  const maxCarea = byType.C.length ? byType.C[byType.C.length - 1].area : -Infinity;
  for (let ia = byType.A.length - 1; ia >= 0; ia--) {
    const a = byType.A[ia];
    for (let ib = byType.B.length - 1; ib >= 0; ib--) {
      const b = byType.B[ib];
      const partial = a.area + b.area;
      // 降序遍历时，若超 target，继续尝试更小的 b（不能 break）
      if (partial > targetNum) continue;

      // TopK 已满时，若即使加上 C 的最大值也无法超过当前最小入榜值，则直接结束该 b 循环
      if (topList.length >= topK) {
        const minKeep = topList[topList.length - 1].sum;
        if (partial + maxCarea <= minKeep) break; // 后续更小的 b 只会更小，无法提升
      }

      const c = pickBestUnderOrEqual(byType.C, targetNum - partial);
      if (c) tryCollect([a, b, c], partial + c.area);
    }
  }

  // 4 条：某一类重复一次
  // 形态：
  //  - A×2 + B + C
  //  - B×2 + A + C
  //  - C×2 + A + B
  function enumFour(X, Y, Z) {
    // 降序遍历 + 上界剪枝
    const maxZarea = Z.length ? Z[Z.length - 1].area : -Infinity;
    for (let i = X.length - 1; i >= 1; i--) {
      for (let j = i - 1; j >= 0; j--) {
        const sumXX = X[i].area + X[j].area;
        // 降序时若超 target，尝试更小的 j（继续）
        if (sumXX > targetNum) continue;

        for (let iy = Y.length - 1; iy >= 0; iy--) {
          const y = Y[iy];
          const partial = sumXX + y.area;
          if (partial > targetNum) continue;

          if (topList.length >= topK) {
            const minKeep = topList[topList.length - 1].sum;
            if (partial + maxZarea <= minKeep) break; // 后续更小的 y 无法超过最小入榜
          }

          const z = pickBestUnderOrEqual(Z, targetNum - partial);
          if (z) tryCollect([X[i], X[j], y, z], partial + z.area);
        }
      }
    }
  }

  enumFour(byType.A, byType.B, byType.C);
  enumFour(byType.B, byType.A, byType.C);
  enumFour(byType.C, byType.A, byType.B);

  // 输出格式化
  return topList.map(({ sum, picked }) => {
    const sumFixed = Number(sum.toFixed(6));
    return {
      result: picked.map((x) => {
        if (x.srcFile === fileBName) {
          // 现房：显示小区名 + 幢号 + 门牌号 + 室号；若缺失则回退到 "(现房)"
          const parts = [];
          if (x.community) parts.push(String(x.community).trim());
          if (x.buildingNo) parts.push(`${String(x.buildingNo).trim()}幢`);
          if (x.doorNo) parts.push(`${String(x.doorNo).trim()}号`);
          if (x.roomNo) parts.push(`${String(x.roomNo).trim()}室`);
          const label = parts.length ? `(${parts.join(' ')})` : `${x.type}(现房)`;
          return [x.area, label];
        }
        // 期房：保留“(期房)”用于前端统计，再追加门牌号/室号/幢号（若存在）
        const extra = (x.buildingNo || x.doorNo || x.roomNo)
          ? `${x.buildingNo ? ' ' + String(x.buildingNo).trim() + '幢' : ''}${x.doorNo ? ' ' + String(x.doorNo).trim() + '号' : ''}${x.roomNo ? ' ' + String(x.roomNo).trim() + '室' : ''}`
          : '';
        return [x.area, `${x.type}(期房)` + extra];
      }),
      "兑换面积": sumFixed,
      "目标面积": targetNum,
      "浪费面积": Number((targetNum - sumFixed).toFixed(6)),
    };
  });
}

/**
 * 对外 API：solveTopK
 * 负责：
 *  - 解析/加载数据文件
 *  - 根据 source 选取候选集合
 *  - 调用 bestTopKCombos 完成计算并格式化结果
 */
function solveTopK(
  target,
  {
    topK,
    source, // 可选 "A" | "B" | "AB"
    fileAPath,
    fileBPath,
    minArea,
    maxArea,
    xfCommunities,
  } = {}
) {
  // 读取配置文件，优先使用传入参数；未传入时使用配置文件默认值
  const cfg = getConfig();

  const finalTopK = Number(topK ?? cfg.topK ?? 10);
  const finalSource = String(source ?? cfg.source ?? "AB").toUpperCase();
  const finalFileAPath = (fileAPath ?? cfg.fileAPath);
  const finalFileBPath = (fileBPath ?? cfg.fileBPath);

  // 归一化面积阈值：仅当为有限数值时才启用过滤
  const rawMin = (minArea ?? cfg.minArea);
  const rawMax = (maxArea ?? cfg.maxArea);
  const nMin = Number(rawMin);
  const nMax = Number(rawMax);
  const finalMinArea = (rawMin === undefined || rawMin === null || !Number.isFinite(nMin)) ? undefined : nMin;
  const finalMaxArea = (rawMax === undefined || rawMax === null || !Number.isFinite(nMax)) ? undefined : nMax;
  const targetNum = Number(target);
  console.log(`[LOG] 开始查找解决方案，面积：${targetNum}`);
  const __t0 = process.hrtime.bigint();

  // 组合规则配置（优先从 cfg.policy 读取，兼容旧版顶层键）
  const policy = cfg.policy || {};
  const disallowDominant = Boolean(policy.disallowDominantWithSmallOthers ?? cfg.disallowDominantWithSmallOthers);
  const dominantMoreThan = Number(policy.dominantMoreThan ?? cfg.dominantMoreThan);
  const othersLessThan = Number(policy.othersLessThan ?? cfg.othersLessThan);

  const fileAName = FILE_A_NAME;
  const fileBName = FILE_B_NAME;

  // 从 Excel 行构造成 [area, type] 列表（保留所有列于内存 data.js）
  function toAreaTypeRows(rows, typeKey) {
    const out = [];
    for (const r of rows) {
      const area = Number(r["建筑面积"]);
      const type = normalizeType(r[typeKey]);
      if (!Number.isFinite(area) || area <= 0) continue;
      if (!type || !["A", "B", "C"].includes(type)) continue;
      out.push({ area, type, row: r });
    }
    return out;
  }
  // 根据配置/参数，优先从 JSON 缓存加载；否则回退到内存中的 Excel 行
  function detectTypeKey(rows) {
    const first = rows && rows[0] || {};
    if ("类别" in first) return "类别";
    if ("类型" in first) return "类型";
    return "类别";
  }
  const useJsonA = typeof finalFileAPath === "string" && finalFileAPath.toLowerCase().endsWith(".json") && fs.existsSync(path.resolve(finalFileAPath));
  const useJsonB = typeof finalFileBPath === "string" && finalFileBPath.toLowerCase().endsWith(".json") && fs.existsSync(path.resolve(finalFileBPath));

  const srcArows = useJsonA ? readJsonRowsCached(finalFileAPath) : qifangRows;
  const srcBrows = useJsonB ? readJsonRowsCached(finalFileBPath) : xianfangRows;

  const keyA = useJsonA ? path.resolve(finalFileAPath) : "__EXCEL_QIFANG__";
  const keyB = useJsonB ? path.resolve(finalFileBPath) : "__EXCEL_XIANFANG__";
  const typeKeyA = useJsonA ? detectTypeKey(srcArows) : "类别";
  const typeKeyB = useJsonB ? detectTypeKey(srcBrows) : "类型";
  
  // 使用派生缓存：按类型分组并按面积排序（对现房可按小区过滤）
  const Agroup = getDerivedGroupedSorted(keyA, srcArows, typeKeyA);

  // 若传入现房小区过滤，则仅保留选中的小区；否则使用缓存分组
  function detectCommunityKeyForB(rows) {
    const first = (rows && rows[0]) || {};
    const keys = Object.keys(first);
    const preferred = ["小区名称", "小区", "小区名", "项目名称", "楼盘名称"];
    for (const k of preferred) {
      if (keys.includes(k)) return k;
    }
    const fuzzy = keys.find((k) => /小区|项目|楼盘/.test(String(k)));
    return fuzzy;
  }
  const xfSel = Array.isArray(xfCommunities)
    ? xfCommunities.filter(Boolean).map((s) => String(s).trim()).filter(Boolean)
    : [];
  let Bgroup;
  if (xfSel.length > 0) {
    const ck = detectCommunityKeyForB(srcBrows);
    if (ck) {
      const set = new Set(xfSel);
      const filteredBRows = srcBrows.filter((r) => {
        const v = r[ck];
        if (v === null || v === undefined) return false;
        const name = String(v).trim();
        return name && set.has(name);
      });
      const areaType = extractAreaTypeRowsWithCommunity(filteredBRows, typeKeyB, ck);
      Bgroup = groupAndSortByType(areaType);
    } else {
      // 无法检测到小区列名时，不进行过滤，避免误杀
      Bgroup = getDerivedGroupedSorted(keyB, srcBrows, typeKeyB);
    }
  } else {
    const ck = detectCommunityKeyForB(srcBrows);
    if (ck) {
      const areaType = extractAreaTypeRowsWithCommunity(srcBrows, typeKeyB, ck);
      Bgroup = groupAndSortByType(areaType);
    } else {
      Bgroup = getDerivedGroupedSorted(keyB, srcBrows, typeKeyB);
    }
  }
  
  // 计算筛选区间 [min, max]，并考虑目标面积上限
  const upperA = Number.isFinite(targetNum)
    ? (finalMaxArea !== undefined ? Math.min(targetNum, finalMaxArea) : targetNum)
    : finalMaxArea;
  const upperB = upperA; // 相同规则
  
  const lower = finalMinArea;
  
  // 基于二分的快速切片
  const AfltA = sliceRange(Agroup.A, lower, upperA);
  const AfltB = sliceRange(Agroup.B, lower, upperA);
  const AfltC = sliceRange(Agroup.C, lower, upperA);
  const BfltA = sliceRange(Bgroup.A, lower, upperB);
  const BfltB = sliceRange(Bgroup.B, lower, upperB);
  const BfltC = sliceRange(Bgroup.C, lower, upperB);
  
  // 合并类型并附加来源
  const A = [...AfltA, ...AfltB, ...AfltC].map(({ area, type, buildingNo, roomNo, doorNo }) => ({ area, type, srcFile: fileAName, buildingNo, roomNo, doorNo }));
  const B = [...BfltA, ...BfltB, ...BfltC].map(({ area, type, community, buildingNo, roomNo, doorNo }) => ({ area, type, srcFile: fileBName, community, buildingNo, roomNo, doorNo }));

  // 依据 source 选择候选
  let candidates;
  const src = finalSource;
  if (src === "A") candidates = A; // 注意：由于必须包含 B.txt，可能导致无解
  else if (src === "B") candidates = B;
  else candidates = [...A, ...B];

  const __res = bestTopKCombos(candidates, Number(target), fileAName, fileBName, finalTopK, disallowDominant, dominantMoreThan, othersLessThan);
  const __t1 = process.hrtime.bigint();
  const __ms = Number(__t1 - __t0) / 1e6;
  console.log(
    `[METRIC] solveTopK spent ${__ms.toFixed(2)} ms target=${targetNum} topK=${finalTopK} source=${finalSource} candA=${A.length} candB=${B.length} results=${__res.length}`
  );
  return __res;
}

module.exports = {
  bestTopKCombos,
  solveTopK,
};
