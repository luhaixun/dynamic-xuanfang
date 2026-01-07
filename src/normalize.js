/**
 * src/normalize.js
 * 类型归一化工具
 *
 * 支持输入 "A"/"B"/"C"/"D" 或 "A类"/"B类"/"C类"/"D类"
 * 输出统一为 "A"/"B"/"C"/"D"
 */

/**
 * 将类型字符串归一化为 "A" | "B" | "C" | "D"
 * @param {string} t 输入类型字符串
 * @returns {('A'|'B'|'C'|'D'|null)} 归一化结果；无法识别则返回 null
 */
function normalizeType(t) {
  if (typeof t !== "string") return null;
  const m = t.trim().match(/^([ABCD])(?:类)?$/i);
  return m ? m[1].toUpperCase() : null;
}

module.exports = {
  normalizeType,
};
