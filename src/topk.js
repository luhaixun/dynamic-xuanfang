/**
 * src/topk.js
 * 维护带去重的 TopK 最优结果。
 */

/**
 * 为选中项构建去重 key（与顺序无关）。
 * 使用 area-type-srcFile 组成；如担心浮点表示差异，可用 toFixed 规范化 area。
 * @param {Array<{area:number,type:string,srcFile:string}>} picked
 * @returns {string}
 */
function makeKey(picked) {
  return picked
    .map((x) => `${x.area}-${x.type}-${x.srcFile}`)
    .sort()
    .join("|");
}

/**
 * 尝试将候选解插入 topList（按 sum 降序）。
 * 通过 picked 的 key 去重，并最多保留 topK 条。
 * @param {Array<{sum:number,picked:Array}>} topList
 * @param {Set<string>} seenKeys
 * @param {{sum:number,picked:Array}} candidate
 * @param {number} topK
 */
function pushTopK(topList, seenKeys, candidate, topK) {
  const { sum, picked } = candidate;
  const key = makeKey(picked);
  if (seenKeys.has(key)) return;

  seenKeys.add(key);
  topList.push(candidate);

  // 按 sum 降序排序
  topList.sort((a, b) => b.sum - a.sum);

  // 截断到 TopK
  if (topList.length > topK) {
    const removed = topList.pop();
    const removedKey = makeKey(removed.picked);
    seenKeys.delete(removedKey);
  }
}

module.exports = {
  makeKey,
  pushTopK,
};
