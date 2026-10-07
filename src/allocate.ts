import { Fraction, add, divByInt, frac, mul, toDecimal } from "./fraction";
import { AppError, Limits, DEFAULT_LIMITS, ValidatedTree } from "./model";
import { computeHasLivingDescendant } from "./tree";

export const RULE_VERSION = "per-stirpes-v1";

export interface PathStep {
  atNode: string;
  atNodeName: string;
  qualifiedBranches: number;
  factorNum: string;
  factorDen: string;
  note: string;
}

export interface ShareEntry {
  personId: string;
  name: string;
  num: string;
  den: string;
  decimal: string;
  path: PathStep[];
}

export interface SkippedBranch {
  atNode: string;
  atNodeName: string;
  childId: string;
  childName: string;
  reason: string;
}

export interface NodeAudit {
  nodeId: string;
  nodeName: string;
  incomingNum: string;
  incomingDen: string;
  qualifiedBranches: number;
  branchShareNum: string;
  branchShareDen: string;
  distributedSumNum: string;
  distributedSumDen: string;
}

export interface AllocationResult {
  ruleVersion: string;
  rootId: string;
  shares: ShareEntry[];
  skippedBranches: SkippedBranch[];
  unallocatedNum: string;
  unallocatedDen: string;
  unallocatedDecimal: string;
  totalCheck: string;
  nodeAudits: NodeAudit[];
}

interface Ctx {
  tree: ValidatedTree;
  hasLiving: Map<string, boolean>;
  shares: Map<string, { value: Fraction; path: PathStep[] }>;
  skipped: SkippedBranch[];
  audits: NodeAudit[];
  unallocated: Fraction;
  maxDepth: number;
}

function distribute(ctx: Ctx, nodeId: string, incoming: Fraction, path: PathStep[], depth: number): void {
  if (depth > ctx.maxDepth) {
    throw new AppError("LIMIT_EXCEEDED", `分配递归深度超过上限 ${ctx.maxDepth}`, { limit: "maxDepth" });
  }
  const { tree } = ctx;
  const node = tree.persons.get(nodeId)!;
  const kids = tree.children.get(nodeId)!;
  const qualified = kids.filter((c) => {
    const child = tree.persons.get(c)!;
    return child.alive || ctx.hasLiving.get(c)!;
  });
  const skippedHere = kids.filter((c) => !qualified.includes(c));
  for (const c of skippedHere) {
    const child = tree.persons.get(c)!;
    ctx.skipped.push({
      atNode: nodeId,
      atNodeName: node.name,
      childId: c,
      childName: child.name,
      reason: "该支系没有任何在世可受领后代，不占份额",
    });
  }

  if (qualified.length === 0) {
    // 没有合格支系：进入份额成为未分配份额。
    ctx.unallocated = add(ctx.unallocated, incoming);
    ctx.audits.push({
      nodeId,
      nodeName: node.name,
      incomingNum: incoming.n.toString(),
      incomingDen: incoming.d.toString(),
      qualifiedBranches: 0,
      branchShareNum: "0",
      branchShareDen: "1",
      distributedSumNum: "0",
      distributedSumDen: "1",
    });
    return;
  }

  const k = BigInt(qualified.length);
  const branchShare = divByInt(incoming, k);
  let distributed: Fraction = frac(0n);
  for (const c of qualified) {
    const child = tree.persons.get(c)!;
    const step: PathStep = {
      atNode: nodeId,
      atNodeName: node.name,
      qualifiedBranches: qualified.length,
      factorNum: "1",
      factorDen: qualified.length.toString(),
      note: `在 ${node.name} 处有 ${qualified.length} 个合格支系，本支系取得进入份额的 1/${qualified.length}`,
    };
    const childPath = [...path, step];
    distributed = add(distributed, branchShare);
    if (child.alive) {
      // 在世节点拿走整份，停止向下传递。
      ctx.shares.set(c, { value: branchShare, path: childPath });
    } else {
      distribute(ctx, c, branchShare, childPath, depth + 1);
    }
  }
  ctx.audits.push({
    nodeId,
    nodeName: node.name,
    incomingNum: incoming.n.toString(),
    incomingDen: incoming.d.toString(),
    qualifiedBranches: qualified.length,
    branchShareNum: branchShare.n.toString(),
    branchShareDen: branchShare.d.toString(),
    distributedSumNum: distributed.n.toString(),
    distributedSumDen: distributed.d.toString(),
  });
}

/** 核心演算：从根（份额来源，不参与受领）把单位 1 逐层按合格支系平分。 */
export function allocate(tree: ValidatedTree, limits: Limits = DEFAULT_LIMITS): AllocationResult {
  const hasLiving = computeHasLivingDescendant(tree);
  const ctx: Ctx = {
    tree,
    hasLiving,
    shares: new Map(),
    skipped: [],
    audits: [],
    unallocated: frac(0n),
    maxDepth: limits.maxDepth,
  };
  distribute(ctx, tree.rootId, frac(1n), [], 0);

  // 展示排序：按人员 id 字典序，保证输入顺序变化只影响可控排序。
  const shareEntries: ShareEntry[] = [...ctx.shares.entries()]
    .map(([personId, s]) => {
      // 核验路径乘积与份额一致。
      let product: Fraction = frac(1n);
      for (const step of s.path) {
        product = mul(product, frac(BigInt(step.factorNum), BigInt(step.factorDen)));
      }
      if (product.n !== s.value.n || product.d !== s.value.d) {
        throw new AppError("INTERNAL", `内部核验失败：${personId} 路径乘积不等于份额`);
      }
      return {
        personId,
        name: tree.persons.get(personId)!.name,
        num: s.value.n.toString(),
        den: s.value.d.toString(),
        decimal: toDecimal(s.value),
        path: s.path,
      };
    })
    .sort((a, b) => (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0));

  let total: Fraction = ctx.unallocated;
  for (const [, s] of ctx.shares) total = add(total, s.value);
  if (total.n !== 1n || total.d !== 1n) {
    throw new AppError("INTERNAL", "内部核验失败：受领份额加未分配份额不等于 1");
  }

  return {
    ruleVersion: RULE_VERSION,
    rootId: tree.rootId,
    shares: shareEntries,
    skippedBranches: ctx.skipped,
    unallocatedNum: ctx.unallocated.n.toString(),
    unallocatedDen: ctx.unallocated.d.toString(),
    unallocatedDecimal: toDecimal(ctx.unallocated),
    totalCheck: "1",
    nodeAudits: ctx.audits,
  };
}
