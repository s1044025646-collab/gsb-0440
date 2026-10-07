# 家族树按支系代位分摊与份额来源核验后端

一个只运行在 Windows 本地、仅提供 **HTTP API 与 CLI** 的后端服务。它对**虚构家族树**
执行“按支系代位（per stirpes）”份额演算，用 **BigInt 有理数**精确计算每个在世受领人的份额，
并解释每一步分支选择、跳过了哪些支系，以及如何独立核验一张外部份额表。

本项目**不是法律工具**：不采集真实身份资料，不处理配偶、遗嘱、任何法域的法定继承规则或金钱支付，
输出也不构成法律结论。分配起点（根）本人只代表份额来源，**不参与受领**。

## 分配规则（本题定义）

从单位份额 `1` 开始，对每一个需要继续分配的**已故节点**：

1. 考察其每个**直接子支系**是否“含有可受领的在世节点”。
   - 子节点本人在世 → 该支系合格；
   - 子节点已故，但其后代中存在在世者 → 该支系合格；
   - 该子树没有任何在世后代 → 该支系**不占份额**（被跳过）。
2. 所有合格子支系**平分**进入该节点的份额，即每个支系分得 `1/k`（`k` 为合格支系数）。
3. 若子节点**在世**，由其拿走该支系整份并**停止向下传递**；若**已故**，在该支系内部递归执行同样规则。
4. 整棵树没有任何可受领后代时，返回“无人可分配”，**未分配份额为 1**，不除以零，也不把份额交给根。

### 与“按所有在世后代人数均分”的区别

- 本规则是**按支系**分，不是把全体在世后代放在一起平均。
- **在世者会挡住其后代**：A 在世时，即使 A 有在世孩子，A 支系仍由 A 独自取得，其孩子不再分得。
- 只有在某长辈**已故**时，份额才沿该支系向下代位。
- 绝空的支系直接消失，不参与分母，因此**不会**因为多出一个绝户支系而稀释其他人。

### 题目示例

根 R 有三个孩子：

- A 在世；
- B 已故，有两个在世孩子 B1、B2；
- C 已故，无在世后代。

R 的合格支系只有 A、B（C 绝户被跳过），故各得 `1/2`：

- A 在世 → A 得 `1/2`；
- B 已故 → B 的 `1/2` 在 B1、B2 间平分，各得 `1/4`；
- C 支系不占份额。

若把 A 改为已故且 A 有两个在世孩子 A1、A2，则 **A 支系内部** A1、A2 各得 `1/4`，
B 支系的 B1、B2 仍各得 `1/4`——不会被重算成四个人每人 `1/6` 的“全体均分”。

## 精确性保证

- 全部份额使用 `BigInt` 分子/分母表示并在每步**约分**，绝不使用浮点参与计算。
- 输出含 `numerator`/`denominator` 字符串，以及仅供展示的 `decimal`（默认 12 位，截断不进位影响份额）。
- 每个内部节点分出的合格支系份额之和等于进入份额；受领份额加未分配份额**精确等于 1**，
  不靠“最后一个人补差”。
- 节点输入顺序只影响可控的展示排序，最终分摊与顺序无关。

## 树结构要求与诊断

输入必须是以 `rootId` 为**唯一根**的有向树，每个非根节点恰有一个父节点。以下情况会给出带错误码的具体诊断：

| 错误码 | 含义 |
| --- | --- |
| `EMPTY_TREE` | 人员列表为空 |
| `MISSING_ROOT` | 指定根不在人员列表中 |
| `ROOT_NOT_UNIQUE_PARENT` | 出现第二个 `parentId=null` 的根，或指定根本身有父 |
| `DUPLICATE_ID` | 人员编号重复 |
| `UNKNOWN_PARENT` | 引用了不存在的父节点 |
| `PERSON_MULTIPLE_PARENTS` | 同一人有多个父节点（双亲家谱/交叉收养，不支持） |
| `ORPHAN_NODE` | 节点不属于指定根，为孤立或旁挂节点 |
| `CYCLE_DETECTED` | 检测到回到祖先的循环 |
| `INVALID_STATUS` | 状态不是明确的 `alive`/`deceased`（**未知不得当作已故**） |
| `MISSING_FIELD` / `INVALID_PAYLOAD` | 缺字段或载荷类型错误 |
| `TREE_TOO_LARGE` / `TREE_TOO_DEEP` | 超过上限（默认节点 10000、深度 1000），以清晰错误替代栈溢出 |

## 数据与版本

- SQLite 数据库保存在**项目内** `data/family-tree.db`（可用环境变量 `FAMILY_TREE_DATA_DIR` 更改目录）。
- 保存原始树、各人状态、**规则版本**（`branch-per-stirpes-1.0`）和每次演算报告。
- 人员状态改变时**新建版本**；旧版本及其报告原样保留，旧结果始终按旧状态解释。
- 保存与新建版本使用事务，非法树会**回滚**，不会留下半成品版本或“半份报告”。

