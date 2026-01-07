# 技术图谱：index.js

本文档以 Mermaid 流程图描述 index.js（及模块化后的 src/*）的核心逻辑与数据流，包括输入解析、数据加载、类型归一化、候选生成、组合搜索（3 条与 4 条）、约束校验以及 TopK 维护。

```mermaid
flowchart TD
  A[开始] --> B{入口}
  B -->|命令行| C[解析参数 parseArgs()]
  B -->|API| E[调用 solveTopK(target, options)]
  C --> D[提取 target、topK、fileAPath、fileBPath、source]
  D --> E

  subgraph solveTopK
    direction TB
    E --> F[fileAName = basename(fileAPath)]
    F --> G[fileBName = basename(fileBPath)]
    G --> H[loadArrayFromTxt(fileAPath, 变量优先: qifang/A/a/data/list)]
    H --> I[loadArrayFromTxt(fileBPath, 变量优先: xianfang/B/b/data/list)]
    I --> J[为每条记录附加来源文件名 (A.txt 或 B.txt)]
    J --> K{source 选项}
    K -->|A| L[candidates = A]
    K -->|B| M[candidates = B]
    K -->|AB| N[candidates = A ∪ B]
    L --> O[bestTopKCombos(candidates, target, fileAName, fileBName, topK)]
    M --> O
    N --> O
  end

  subgraph bestTopKCombos
    direction TB
    O --> P[过滤与归一化:
      - area > 0
      - type 经 normalizeType ∈ {A,B,C}
      - srcFile ∈ {fileAName, fileBName}]
    P --> Q[按类型分组: byType.A/B/C]
    Q --> R[每组按 area 升序排序]
    R --> S{A/B/C 是否均至少 1 条?}
    S -- 否 --> Z1[返回空数组 []]
    S -- 是 --> T[初始化 topList = []，seenKeys = Set()]
    T --> U[hasAtLeastOneFromB(picked): 至少包含 1 条来自 B.txt]
    U --> V[tryCollect(picked, sum):
      - sum ≤ target
      - 包含 ≥1 条来自 B.txt
      - pushTopK(topList)]
    V --> W[枚举 3 条组合:
      对 a∈A, b∈B，
      在 C 中 pickBestUnderOrEqual(target - (a+b))]
    W --> X[枚举 4 条组合 enumFour:
      - A×2 + B + C
      - B×2 + A + C
      - C×2 + A + B
      （某一类重复一次 + 其余两类各一条）]
    X --> Y[映射 topList 为输出:
      result, sum, target, gap]
    Y --> Z[返回按 sum 降序的 TopK]
  end

  subgraph TopK 维护
    direction TB
    V --> P1[makeKey(picked):
      对每项构造 "area-type-srcFile"，排序后用 "|" 连接]
    P1 --> P2[pushTopK:
      - 未出现则加入
      - 按 sum 降序排序
      - 超出 K 删最差并清理 seen]
  end

  subgraph 辅助函数
    direction TB
    R --> H1[bisectRightByArea(arr, maxArea)]
    H1 --> H2[pickBestUnderOrEqual(arr, maxArea)]
    P --> N1[normalizeType:
      接受 A/B/C/D 或 A类/B类/C类/D类,
      返回规范化的 A/B/C/D]
  end

  Z1 --> Z
```

关键约束：
- 结果条数只能为 3 或 4。
  - 3 条：必须恰好各 1 条 A、B、C。
  - 4 条：在 A/B/C 基础上仅允许某一类重复一次（两条同类 + 另外两类各一条）。
- 面积和必须 ≤ target，且尽量接近 target（gap 越小越好）。
- 最终结果中至少有 1 条来自 B.txt（xianfang）。
- 类型统一为 A/B/C，D 不进入最终组合。
- TopK 保持去重与按 sum 降序。

输入/输出：
- 输入：target、topK、fileAPath（./data/qifang.txt）、fileBPath（./data/xianfang.txt）、source（"A" | "B" | "AB"）
- 输出项：{ result: [[area, type], ...], sum, target, gap }（来自 data/qifang.txt 的类型追加“(期房)”；来自 data/xianfang.txt 的类型追加“(现房)”。例如：[66.83, "A(期房)"], [125.68, "C(现房)"]）

---

## 文件说明

- index.js：对 src/* 模块的薄封装。直接执行时运行 CLI；作为库引入时，导出公共 API（solveTopK、bestTopKCombos、normalizeType、loadArrayFromTxt）。
- src/cli.js：命令行入口。解析命令行参数（target、topK、A、B、source）并输出 JSON 结果。
- src/solver.js：核心求解模块。实现 bestTopKCombos（枚举 + 剪枝 + 二分 + TopK）与 solveTopK（数据加载、来源选择、结果格式化）。
- src/io.js：文件加载工具。支持从纯 JSON 数组或 JS 变量赋值（如 qifang = [...] / xianfang = [...]）中解析数组，并使用沙箱 VM 执行。
- src/normalize.js：类型归一化工具。将 "A类"/"B类"/"C类"/"D类" 或 "A"/"B"/"C"/"D" 统一为规范 "A"/"B"/"C"/"D"。
- src/bisect.js：按面积有序数组的二分查找辅助（bisectRightByArea、pickBestUnderOrEqual）。
- src/topk.js：Top-K 集合维护与去重（makeKey、pushTopK），保证按 sum 降序并限制最多 K 条。
- README.md：面向用户的概述、规则、使用示例与输出格式说明。
- tech.md：技术文档，包含算法流程图与文件说明。
- requirement.txt：原始需求与约束（中文），描述输入、目标与期望输出。
- data/qifang.txt：A 来源（qifang）的示例/输入数据文件，包含若干 [area, type] 行。
- data/xianfang.txt：B 来源（xianfang）的示例/输入数据文件，包含若干 [area, type] 行。
