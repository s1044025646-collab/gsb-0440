# 家族树按支系代位分摊与份额来源核验后端

一个纯本地的演算服务：输入一个分配起点、后代树和各人的在世/已故状态，把单位总份额 `1`
按**逐层按合格支系平分**的规则分到在世受领人，并解释每一步分支选择、核验外部份额表。

> 本项目只对虚构家族树做规则演算。不采集真实身份资料，不处理配偶、遗嘱、法定地区规则
> 或金钱支付，输出**不构成任何法律结论**。

## 分摊规则（与"按人数均分"的区别）

起点（根）本人只代表份额来源，**不参与受领**。从根开始，对每个需要继续分配的已故节点：

1. 查看它的每个**直接子支系**是否含有可受领的在世节点；没有任何在世后代的支系**不占份额**（记为被跳过支系）。
2. 每个**合格子支系**平分进入该节点的份额。
3. 子节点**在世**：由其拿走整份，**停止向下传递**（其后代不会越过他再拿一份）。
4. 子节点**已故**：在该支系内部递归执行同样规则。

因此**不能**把所有在世后代直接平均。例如根有 A（在世）、B（已故，有在世孩子 B1/B2）、
C（已故无在世后代）：

- 按支系代位：合格支系只有 A、B → A 得 `1/2`，B1、B2 各得 `1/4`，C 支系不占份额。
- 按人数均分（错误）：A、B1、B2 各得 `1/3`。

若 A 自己也有在世孩子，A 支系仍由 A 独自受领 `1/2`；只有 A 已故后，其孩子才在 A 支系
内部代位（此时其他支系份额不被重算成全体均分）。

整棵树没有任何可受领后代时，返回"无人可分配"，未分配份额为 `1/1`，不会除以零，也不会
把份额任意交给根节点。

## 精确性

- 份额全程用 **BigInt 有理数**计算并约分，输出分子/分母字符串；小数仅供展示，改变展示
  精度不影响份额。
- 每条来源路径包含沿途各层的合格支系数与相乘因子（每层 `1/k`），路径乘积精确等于份额。
- 所有受领份额 + 未分配份额**精确等于 1**，不靠最后一个人补差。
- 人员输入顺序变化只影响展示排序（按 id 字典序），不改变分摊结果。

## 输入约束与错误码

输入必须是有唯一根的有向树：每个非根节点恰有一个父节点。不处理双亲家谱或交叉收养。
各人状态必须明确为 `alive: true/false`，未知状态不会被当作已故。

| 错误码 | 含义 |
| --- | --- |
| `INVALID_INPUT` / `INVALID_PERSON` / `INVALID_PARENT` / `INVALID_ROOT` | 输入结构不合法 |
| `DUPLICATE_ID` | 编号重复 |
| `UNKNOWN_PARENT` | 引用了不存在的父节点 |
| `ROOT_NOT_FOUND` / `ROOT_HAS_PARENT` / `MULTIPLE_ROOTS` | 根定义不合法 |
| `CYCLE_DETECTED` | 检测到循环 |
| `ORPHAN_NODES` | 存在不属于指定根的孤立节点 |
| `UNKNOWN_STATUS` | 在世状态未明确给出 |
| `LIMIT_EXCEEDED` | 超过节点数/深度上限（以清晰错误替代栈溢出） |
| `TREE_NOT_FOUND` / `VERSION_NOT_FOUND` / `PERSON_NOT_FOUND` / `REPORT_NOT_FOUND` | 查询对象不存在 |

上限可通过环境变量配置：`FST_MAX_NODES`（默认 10000）、`FST_MAX_DEPTH`（默认 200）。

## 运行环境

- Windows 本地，Node.js ≥ 22.5（使用内置 `node:sqlite`，无需 Docker/WSL/外部服务）。
- 安装依赖：`npm install`

## 常用命令

```powershell
npm run build     # 编译 TypeScript 到 dist/
npm test          # 构建并运行全部测试
npm run demo      # 内置演示：A/B/C 示例 + A 改已故的新版本
npm start         # 启动 API 服务（默认端口 0 = 自动选择空闲端口）
```

