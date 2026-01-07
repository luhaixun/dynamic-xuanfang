/**
 * index.js
 * 薄封装：基于模块化的 src/* 组合，提供命令行与库用法。
 *
 * 命令行用法：
 *   node index.js --target 318.64 --topK 10 [--source AB] [--minArea 60] [--maxArea 140]
 *   若未显式传入 A/B/source/topK，则使用根目录下 config.json 的默认值
 *
 * 代码调用用法：
 *   const { solveTopK } = require("./index");
 *   // 未提供 options 时，solveTopK 会读取 config.json 作为默认配置
 *   const results = solveTopK(318.64);
 *   // 或手动覆盖默认值（CLI/代码均可覆盖 config.json）
 *   // const results = solveTopK(318.64, { topK: 10, source: "AB", minArea: 60, maxArea: 140 });
 */

const { solveTopK, bestTopKCombos } = require("./src/solver");
const { normalizeType } = require("./src/normalize");
const { loadArrayFromTxt } = require("./src/io");
const { run } = require("./src/cli");

// 若作为可执行脚本运行，则启动命令行入口
if (require.main === module) {
  run(process.argv);
}

// 重新导出公共 API，保证向后兼容
module.exports = { solveTopK, bestTopKCombos, normalizeType, loadArrayFromTxt };
