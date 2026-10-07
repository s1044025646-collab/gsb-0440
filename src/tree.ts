import { LIMITS, TreeInput, ValidationIssue, InputPerson } from "./types";

export interface ValidTree {
  rootId: string;
  /** id -> 节点 */
  nodes: Map<string, InputPerson>;
  /** 父 id -> 直接子节点（保持输入顺序，便于可控排序） */
  childrenOf: Map<string, InputPerson[]>;
  depth: number;
}

interface IssueCollector {
  issues: ValidationIssue[];
  add(code: ValidationIssue["code"], message: string, personId?: string): void;
}

function makeCollector(): IssueCollector {
  return {
    issues: [],
    add(code, message, personId) {
      this.issues.push(personId ? { code, message, personId } : { code, message });
    },
  };
}

/**
 * 校验输入是否为以 rootId 为唯一根的有向树：
 * 每个非根节点恰有一个父节点，无重复 id、未知引用、多父、循环、孤立节点。
 */
export function validateTreeInput(input: unknown): { valid: false; issues: ValidationIssue[] } | { valid: true; tree: ValidTree } {
  const c = makeCollector();

  if (typeof input !== "object" || input === null) {
    c.add("INVALID_PAYLOAD", "请求体必须是对象");
    return { valid: false, issues: c.issues };
  }
  const payload = input as Partial<TreeInput>;
  const persons = payload.persons;
  const rootId = payload.rootId;

  if (typeof rootId !== "string" || rootId.trim() === "") {
    c.add("MISSING_FIELD", "rootId 必须为非空字符串");
  }
  if (!Array.isArray(persons)) {
    c.add("MISSING_FIELD", "persons 必须为数组");
    return { valid: false, issues: c.issues };
  }
  if (persons.length === 0) {
    c.add("EMPTY_TREE", "树不能为空");
    return { valid: false, issues: c.issues };
  }
  if (persons.length > LIMITS.maxNodes) {
    c.add("TREE_TOO_LARGE", `节点数 ${persons.length} 超过上限 ${LIMITS.maxNodes}`);
    return { valid: false, issues: c.issues };
  }

  const nodes = new Map<string, InputPerson>();
  // childId -> 声明它为孩子的父 id 集合，用于检测同一人多父 / 重复编号
  const parentClaims = new Map<string, Set<string>>();

  for (const raw of persons) {
    if (typeof raw !== "object" || raw === null) {
      c.add("INVALID_PAYLOAD", "存在不是对象的人员条目");
      continue;
    }
    const p = raw as Partial<InputPerson>;
    if (typeof p.id !== "string" || p.id.trim() === "") {
      c.add("MISSING_FIELD", "每个人员必须有非空 id");
      continue;
    }
    const id = p.id;
    if (!("parentId" in p) || (p.parentId !== null && typeof p.parentId !== "string")) {
      c.add("MISSING_FIELD", `人员 ${id} 的 parentId 必须为字符串或 null`, id);
    }
    if (p.status !== "alive" && p.status !== "deceased") {
      c.add("INVALID_STATUS", `人员 ${id} 的状态必须明确为 alive 或 deceased，未知不能当作已故`, id);
    }
    if (nodes.has(id)) {
      c.add("DUPLICATE_ID", `重复编号：${id} 出现多次`, id);
      continue;
    }
    const node: InputPerson = { id, parentId: p.parentId ?? null, status: p.status as InputPerson["status"] };
    if (typeof p.name === "string") node.name = p.name;
    nodes.set(id, node);
  }

  if (typeof rootId === "string" && !nodes.has(rootId)) {
    c.add("MISSING_ROOT", `指定根 ${rootId} 不在人员列表中`);
  }

  // 未知父引用 & 根判定
  for (const p of nodes.values()) {
    if (p.parentId === null) {
      if (p.id !== rootId) {
        c.add("ROOT_NOT_UNIQUE_PARENT", `节点 ${p.id} 的 parentId 为 null，但不是指定根 ${String(rootId)}；树只能有一个根`, p.id);
      }
    } else {
      if (!nodes.has(p.parentId)) {
        c.add("UNKNOWN_PARENT", `节点 ${p.id} 引用了不存在的父节点 ${p.parentId}`, p.id);
      } else {
        const claims = parentClaims.get(p.id) ?? new Set<string>();
        claims.add(p.parentId);
        parentClaims.set(p.id, claims);
        if (p.id === rootId) {
          c.add("ROOT_NOT_UNIQUE_PARENT", `指定根 ${p.id} 不能拥有父节点 ${p.parentId}`, p.id);
        }
      }
    }
  }

  // 同一人被多个人声明为孩子（双亲家谱 / 交叉收养结构）
  for (const [childId, claims] of parentClaims) {
    if (claims.size > 1) {
      c.add("PERSON_MULTIPLE_PARENTS", `节点 ${childId} 有多个父节点：${[...claims].join(", ")}`, childId);
    }
  }

  if (c.issues.length > 0) {
    return { valid: false, issues: c.issues };
  }

  const childrenOf = new Map<string, InputPerson[]>();
  for (const p of nodes.values()) {
    if (p.parentId !== null) {
      const list = childrenOf.get(p.parentId) ?? [];
      list.push(p);
      childrenOf.set(p.parentId, list);
    }
  }

  const safeRoot = rootId as string;

  // 从指定根做迭代式遍历，检测循环、孤立节点并计算深度。
  const reachable = new Set<string>();
  let depth = 0;
  // 每层为待访问的 id；使用“是否已到达”检测回到祖先的边。
  let frontier: string[] = [safeRoot];
  reachable.add(safeRoot);
  while (frontier.length > 0) {
    if (depth > LIMITS.maxDepth) {
      c.add("TREE_TOO_DEEP", `树深超过上限 ${LIMITS.maxDepth}`);
      return { valid: false, issues: c.issues };
    }
    const next: string[] = [];
    for (const id of frontier) {
      for (const child of childrenOf.get(id) ?? []) {
        if (reachable.has(child.id)) {
          c.add("CYCLE_DETECTED", `检测到循环：节点 ${child.id} 回到了已访问的祖先链`, child.id);
          return { valid: false, issues: c.issues };
        }
        reachable.add(child.id);
        next.push(child.id);
      }
    }
    frontier = next;
    if (next.length > 0) depth += 1;
  }

  for (const id of nodes.keys()) {
    if (!reachable.has(id)) {
      c.add("ORPHAN_NODE", `节点 ${id} 不属于指定根 ${safeRoot}，为孤立或旁挂节点`, id);
    }
  }

  if (c.issues.length > 0) {
    return { valid: false, issues: c.issues };
  }

  return { valid: true, tree: { rootId: safeRoot, nodes, childrenOf, depth } };
}
