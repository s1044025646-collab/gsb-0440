import { AllocationResult } from "./allocate";
import { ValidatedTree } from "./model";

export function renderTree(tree: ValidatedTree): string {
  const lines: string[] = [];
  const walk = (id: string, prefix: string, isLast: boolean, isRoot: boolean): void => {
    const p = tree.persons.get(id)!;
    const label = `${p.name} [${p.id}] ${p.alive ? "在世" : "已故"}${isRoot ? "（份额来源，不受领）" : ""}`;
    if (isRoot) {
      lines.push(label);
    } else {
      lines.push(prefix + (isLast ? "└─ " : "├─ ") + label);
    }
    const kids = tree.children.get(id)!;
    const childPrefix = isRoot ? "" : prefix + (isLast ? "   " : "│  ");
    kids.forEach((c, i) => walk(c, childPrefix, i === kids.length - 1, false));
  };
  walk(tree.rootId, "", true, true);
  return lines.join("\n");
}

export function renderResult(result: AllocationResult): string {
  const lines: string[] = [];
  lines.push(`规则版本: ${result.ruleVersion}`);
  lines.push("受领表:");
  if (result.shares.length === 0) lines.push("  （无人可受领）");
  for (const s of result.shares) {
    lines.push(`  ${s.name} [${s.personId}]: ${s.num}/${s.den} (≈${s.decimal})`);
    for (const step of s.path) {
      lines.push(
        `    └ 在 ${step.atNodeName} [${step.atNode}]：合格支系数=${step.qualifiedBranches}，因子 ${step.factorNum}/${step.factorDen}`
      );
    }
  }
  lines.push(`未分配份额: ${result.unallocatedNum}/${result.unallocatedDen} (≈${result.unallocatedDecimal})`);
  if (result.skippedBranches.length > 0) {
    lines.push("被跳过的支系:");
    for (const sk of result.skippedBranches) {
      lines.push(`  ${sk.atNodeName} [${sk.atNode}] 的子支系 ${sk.childName} [${sk.childId}]：${sk.reason}`);
    }
  }
  lines.push(`总额核验: 受领合计 + 未分配 = ${result.totalCheck}`);
  return lines.join("\n");
}
