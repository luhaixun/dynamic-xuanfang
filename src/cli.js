/**
 * src/cli.js
 * 命令行入口（CLI）。
 */
const path = require("path");
const fs = require("fs");
const { solveTopK } = require("./solver");
const { exportToExcel } = require("./export");

/**
 * 解析命令行参数（例如：node index.js --target 318.64 --topK 10 --A ./data/qifang.txt --B ./data/xianfang.txt [--source AB]）
 * @param {string[]} argv
 * @returns {Record<string, string|boolean>}
 */
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

/**
 * 运行 CLI。若参数非法，则以状态码 1 退出。
 * @param {string[]} argv
 */
function run(argv = process.argv) {
  const args = parseArgs(argv);

  const target = Number(args.target ?? args.t);
  if (!Number.isFinite(target) || target <= 0) {
    console.error("用法：node index.js --target 318.64 --topK 10 --A ./data/qifang.txt --B ./data/xianfang.txt [--source AB]");
    process.exit(1);
  }

  // 读取配置文件，命令行参数优先覆盖
  const cfgPath = path.resolve(__dirname, "../config.json");
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch {
    cfg = {};
  }

  const topK = Number(args.topK ?? cfg.topK ?? 10);
  const fileAPath = path.resolve(args.A ?? cfg.fileAPath ?? "./data/qifang.txt");
  const fileBPath = path.resolve(args.B ?? cfg.fileBPath ?? "./data/xianfang.txt");
  const source = (args.source ?? cfg.source ?? "AB").toUpperCase();

  // 解析 Excel 输出路径：命令行优先，其次 config.json，最后当使用 --excel 且未给路径时默认 ./output.xlsx
  let excelPath = null;
  const excelArg = args.excel;
  if (excelArg === true) {
    excelPath = path.resolve(cfg.excel ?? "./output.xlsx");
  } else if (excelArg) {
    excelPath = path.resolve(excelArg);
  } else if (cfg.excel) {
    excelPath = path.resolve(cfg.excel);
  }

  // 面积过滤：命令行优先，其次 config.json
  const minArea = args.minArea !== undefined ? Number(args.minArea) : (cfg.minArea !== undefined ? Number(cfg.minArea) : undefined);
  const maxArea = args.maxArea !== undefined ? Number(args.maxArea) : (cfg.maxArea !== undefined ? Number(cfg.maxArea) : undefined);

  const results = solveTopK(target, { topK, source, fileAPath, fileBPath, minArea, maxArea });
  console.log(JSON.stringify(results, null, 2));

  if (excelPath) {
    try {
      exportToExcel(results, excelPath);
      console.error(`Excel 已导出: ${excelPath}`);
    } catch (e) {
      console.error(`导出 Excel 失败: ${e.message}`);
      process.exitCode = 1;
    }
  }
}

module.exports = {
  parseArgs,
  run,
};
