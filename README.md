# 面积组合最优解（Top-K）

这是一个使用 Node.js 编写的小工具，用于从两个数据文件（A.txt / B.txt）中，
计算 **总面积不超过目标值（≤ target）且最接近目标值的 Top-K 组合方案**。

---

## 核心规则

- 结果条数只能是 **3 条或 4 条**
- 户型必须覆盖 **A / B / C**（各至少 1 条）
- 4 条时，只允许某一类重复一次（如 A×2,B×1,C×1）
- **总面积 ≤ target**
- **至少 1 条必须来自 B.txt（xianfang）**
- 返回 **最优的前 K 条结果**（K 可配置）

---

## 文件结构

```text
project/
├── index.js
├── config.json        # 默认配置（topK/source/文件路径），可被命令行/代码覆盖
├── data/
│   ├── qifang.txt     # qifang 数据（期房）
│   └── xianfang.txt   # xianfang 数据（现房）
└── README.md
```

---

## 数据格式

支持以下任意一种：

### JS 变量形式（推荐）
```js
qifang = [
  [62.65, "A类"],
  [128.57, "C类"]
];
```

```js
xianfang = [
  [63.06, "B类"]
];
```

### 或 JSON 数组
```json
[
  [62.65, "A类"],
  [128.57, "C类"]
]
```

---

## 使用方式

### 命令行

```bash
node index.js --target 318.64 --topK 10 --A ./data/qifang.txt --B ./data/xianfang.txt
```

参数说明：
- `--target`：目标面积（必填）
- `--topK`：返回结果数量（默认 10）
- `--A`：data/qifang.txt 路径
- `--B`：data/xianfang.txt 路径

---

## 配置文件与覆盖策略

- 配置文件：根目录下的 config.json，包含默认值：
  ```json
  {
    "topK": 10,
    "source": "AB",
    "fileAPath": "./data/qifang.txt",
    "fileBPath": "./data/xianfang.txt",
    "excel": "./output.xlsx",
    "minArea": null,
    "maxArea": null
  }
  ```
- 覆盖优先级：
  1) 命令行参数（--topK / --source / --A / --B）
  2) 代码传入的 options（solveTopK(target, options)）
  3) config.json 默认值（若未传入则采用）
- 示例：
  - 不传入 A/B/source/topK 时，将自动使用 config.json 的默认值
  - 任意传入的参数均会覆盖默认值
  - 面积过滤（可选）：
    - 在 config.json 中设置 minArea/maxArea（为 null 或缺省表示不启用）
    - 或通过命令行传入 --minArea 和/或 --maxArea（命令行优先覆盖）
    - 处理逻辑：剔除面积 area < minArea 的条目，剔除面积 area > maxArea 的条目
    - 示例：`node index.js --target 318.64 --minArea 63 --maxArea 126`

## 导出为 Excel

支持将结果导出为 Excel（.xlsx）文件，表格名称为 “TopK结果”，包含以下列：
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
  - 未显式传入 --excel 时会使用此默认路径导出；若传入 --excel 则命令行优先。

注意：
- 覆盖优先级（从高到低）：命令行 --excel > config.json 的 excel 字段
- 若希望关闭默认导出，可删除或清空 config.json 中的 excel 字段

## 输出示例

```js
{
  result: [
    [62.65, "A(期房)"],
    [64.35, "A(期房)"],
    [63.06, "B(期房)"],
    [128.57, "C(现房)"]
  ],
  "兑换面积": 318.63,
  "目标面积": 318.64,
  "浪费面积": 0.01
}
```

- `兑换面积`：组合总面积  
- `浪费面积`：`目标面积 - 兑换面积`（越小越好）

---

## 说明

- 结果已自动按 **最接近 target** 排序
- 若无解，返回空数组
- 建议 `topK ≤ 50`

---

## 运行环境

- Node.js ≥ 16
