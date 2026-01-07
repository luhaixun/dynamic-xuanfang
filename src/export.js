/**
 * src/export.js
 * 将结果导出为 Excel (.xlsx) 文件
 */
const XLSX = require("xlsx");

/**
 * 导出结果到 Excel
 * @param {Array<{result:Array<[number,string]>, "兑换面积":number, "目标面积":number, "浪费面积":number}>} results
 * @param {string} filePath 输出文件路径（.xlsx）
 */
function exportToExcel(results, filePath) {
  const headers = [
    "条目1面积",
    "条目1类型",
    "条目2面积",
    "条目2类型",
    "条目3面积",
    "条目3类型",
    "条目4面积",
    "条目4类型",
    "兑换面积",
    "目标面积",
    "浪费面积",
  ];

  const rows = results.map((r) => {
    const items = r.result || [];
    const row = {};
    for (let i = 0; i < 4; i++) {
      const item = items[i];
      row[`条目${i + 1}面积`] = item ? item[0] : "";
      row[`条目${i + 1}类型`] = item ? item[1] : "";
    }
    row["兑换面积"] = r["兑换面积"];
    row["目标面积"] = r["目标面积"];
    row["浪费面积"] = r["浪费面积"];
    return row;
  });

  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "TopK结果");
  XLSX.writeFile(wb, filePath);
}

module.exports = {
  exportToExcel,
};
