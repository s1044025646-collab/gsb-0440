import { AppError, DEFAULT_LIMITS, Limits, Person, PersonInput, TreeInput, ValidatedTree } from "./model";

/** 校验并构建树。任何非法输入都抛出带错误码的 AppError。 */
export function buildTree(input: TreeInput, limits: Limits = DEFAULT_LIMITS): ValidatedTree {
  if (!input || typeof input !== "object") {
    throw new AppError("INVALID_INPUT", "输入必须是对象 { rootId, persons[] }");
  }
  const { rootId, persons } = input;
  if (typeof rootId !== "string" || rootId.length === 0) {
    throw new AppError("INVALID_ROOT", "rootId 必须是非空字符串");
  }
  if (!Array.isArray(persons)) {
    throw new AppError("INVALID_INPUT", "persons 必须是数组");
  }
  if (persons.length > limits.maxNodes) {
    throw new AppError("LIMIT_EXCEEDED", `节点数 ${persons.length} 超过上限 ${limits.maxNodes}`, {
      limit: "maxNodes",
      max: limits.maxNodes,
      actual: persons.length,
    });
  }

  const map = new Map<string, Person>();
  for (const p of persons) {
    if (!p || typeof p.id !== "string" || p.id.length === 0) {
      throw new AppError("INVALID_PERSON", "每个人员必须有非空字符串 id", { person: p });
    }
    if (map.has(p.id)) {
      throw new AppError("DUPLICATE_ID", `编号重复: ${p.id}`, { id: p.id });
    }
    if (typeof p.alive !== "boolean") {
      throw new AppError(
        "UNKNOWN_STATUS",
        `人员 ${p.id} 的 alive 必须明确为 true 或 false，未知状态不允许按已故处理`,
        { id: p.id }
      );
    }
    if (p.parentId !== null && typeof p.parentId !== "string") {
      throw new AppError("INVALID_PARENT", `人员 ${p.id} 的 parentId 必须是字符串或 null`, { id: p.id });
    }
    map.set(p.id, { id: p.id, name: p.name ?? p.id, parentId: p.parentId, alive: p.alive });
  }

  if (!map.has(rootId)) {
    throw new AppError("ROOT_NOT_FOUND", `指定的根 ${rootId} 不在人员列表中`, { rootId });
  }
  const root = map.get(rootId)!;
  if (root.parentId !== null) {
    throw new AppError("ROOT_HAS_PARENT", `根节点 ${rootId} 的 parentId 必须为 null`, { rootId });
  }

  // 父引用检查：未知引用、多父（由重复编号+唯一 parentId 字段天然避免，仍校验父存在性）。
  for (const p of map.values()) {
    if (p.parentId !== null && !map.has(p.parentId)) {
      throw new AppError("UNKNOWN_PARENT", `人员 ${p.id} 引用了不存在的父节点 ${p.parentId}`, {
        id: p.id,
        parentId: p.parentId,
      });
    }
    if (p.id !== rootId && p.parentId === null) {
      throw new AppError("MULTIPLE_ROOTS", `人员 ${p.id} 没有父节点但不是指定的根，树必须有唯一根`, {
        id: p.id,
      });
    }
  }

  // 从根出发遍历，检测循环、孤立节点与深度。
  const children = new Map<string, string[]>();
  for (const p of map.values()) children.set(p.id, []);
  for (const p of map.values()) {
    if (p.parentId !== null) children.get(p.parentId)!.push(p.id);
  }

  const visited = new Set<string>();
  const stack: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];
  while (stack.length > 0) {
    const { id, depth } = stack.pop()!;
    if (depth > limits.maxDepth) {
      throw new AppError("LIMIT_EXCEEDED", `树深度超过上限 ${limits.maxDepth}`, {
        limit: "maxDepth",
        max: limits.maxDepth,
      });
    }
    if (visited.has(id)) {
      throw new AppError("CYCLE_DETECTED", `检测到循环，节点 ${id} 被重复到达`, { id });
    }
    visited.add(id);
    for (const c of children.get(id)!) stack.push({ id: c, depth: depth + 1 });
  }
  if (visited.size !== map.size) {
    const orphans = [...map.keys()].filter((id) => !visited.has(id));
    throw new AppError("ORPHAN_NODES", "存在不属于指定根的孤立节点", { orphans });
  }

  return { rootId, persons: map, children };
}

/** 每个节点的子树中是否含有在世可受领节点（根除外语义由调用方控制）。 */
export function computeHasLivingDescendant(tree: ValidatedTree): Map<string, boolean> {
  const result = new Map<string, boolean>();
  const order: string[] = [];
  const stack = [tree.rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    order.push(id);
    for (const c of tree.children.get(id)!) stack.push(c);
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    let has = false;
    for (const c of tree.children.get(id)!) {
      const child = tree.persons.get(c)!;
      if (child.alive || result.get(c)!) {
        has = true;
        break;
      }
    }
    result.set(id, has);
  }
  return result;
}
