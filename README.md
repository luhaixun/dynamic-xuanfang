# 上海市闵行区梅陇镇城中村 选房程序（内部版）

这是一个使用 Node.js 编写的小工具，用于从两个 Excel 数据源（期房 / 现房）中，
计算总面积不超过目标值（≤ target）且最接近目标值的 Top-K 组合方案。

数据在启动时一次性从 Excel 读入并保存在内存中，保留全部字段（不丢弃任何列）。

---

## 核心规则

- 结果条数只能是 3 条或 4 条
- 户型必须覆盖 A / B / C（各至少 1 条）
- 4 条时，只允许某一类重复一次（如 A×2,B×1,C×1）
- 总面积 ≤ target，且尽量接近 target
- 至少 1 条必须来自“现房”数据源
- 返回最优的前 K 条结果（K 可配置）

---

## 数据来源

- 期房：data/期房-汇总.xlsx，工作表名“期房汇总”
- 现房：data/现房-汇总.xlsx，工作表名“现房汇总”
- 第一行是表头，所有列会被完整保留（包括空值）

重要列约定：
- 面积列统一使用“建筑面积”参与计算与过滤
- 类型列：
  - 期房使用“类别”（值如 A、B、C 或 A类/B类/C类）
  - 现房使用“类型”（值如 A、B、C 或 A类/B类/C类）

示例表头（实际 Excel 里可能更多列，都会保留）：
- 期房：序号、房源类型、幢号、门牌号、室号、户型、建筑面积、单价、类别
- 现房：序号、房源型、小区名称、幢号、室号、户型、建筑面积、单价、类型

---

## 文件结构

```text
project/
├── index.js
├── server.js            # Web UI 与 API（可选使用）
├── config.json          # 默认配置（topK/source/导出/过滤策略等）
├── data/
│   ├── 期房-汇总.xlsx   # 期房数据（工作表：期房汇总）
│   └── 现房-汇总.xlsx   # 现房数据（工作表：现房汇总）
└── src/
    ├── data.js          # 启动时一次性加载 Excel，保留所有列
    ├── solver.js        # 核心组合搜索与 TopK
    ├── export.js        # 结果导出到 Excel
    ├── normalize.js     # 类型归一化（A/B/C/D 与 A类/B类/C类/D类）
    ├── bisect.js        # 二分查找工具
    ├── topk.js          # TopK 容器与去重
    └── cli.js           # 命令行入口
```

---

## 使用方式

### 命令行

```bash
node index.js --target 318.64 --topK 10 [--source AB] [--minArea 60] [--maxArea 140] [--refresh]
```

参数说明：
- `--target`：目标面积（必填）
- `--topK`：返回结果数量（默认 10）
- `--source`：来源选择（A / B / AB，默认 AB）
- `--minArea`：最小面积过滤（可选，剔除 area < minArea 的条目）
- `--maxArea`：最大面积过滤（可选，剔除 area > maxArea 的条目）
- `--refresh`：强制从 Excel 解析并覆盖 JSON 缓存（默认优先使用缓存）

说明：
- 数据会在启动时从 data/期房-汇总.xlsx 与 data/现房-汇总.xlsx 的指定工作表读入一次，并保留所有列。
- 仍然使用“建筑面积”作为面积字段参与计算与过滤。
- 结果条目的类型标签会附加“(期房)”或“(现房)”以标示来源。

---

## 配置文件与覆盖策略

- 配置文件：根目录下的 config.json，包含默认值：
  ```json
  {
    "topK": 10,
    "source": "AB",
    "excel": "./output.xlsx",
    "minArea": null,
    "maxArea": null,
    "policy": {
      "disallowDominantWithSmallOthers": true,
      "dominantMoreThan": 100,
      "othersLessThan": 70
    }
  }
  ```
  注：旧版的 `fileAPath` / `fileBPath` 不再使用，数据改为直接从 Excel 加载，若仍存在可忽略或删除。
- 覆盖优先级（从高到低）：
  1) 命令行参数（--topK / --source / --minArea / --maxArea）
  2) 代码传入的 options（solveTopK(target, options)）
  3) config.json 默认值（若未传入则采用）

- 面积过滤示例：
  ```bash
  node index.js --target 318.64 --minArea 63 --maxArea 126
  ```

---

## 导出为 Excel

支持将结果导出为 Excel（.xlsx）文件，表格名称为“TopK结果”，包含以下列：
- 条目1面积、条目1类型、条目2面积、条目2类型、条目3面积、条目3类型、条目4面积、条目4类型
- 兑换面积、目标面积、浪费面积

使用方式：
- 方式一：通过命令行参数
  - 指定输出路径：
    ```bash
    node index.js --target 318.64 --excel ./output.xlsx
    ```
  - 仅开启导出（使用默认路径或 config.json 中配置的 excel）：
    ```bash
    node index.js --target 318.64 --excel
    ```
- 方式二：通过配置文件 config.json
  - 在 config.json 中添加/修改：
    ```json
    {
      "excel": "./output.xlsx"
    }
    ```

覆盖优先级（从高到低）：命令行 --excel > config.json 的 excel 字段

---

## Web UI 与 API（可选）

- server.js 提供简易 HTTP 服务：
  - GET /           返回前端页面（public/index.html）
  - GET /config     返回当前配置
  - GET /solve      根据查询参数计算并返回 JSON 结果
  - GET /excel      根据查询参数计算并返回 Excel 文件下载
  - 启动参数：支持 --refresh（强制从 Excel 解析并覆盖缓存；默认优先使用 JSON 缓存）
- 前端页面不再允许传入数据文件路径，服务端会在启动时读取 Excel 并在内存中使用。

注意：若不需要 Web UI，可直接使用命令行。

---

## 输出示例

```js
{
  result: [
    [62.65, "A(期房)"],
    [64.35, "A(期房)"],
    [63.06, "B(现房)"],
    [128.57, "C(现房)"]
  ],
  "兑换面积": 318.63,
  "目标面积": 318.64,
  "浪费面积": 0.01
}
```

- 兑换面积：组合总面积
- 浪费面积：目标面积 - 兑换面积（越小越好）

---

## 错误与校验

- 若工作表不存在或为空，会抛出明确错误（例如：Excel 工作表不存在或无数据）。
- 若必需列缺失（如“建筑面积”、类型列），会抛出错误提示。
- 所有表头列都会被完整保留在内存数据结构中（以备扩展使用）。

---

## JSON 缓存与 --refresh

为提升启动速度，程序在首次解析 Excel 后会生成同目录的 JSON 缓存：
- 期房缓存：data/期房-汇总.json
- 现房缓存：data/现房-汇总.json

后续启动时，将优先从 JSON 缓存加载数据；仅在以下情况下重新解析 Excel 并覆盖缓存：
- 首次运行（JSON 缓存不存在）
- 显式传入 `--refresh` 标志（强制刷新）

说明：
- `--refresh` 同时适用于服务端与命令行：
  - 服务端示例：`node server.js --refresh`
  - 命令行示例：`node index.js --target 318.64 --topK 10 --refresh`
- 无论从 Excel 还是缓存 JSON 加载，都会进行表头校验：必须包含“建筑面积”与类型列（期房“类别”、现房“类型”）；缺失时会抛出错误。

仅刷新缓存（不启动服务）示例：
```bash
# 解析 Excel 并写入 JSON 缓存
node -e "require('./src/data')"

# 强制刷新（忽略现有 JSON）
node -e "process.argv.push('--refresh'); require('./src/data')"
```

## 运行环境

- Node.js ≥ 16
