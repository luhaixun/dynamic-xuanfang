/**
 * src/solver.js
 * 核心求解模块：由各工具模块（normalize/bisect/topk/io）组装，实现组合搜索与 TopK 维护。
 */

const path = require("path");
const fs = require("fs");
const { normalizeType } = require("./normalize");
const { pickBestUnderOrEqual } = require("./bisect");
const { pushTopK } = require("./topk");
const { loadArrayFromTxt } = require("./io");

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
    if (!Array.isArray(it) || it.length < 3) continue;

    const area = Number(it[0]);
    const type = normalizeType(it[1]);
    const srcFile = it[2];

    if (!Number.isFinite(area) || area <= 0) continue;
    if (!type || !["A", "B", "C"].includes(type)) continue;
    if (srcFile !== fileAName && srcFile !== fileBName) continue;

    items.push({ area, type, srcFile });
  }

  // 按类型分组
  const byType = { A: [], B: [], C: [] };
  for (const x of items) byType[x.type].push(x);

  // 为后续二分查找按 area 升序排序
  for (const t of ["A", "B", "C"]) {
    byType[t].sort((p, q) => p.area - q.area);
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

  // 3 条：A + B + C
  for (const a of byType.A) {
    for (const b of byType.B) {
      const partial = a.area + b.area;
      if (partial > targetNum) continue;

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
    for (let i = 0; i < X.length; i++) {
      for (let j = i + 1; j < X.length; j++) {
        const sumXX = X[i].area + X[j].area;
        if (sumXX > targetNum) continue;

        for (const y of Y) {
          const partial = sumXX + y.area;
          if (partial > targetNum) continue;

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
          // 来自 xianfang.txt 的条目：去掉来源，并在类型后标注“(现房)”
          return [x.area, `${x.type}(现房)`];
        }
        // 来自 qifang.txt 的条目：去掉来源，并在类型后标注“(期房)”
        return [x.area, `${x.type}(期房)`];
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
  } = {}
) {
  // 读取配置文件，优先使用传入参数；未传入时使用配置文件默认值
  const cfgPath = path.resolve(__dirname, "../config.json");
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch {
    cfg = {};
  }

  const finalTopK = Number(topK ?? cfg.topK ?? 10);
  const finalFileAPath = fileAPath ?? cfg.fileAPath ?? "./data/qifang.txt";
  const finalFileBPath = fileBPath ?? cfg.fileBPath ?? "./data/xianfang.txt";
  const finalSource = String(source ?? cfg.source ?? "AB").toUpperCase();

  // 归一化面积阈值：仅当为有限数值时才启用过滤
  const rawMin = (minArea ?? cfg.minArea);
  const rawMax = (maxArea ?? cfg.maxArea);
  const nMin = Number(rawMin);
  const nMax = Number(rawMax);
  const finalMinArea = (rawMin === undefined || rawMin === null || !Number.isFinite(nMin)) ? undefined : nMin;
  const finalMaxArea = (rawMax === undefined || rawMax === null || !Number.isFinite(nMax)) ? undefined : nMax;

  // 组合规则配置（优先从 cfg.policy 读取，兼容旧版顶层键）
  const policy = cfg.policy || {};
  const disallowDominant = Boolean(policy.disallowDominantWithSmallOthers ?? cfg.disallowDominantWithSmallOthers);
  const dominantMoreThan = Number(policy.dominantMoreThan ?? cfg.dominantMoreThan);
  const othersLessThan = Number(policy.othersLessThan ?? cfg.othersLessThan);

  const fileAName = path.basename(finalFileAPath);
  const fileBName = path.basename(finalFileBPath);

  const Araw = loadArrayFromTxt(finalFileAPath, ["qifang", "A", "a", "data", "list"]);
  const Braw = loadArrayFromTxt(finalFileBPath, ["xianfang", "B", "b", "data", "list"]);

  // 在附加来源前先按面积阈值进行过滤：
  // - 若 finalMinArea 定义，则剔除 area < finalMinArea
  // - 若 finalMaxArea 定义，则剔除 area > finalMaxArea
  function applyAreaFilter(arr) {
    return arr.filter(([area]) => {
      const a = Number(area);
      if (!Number.isFinite(a)) return false;
      if (finalMinArea !== undefined && a < finalMinArea) return false;
      if (finalMaxArea !== undefined && a > finalMaxArea) return false;
      return true;
    });
  }
  const Aflt = applyAreaFilter(Araw);
  const Bflt = applyAreaFilter(Braw);

  // 为每条记录附加来源文件名
  const A = Aflt.map(([area, type]) => [area, type, fileAName]);
  const B = Bflt.map(([area, type]) => [area, type, fileBName]);

  // 依据 source 选择候选
  let candidates;
  const src = finalSource;
  if (src === "A") candidates = A; // 注意：由于必须包含 B.txt，可能导致无解
  else if (src === "B") candidates = B;
  else candidates = [...A, ...B];

  return bestTopKCombos(candidates, Number(target), fileAName, fileBName, finalTopK, disallowDominant, dominantMoreThan, othersLessThan);
}

module.exports = {
  bestTopKCombos,
  solveTopK,
};
