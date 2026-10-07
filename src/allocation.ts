import {
  AllocationResult,
  Fraction,
  PathStep,
  RecipientShare,
  RULE_VERSION,
  SkippedBranch,
} from "./types";
import {
  BigFraction,
  add,
  equal,
  frac,
  isZero,
  mul,
  reciprocalOfInt,
  toStrings,
} from "./fraction";
import { ValidTree } from "./tree";

interface WorkItem {
  /** 已故、需要继续在其子支系间分配的节点 id（根为虚拟起点）。 */
  nodeId: string;
  /** 进入该节点的份额。 */
  incoming: BigFraction;
  /** 从根到该节点（不含该节点本身那一层选择）的路径。 */
  path: PathStep[];
}

/** 判断某节点子树内是否存在在世节点（含该节点本身由调用处区分）。 */
function subtreeHasLiving(tree: ValidTree, startId: string): boolean {
  const stack = [startId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    const node = tree.nodes.get(id);
    if (node && node.status === "alive") return true;
    for (const child of tree.childrenOf.get(id) ?? []) {
      stack.push(child.id);
    }
  }
  return false;
}

/**
 * 按支系代位（per stirpes）演算。
 *
 * 规则：对已故节点，其直接子支系中“含可受领在世节点”的为合格支系；
 * 合格支系平分进入份额；在世子节点拿走整份并停止，已故子节点递归。
 * 根节点本人仅代表份额来源，不参与受领。
 */
export function allocate(tree: ValidTree): AllocationResult {
  const recipients = new Map<string, RecipientShare>();
  const skippedBranches: SkippedBranch[] = [];
  let unallocated: BigFraction = frac(0);

  const queue: WorkItem[] = [{ nodeId: tree.rootId, incoming: frac(1), path: [] }];

  while (queue.length > 0) {
    const item = queue.shift() as WorkItem;
    const children = tree.childrenOf.get(item.nodeId) ?? [];

    const qualified: typeof children = [];
    for (const child of children) {
      // 子节点在世：支系合格且由其整份受领；已故：只有其后代存在在世者才合格。
      const living =
        child.status === "alive" ? true : subtreeHasLiving(tree, child.id);
      if (living) {
        qualified.push(child);
      } else {
        skippedBranches.push({
          atNodeId: item.nodeId,
          childId: child.id,
          reason: "no_living_descendant",
          detail: `节点 ${item.nodeId} 的子支系 ${child.id} 没有任何在世后代，不占份额`,
        });
      }
    }

    if (qualified.length === 0) {
      // 该节点份额无人可受领；根层即整棵树无人受领。
      unallocated = add(unallocated, item.incoming);
      continue;
    }

    const k = qualified.length;
    const branchFactor = reciprocalOfInt(k);
    const branchShare = mul(item.incoming, branchFactor);

    for (const child of qualified) {
      const step: PathStep = {
        atNodeId: item.nodeId,
        childId: child.id,
        qualifyingBranchCount: k,
        factor: toFraction(branchFactor),
      };
      const childPath = [...item.path, step];
      if (child.status === "alive") {
        const existing = recipients.get(child.id);
        const share: RecipientShare = {
          personId: child.id,
          share: toFraction(branchShare),
          path: childPath,
        } as RecipientShare;
        if (child.name) share.name = child.name;
        if (existing) {
          // 树结构保证每人只有一条来源路径；合并仅为防御性处理。
          existing.share = toFraction(add(fromFraction(existing.share), branchShare));
        } else {
          recipients.set(child.id, share);
        }
      } else {
        queue.push({ nodeId: child.id, incoming: branchShare, path: childPath });
      }
    }
  }

  const recipientList = [...recipients.values()].sort((a, b) =>
    a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0,
  );

  let distributed: BigFraction = frac(0);
  for (const r of recipientList) {
    distributed = add(distributed, fromFraction(r.share));
  }
  const total = add(distributed, unallocated);
  const totalsToOne = equal(total, frac(1));

  return {
    rootId: tree.rootId,
    recipients: recipientList,
    unallocated: toFraction(unallocated),
    skippedBranches,
    noRecipient: recipientList.length === 0,
    totalsToOne,
  };
}

/** 结构性自检：每个内部节点分出的合格支系份额之和必须等于进入份额。 */
export function internalConsistencyChecks(tree: ValidTree, result: AllocationResult): string[] {
  const errors: string[] = [];
  if (!result.totalsToOne) {
    errors.push("受领份额与未分配份额之和不等于 1");
  }
  // 复核每个在世节点：其路径因子乘积应等于其声明份额。
  for (const r of result.recipients) {
    let product: BigFraction = frac(1);
    for (const step of r.path) {
      product = mul(product, fromFraction(step.factor));
    }
    if (!equal(product, fromFraction(r.share))) {
      errors.push(`受领人 ${r.personId} 的路径因子乘积与声明份额不符`);
    }
    const node = tree.nodes.get(r.personId);
    if (!node || node.status !== "alive") {
      errors.push(`受领人 ${r.personId} 不具备在世受领资格`);
    }
  }
  if (!result.noRecipient && !isZero(fromFraction(result.unallocated))) {
    errors.push("存在受领人但未分配份额非零");
  }
  if (result.noRecipient && !equal(fromFraction(result.unallocated), frac(1))) {
    errors.push("无人受领时未分配份额必须为 1");
  }
  return errors;
}

export function toFraction(f: BigFraction): Fraction {
  return toStrings(f);
}

export function fromFraction(f: Fraction): BigFraction {
  return frac(f.numerator, f.denominator);
}

export { RULE_VERSION };
