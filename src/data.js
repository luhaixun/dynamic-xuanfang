/**
 * src/data.js
 * 一次性加载 Excel 数据（服务启动时加载到内存）
 * - 期房：data/期房-汇总.xlsx 工作表 "期房汇总"
 * - 现房：data/现房-汇总.xlsx 工作表 "现房汇总"
 *
 * 要求：
 * 1) 直接读取 Excel，不再读取 txt
 * 2) 不丢弃任何列（第一行是表头）；使用 XLSX.utils.sheet_to_json(defval) 保留空值
 * 3) 面积列为「建筑面积」，类型列：
 *    - 期房使用「类别」
 *    - 现房使用「类型」
 * 4) 仍然使用「建筑面积」做求和，其他列保留在内存中以备后用
 */
const path = require("path");
const XLSX = require("xlsx");
const fs = require("fs");

// 常量：来源名称（用于结果标注与“至少包含现房”规则）
const FILE_A_NAME = "期房";
const FILE_B_NAME = "现房";

// 文件与工作表
const QIFANG_XLSX = path.resolve(__dirname, "../data/期房-汇总.xlsx");
const XIANFANG_XLSX = path.resolve(__dirname, "../data/现房-汇总.xlsx");
const QIFANG_SHEET = "期房汇总";
const XIANFANG_SHEET = "现房汇总";

// JSON 缓存路径（与同名 xlsx 同目录）
const QIFANG_JSON = path.resolve(__dirname, "../data/期房-汇总.json");
const XIANFANG_JSON = path.resolve(__dirname, "../data/现房-汇总.json");

/**
 * 读取指定 Excel 工作表为对象数组（保留所有列）
 * @param {string} filePath
 * @param {string} sheetName
 * @returns {Array<Record<string, any>>}
 */
function readSheet(filePath, sheetName) {
  console.log(`[LOG] 解析 Excel: ${path.basename(filePath)} -> ${sheetName}`);
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    throw new Error(`Excel 工作表不存在：${path.basename(filePath)} -> ${sheetName}`);
  }
  // defval: 保留空单元格，确保不丢列；raw: 保留原始值（数值/字符串）
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
  console.log(`[LOG] 解析完成: ${path.basename(filePath)} -> ${sheetName}, 行数=${rows.length}`);
  return rows;
}

/**
 * 校验必须列是否存在
 * @param {Array<Record<string, any>>} rows
 * @param {string[]} requiredCols
 * @param {string} label 出错提示（例如：文件名 -> 工作表名）
 */
function validateColumns(rows, requiredCols, label) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`Excel 工作表无数据：${label}`);
  }
  const first = rows[0] || {};
  for (const col of requiredCols) {
    if (!(col in first)) {
      throw new Error(`Excel 缺少必需列“${col}”：${label}`);
    }
  }
}

/** 模块初始化时一次性加载（服务/CLI 启动即加载） */
// 支持 --refresh 标志：若传入则跳过 JSON 缓存，强制重新从 Excel 解析并覆盖 JSON
const REFRESH = Array.isArray(process.argv) && process.argv.includes("--refresh");

/**
 * 将数组写入 JSON 文件
 * @param {string} filePath
 * @param {Array<any>} rows
 */
function saveJson(filePath, rows) {
  fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), "utf8");
}

/**
 * 从 JSON 读取数组
 * @param {string} filePath
 * @returns {Array<any>}
 */
function loadJson(filePath) {
  const txt = fs.readFileSync(filePath, "utf8");
  const arr = JSON.parse(txt);
  return Array.isArray(arr) ? arr : [];
}

/**
 * 按需从缓存或 Excel 加载数据
 * @param {string} xlsxPath
 * @param {string} sheetName
 * @param {string} jsonPath
 * @param {string} typeCol "类别"（期房）或 "类型"（现房）
 */
function loadDataset(xlsxPath, sheetName, jsonPath, typeCol) {
  let rows;
  const needBuild = REFRESH || !fs.existsSync(jsonPath);
  if (needBuild) {
    rows = readSheet(xlsxPath, sheetName);
    validateColumns(rows, ["建筑面积", typeCol], `${path.basename(xlsxPath)} -> ${sheetName}`);
    // 首次/刷新时，刷新缓存
    try {
      saveJson(jsonPath, rows);
    } catch (e) {
      // 缓存写入失败不应阻塞运行，仅记录
      console.warn(`写入缓存失败：${jsonPath} - ${e.message}`);
    }
  } else {
    rows = loadJson(jsonPath);
    // 基本校验（缓存文件）
    validateColumns(rows, ["建筑面积", typeCol], `${path.basename(jsonPath)} (缓存)`);
  }
  return rows;
}

const qifangRows = loadDataset(QIFANG_XLSX, QIFANG_SHEET, QIFANG_JSON, "类别");
const xianfangRows = loadDataset(XIANFANG_XLSX, XIANFANG_SHEET, XIANFANG_JSON, "类型");

module.exports = {
  FILE_A_NAME,
  FILE_B_NAME,
  qifangRows,
  xianfangRows,
};
