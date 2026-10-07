import { allocate, AllocationResult, RULE_VERSION } from "./allocate";
import { AppError, DEFAULT_LIMITS, Limits, TreeInput } from "./model";
import { Store } from "./store";
import { buildTree } from "./tree";
import { ExternalShare, verifyShares, VerifyReport } from "./verify";

export class Service {
  constructor(
    public store: Store,
    public limits: Limits = DEFAULT_LIMITS
  ) {}

  saveTree(treeId: string, input: TreeInput) {
    // 先校验，非法树不落库（保证错误输入不留下半份数据）。
    buildTree(input, this.limits);
    return this.store.saveVersion(treeId, input, RULE_VERSION);
  }

  validate(treeId: string, version?: number) {
    const row = this.store.getVersion(treeId, version);
    buildTree(row.input, this.limits);
    return { treeId, version: row.version, valid: true, nodeCount: row.input.persons.length };
  }

  compute(treeId: string, version?: number): { reportId: string; version: number; result: AllocationResult } {
    const row = this.store.getVersion(treeId, version);
    const tree = buildTree(row.input, this.limits);
    const result = allocate(tree, this.limits);
    const reportId = this.store.saveReport(treeId, row.version, row.ruleVersion, result);
    return { reportId, version: row.version, result };
  }

  personShare(treeId: string, personId: string, version?: number) {
    const row = this.store.getVersion(treeId, version);
    const tree = buildTree(row.input, this.limits);
    if (!tree.persons.has(personId)) {
      throw new AppError("PERSON_NOT_FOUND", `人员 ${personId} 不在树中`, { personId });
    }
    const result = allocate(tree, this.limits);
    const share = result.shares.find((s) => s.personId === personId);
    if (!share) {
      const person = tree.persons.get(personId)!;
      return {
        personId,
        eligible: false,
        reason: person.alive
          ? "该人员虽在世，但其受领路径被更近的在世祖先阻断"
          : "该人员已故或根节点本人，不参与受领",
      };
    }
    return { personId, eligible: true, share };
  }

  skipped(treeId: string, version?: number) {
    const row = this.store.getVersion(treeId, version);
    const tree = buildTree(row.input, this.limits);
    return allocate(tree, this.limits).skippedBranches;
  }

  verify(treeId: string, external: ExternalShare[], version?: number): VerifyReport {
    const row = this.store.getVersion(treeId, version);
    const tree = buildTree(row.input, this.limits);
    const expected = allocate(tree, this.limits);
    return verifyShares(tree, expected, external);
  }

  export(treeId: string, version?: number) {
    const row = this.store.getVersion(treeId, version);
    const tree = buildTree(row.input, this.limits);
    const result = allocate(tree, this.limits);
    return {
      treeId,
      version: row.version,
      ruleVersion: row.ruleVersion,
      exportedAt: new Date().toISOString(),
      input: row.input,
      result,
      disclaimer: "本输出为虚构规则演算结果，不构成法律结论。",
    };
  }
}