CLI（`node dist/src/cli.js <命令>`）：

| 命令 | 说明 |
| --- | --- |
| `serve [--port N]` | 启动 API（端口可用 `--port` 或环境变量 `PORT`，默认 0 自动选空闲端口） |
| `demo` | 运行演示并打印树状关系、受领表与来源路径 |
| `save <treeId> <file.json>` | 校验并保存家族树（内容变化生成新版本；非法树不落库） |
| `validate <treeId> [--version N]` | 校验已保存版本 |
| `allocate <treeId> [--version N]` | 计算分配、保存报告并打印树/受领表/来源路径 |
| `share <treeId> <personId> [--version N]` | 查询个人份额与来源路径 |
| `skipped <treeId> [--version N]` | 说明被跳过的支系及原因 |
| `verify <treeId> <shares.json> [--version N]` | 独立核验外部份额表 |
| `export <treeId> [--version N]` | 导出原树、规则版本与完整结果 JSON |
| `compute-file <file.json>` | 对文件中的树一次性计算（不写数据库） |
| `list` | 列出已保存的家族树 |

数据保存在项目内 `data/familytree.db`（可用 `FST_DATA_DIR`、`FST_DB` 覆盖）。
人员状态改变会保存为新版本；旧版本的报告继续按旧状态解释，重启后可取回原版本
重新计算并得到同样结果。

## HTTP API

所有错误返回 `{"error": {"code", "message", "details"}}`。

| 方法与路径 | 说明 |
| --- | --- |
| `PUT /trees/:id` | 保存家族树版本，body: `{rootId, persons:[{id,name?,parentId,alive}]}` |
| `GET /trees` / `GET /trees/:id` | 列出树 / 列出版本 |
| `POST /trees/:id/validate?version=N` | 校验 |
| `POST /trees/:id/allocate?version=N` | 计算分配并保存报告 |
| `GET /trees/:id/share/:personId?version=N` | 个人份额与来源路径 |
| `GET /trees/:id/skipped?version=N` | 被跳过的支系 |
| `POST /trees/:id/verify?version=N` | 核验外部份额表，body: `{shares:[{personId,num,den}]}` |
| `GET /trees/:id/export?version=N` | 导出 |
| `GET /trees/:id/reports` | 列出已保存报告 |
| `GET /health` | 健康检查 |

## 独立核验的判定标准

核验**不是**只看"加起来等于一"。它逐项检查：

1. 每个受领人的资格（必须在世、在树中、未被更近的在世祖先阻断）；
2. 每条份额与按规则重算的精确分数是否一致（层级分配核验）；
3. 外部份额总和 + 未分配份额是否**精确**等于 1。

例如把 B1 应为 `1/4` 故意写成 `1/3`，会返回 `SHARE_MISMATCH`（期望 1/4，实际 1/3）
以及 `TOTAL_MISMATCH`（实际总额 13/12）。即使把总额凑成 1 但层级分错（如 B1 拿 1/2、
漏掉 B2），也会因 `SHARE_MISMATCH` + `MISSING_RECIPIENT` 判为不正确。

## 项目结构

```
src/fraction.ts   BigInt 有理数（约分、加减乘、展示小数）
src/tree.ts       树校验（唯一根、循环、孤立、未知引用、状态明确、深度/节点上限）
src/allocate.ts   核心演算：逐层按合格支系平分 + 来源路径 + 跳过支系 + 节点审计
src/verify.ts     外部份额表独立核验
src/store.ts      SQLite 持久化（树版本、报告）
src/service.ts    API 与 CLI 共用的业务层
src/server.ts     HTTP API（可配置端口，默认自动选空闲端口）
src/cli.ts        命令行入口
src/demo.ts       内置演示数据
test/             node:test 测试（27 个用例）
```

## 限制

- 只处理本题定义的单亲树形分摊；不处理双亲家谱、交叉收养、配偶、遗嘱或任何地区法定规则。
- `node:sqlite` 在 Node 25 仍标记为实验特性（会有启动警告），但功能稳定可用。
- 小树（默认上限 1 万节点 / 200 层）场景设计；超过上限会返回清晰错误而非栈溢出。
