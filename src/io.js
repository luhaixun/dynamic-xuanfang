/**
 * src/io.js
 * 文件加载工具：loadArrayFromTxt, tryParseJsonArray
 */

const fs = require("fs");
const vm = require("vm");

/**
 * 尝试将文本解析为 JSON 数组，若失败返回 null
 * @param {string} text
 * @returns {Array|null}
 */
function tryParseJsonArray(text) {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * 从 txt/js/json 文件中加载二维数组。
 * 支持以下格式：
 *  - 纯 JSON 数组：[[..],[..]]
 *  - JS 变量赋值：qifang = [...], xianfang = [...]
 *
 * @param {string} filePath 文件路径
 * @param {string[]} preferredVarNames 优先尝试的变量名列表
 * @returns {Array} 解析得到的数组
 * @throws 当文件中未找到数组时抛出错误
 */
function loadArrayFromTxt(filePath, preferredVarNames = []) {
  const code = fs.readFileSync(filePath, "utf8");

  // 1) 优先尝试纯 JSON
  const jsonArr = tryParseJsonArray(code.trim());
  if (jsonArr) return jsonArr;

  // 2) 作为 JS 执行并从沙箱中提取变量
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: 1000 });

  // 按指定变量名优先返回
  for (const name of preferredVarNames) {
    if (Array.isArray(sandbox[name])) return sandbox[name];
  }
  // 兜底：返回沙箱中出现的第一个数组
  for (const v of Object.values(sandbox)) {
    if (Array.isArray(v)) return v;
  }

  throw new Error(`文件中未找到数组：${filePath}`);
}

module.exports = {
  tryParseJsonArray,
  loadArrayFromTxt,
};
