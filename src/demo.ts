import { Store } from "./db";
import { AllocationService } from "./service";
import { ExternalShareEntry, TreeInput } from "./types";

/** 题目示例：根 R；A 在世；B 已故有 B1、B2 在世；C 已故无在世后代。 */
export function exampleTree(): TreeInput {
  const P = (id: string, parentId: string | null, status: "alive" | "deceased", name?: string) => {
    const p: import("./types").InputPerson = { id, parentId, status };
    if (name) p.name = name;
    return p;
  };
  return {
    rootId: "R",
    persons: [
      P("R", null, "deceased", "分配起点"),
      P("A", "R", "alive", "甲"),
      P("B", "R", "deceased", "乙"),
      P("C", "R", "deceased", "丙"),
      P("B1", "B", "alive", "乙一"),
      P("B2", "B", "alive", "乙二"),
      P("C1", "C", "deceased", "丙一"),
    ],
  };
}

/** 第二版：把 A 改为已故，且 A 有两个在世孩子 A1、A2。 */
export function exampleTreeV2(): TreeInput {
  const v1 = exampleTree();
  const persons = v1.persons.map((p) => (p.id === "A" ? { ...p, status: "deceased" as const } : p));
  persons.push({ id: "A1", parentId: "A", status: "alive", name: "甲一" });
  persons.push({ id: "A2", parentId: "A", status: "alive", name: "甲二" });
  return { rootId: "R", persons };
}

function brief(resultId: string, label: string, svc: AllocationService, treeId: number, version: number): void {
  const outcome = svc.compute(treeId, version);
  console.log(`\n=== ${label}（treeId=${treeId}, v${version}）===`);
  for (const r of outcome.result.recipients) {
    console.log(`  ${r.personId}: ${r.share.numerator}/${r.share.denominator}`);
  }
  console.log(`  未分配: ${outcome.result.unallocated.numerator}/${outcome.result.unallocated.denominator}`);
  for (const s of outcome.result.skippedBranches) console.log(`  跳过: ${s.detail}`);
  console.log(`  合计=1 自检: ${outcome.result.totalsToOne ? "通过" : "失败"} (${resultId})`);
}

export function runDemo(dbPath: string): void {
  const store = new Store(dbPath);
  const svc = new AllocationService(store);

  console.log("演示一：题目示例（A 在世；B 已故有 B1/B2；C 已故无在世后代）");
  const t1 = svc.createTree(exampleTree(), "示例家族");
  brief("v1", "v1：A 在世", svc, t1.treeId, 1);
  console.log("  预期：A=1/2，B1=1/4，B2=1/4，C 支系不占份额。");

  console.log("\n演示二：A 改为已故并新增 A1、A2（新建版本，旧版本保留）");
  svc.addVersion(t1.treeId, exampleTreeV2());
  brief("v2", "v2：A 已故", svc, t1.treeId, 2);
  console.log("  预期：A 支系内部 A1=1/4、A2=1/4；B 支系 B1=B2=1/4；不会被重算为全体 1/6 均分。");

  brief("v1-again", "重新读取 v1（旧状态仍解释为 A=1/2）", svc, t1.treeId, 1);

  console.log("\n演示三：独立核验外部份额表");
  const correctEntries: ExternalShareEntry[] = [
    { personId: "A", numerator: "1", denominator: "2" },
    { personId: "B1", numerator: "1", denominator: "4" },
    { personId: "B2", numerator: "1", denominator: "4" },
  ];
  const ok = svc.verify(t1.treeId, { entries: correctEntries }, 1);
  console.log(`  正确表核验: ${ok.valid ? "通过" : "未通过"}`);

  // 故意把应为 1/4 的 B1 改成 1/3，剩余照填使其总额仍可能被识破。
  const tampered: ExternalShareEntry[] = [
    { personId: "A", numerator: "1", denominator: "2" },
    { personId: "B1", numerator: "1", denominator: "3" },
    { personId: "B2", numerator: "1", denominator: "4" },
  ];
  const bad = svc.verify(t1.treeId, { entries: tampered }, 1);
  console.log("  篡改表（B1 由 1/4 改成 1/3）核验结果：");
  for (const m of bad.mismatches) console.log(`    [${m.code}] ${m.message}`);

  console.log("\nCLI 可进一步运行： allocate <treeId> 1 查看完整树状图与来源路径。");
  store.close();
}