运行时仅依赖 Node.js 内置的 `node:sqlite`（Node ≥ 22.5，开发环境为 Node 25），
无需 Docker、WSL、付费服务或任何在线 API。

## 快速开始（Windows PowerShell）

```powershell
npm install        # 安装 typescript 与类型（开发依赖）
npm run build      # 编译到 dist/
npm test           # 构建并运行全部测试
npm run demo       # 内置演示：示例、改状态新版本、正确/篡改核验
npm start          # 启动 HTTP 服务（默认自动选择空闲端口）
```

启动后控制台会打印实际端口，例如 `http://127.0.0.1:54457`。
可用环境变量指定端口与数据目录：

```powershell
$env:PORT="3000"
$env:FAMILY_TREE_DATA_DIR="$PWD\data"
npm start
```

## CLI 用法

```powershell
# 不落库：校验 / 计算（同时打印树状关系、受领表、来源路径）
node --no-warnings dist/src/cli.js validate examples/example.json
node --no-warnings dist/src/cli.js calc examples/example.json

# 独立核验外部份额表（退出码：0 通过，3 不符，2 树非法）
node --no-warnings dist/src/cli.js verify examples/example.json examples/table-correct.json
node --no-warnings dist/src/cli.js verify examples/example.json examples/table-tampered.json

# 落库版本管理
node --no-warnings dist/src/cli.js save examples/example.json 示例家族   # 返回 treeId
node --no-warnings dist/src/cli.js allocate 1                         # 计算最新版本
node --no-warnings dist/src/cli.js version 1 <新树.json>               # 状态改变后新建版本
node --no-warnings dist/src/cli.js allocate 1 1                       # 指定旧版本
node --no-warnings dist/src/cli.js export 1 1                         # 导出原树+报告 JSON
```

`calc`/`allocate` 的来源路径会逐层显示 `合格支系 k，× 1/k`，可直接手工连乘核对。

## HTTP API

所有请求/响应均为 JSON（`Content-Type: application/json`）。错误响应形如
`{ "error": { "code": "...", "message": "...", "issues": [...] } }`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查与规则版本 |
| POST | `/trees` | 保存新家族树（body 为树 JSON，可带 `name`），返回 `treeId` |
| POST | `/trees/:id/versions` | 人员状态改变后新建版本 |
| GET | `/trees/:id/versions` | 列出全部版本 |
| POST | `/trees/:id/allocate` | 计算分配；body 可含 `version`，否则用最新版本 |
| GET | `/trees/:id/persons/:personId/source` | 查询个人份额来源路径或被跳过原因 |
| GET | `/trees/:id/skipped` | 列出被跳过的绝户支系及原因 |
| POST | `/trees/:id/verify` | 独立核验外部份额表，body：`{ "version": n, "table": { "entries": [...] } }` |
| GET | `/trees/:id/export?version=n` | 导出原树与分配报告 |

创建树的请求体示例见 `examples/example.json`。外部份额表条目格式：

```json
{ "entries": [ { "personId": "B1", "numerator": "1", "denominator": "4" } ] }
```

### 独立核验做了什么

核验**不只是**把外部表加起来看是否等于 1，而是同时检查：

1. **资格**：列示者必须是树内存在的在世节点，且确为演算受领人（已故者、被在世长辈挡住者、绝户支系均不合格）；
2. **逐层份额**：每人份额必须与按支系演算结果逐分子/分母一致（把 `1/4` 改成 `1/3` 会报 `SHARE_MISMATCH`）；
3. **完整性**：不遗漏任何合格受领人，也不重复列示；
4. **总额**：声明总额必须精确为 1（篡改后常同时报 `TOTAL_NOT_ONE`）。

## 项目结构

```
src/
  types.ts       数据类型、错误码、规则版本与上限
  fraction.ts    BigInt 有理数（约分、四则、展示小数、解析）
  tree.ts        树结构校验与全部非法情形诊断（迭代式，防栈溢出）
  allocation.ts  按支系代位演算、来源路径、内部一致性自检
  verification.ts 独立核验外部份额表
  db.ts          SQLite 版本化存储（事务回滚、报告缓存）
  service.ts     编排：校验 -> 演算/取报告 -> 核验
  server.ts      原生 http JSON API，默认绑定 127.0.0.1 空闲端口
  cli.ts         命令行
  demo.ts        内置演示数据与流程
examples/        示例树与正确/篡改份额表
test/            node:test 单元、持久化与 HTTP 端到端测试
```

## 假设与限制

- 仅处理单根、单父的有向树；不支持双亲家谱、配偶、收养交叉。
- 根节点视为份额来源，即使标记为在世也不参与受领（其份额始终向子支系分配）。
- 受领人为空时未分配份额恒为 1；本项目不引入遗产管理人等额外主体。
- 展示小数默认截断到 12 位，仅用于阅读；一切判断以精确分数为准。
- 默认节点数 ≤ 10000、树深 ≤ 1000，可在 `src/types.ts` 的 `LIMITS` 调整。
- 服务仅监听本机回环地址 `127.0.0.1`，不含鉴权（定位为本地单机工具）。
