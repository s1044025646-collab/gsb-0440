import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTree } from "../src/tree";
import { allocate } from "../src/allocate";
import { AppError, TreeInput } from "../src/model";
import { demoTreeV1, demoTreeV2 } from "../src/demo";

function sharesOf(input: TreeInput) {
  const r = allocate(buildTree(input));
  return new Map(r.shares.map((s) => [s.personId, `${s.num}/${s.den}`]));
}

test("已知示例：A=1/2, B1=B2=1/4, C 支系不占份额", () => {
  const r = allocate(buildTree(demoTreeV1()));
  const m = new Map(r.shares.map((s) => [s.personId, `${s.num}/${s.den}`]));
  assert.equal(m.get("A"), "1/2");
  assert.equal(m.get("B1"), "1/4");
  assert.equal(m.get("B2"), "1/4");
  assert.equal(m.size, 3);
  assert.equal(r.unallocatedNum, "0");
  assert.equal(r.skippedBranches.length, 1);
  assert.equal(r.skippedBranches[0].childId, "C");
});

test("A 有在世孩子时，A 仍独自受领整份", () => {
  const t = demoTreeV1();
  t.persons.push(
    { id: "A1", parentId: "A", alive: true },
    { id: "A2", parentId: "A", alive: true }
  );
  const m = sharesOf(t);
  assert.equal(m.get("A"), "1/2");
  assert.equal(m.has("A1"), false);
  assert.equal(m.has("A2"), false);
});

test("A 改已故后新版本：A1/A2 各 1/4，B 支系不变", () => {
  const m = sharesOf(demoTreeV2());
  assert.equal(m.get("A1"), "1/4");
  assert.equal(m.get("A2"), "1/4");
  assert.equal(m.get("B1"), "1/4");
  assert.equal(m.get("B2"), "1/4");
});

test("单个合格支系：份额原样下传", () => {
  const m = sharesOf({
    rootId: "R",
    persons: [
      { id: "R", parentId: null, alive: false },
      { id: "X", parentId: "R", alive: false },
      { id: "Y", parentId: "X", alive: true },
    ],
  });
  assert.equal(m.get("Y"), "1/1");
});

test("连续多层已故节点", () => {
  const m = sharesOf({
    rootId: "R",
    persons: [
      { id: "R", parentId: null, alive: false },
      { id: "A", parentId: "R", alive: false },
      { id: "B", parentId: "A", alive: false },
      { id: "C", parentId: "B", alive: false },
      { id: "D", parentId: "C", alive: true },
      { id: "E", parentId: "C", alive: true },
    ],
  });
  assert.equal(m.get("D"), "1/2");
  assert.equal(m.get("E"), "1/2");
});

test("全部无人受领：未分配份额为 1，不除以零", () => {
  const r = allocate(
    buildTree({
      rootId: "R",
      persons: [
        { id: "R", parentId: null, alive: false },
        { id: "A", parentId: "R", alive: false },
        { id: "B", parentId: "A", alive: false },
      ],
    })
  );
  assert.equal(r.shares.length, 0);
  assert.equal(r.unallocatedNum, "1");
  assert.equal(r.unallocatedDen, "1");
});

test("三等分精确分数：各 1/3，路径乘积核对", () => {
  const r = allocate(
    buildTree({
      rootId: "R",
      persons: [
        { id: "R", parentId: null, alive: false },
        { id: "A", parentId: "R", alive: true },
        { id: "B", parentId: "R", alive: true },
        { id: "C", parentId: "R", alive: true },
      ],
    })
  );
  for (const s of r.shares) {
    assert.equal(`${s.num}/${s.den}`, "1/3");
    assert.equal(s.path.length, 1);
    assert.equal(s.path[0].qualifiedBranches, 3);
  }
});

test("混合层级：根下 A 在世、B 已故(B1 在世、B2 已故->B2a/B2b 在世)", () => {
  const m = sharesOf({
    rootId: "R",
    persons: [
      { id: "R", parentId: null, alive: false },
      { id: "A", parentId: "R", alive: true },
      { id: "B", parentId: "R", alive: false },
      { id: "B1", parentId: "B", alive: true },
      { id: "B2", parentId: "B", alive: false },
      { id: "B2a", parentId: "B2", alive: true },
      { id: "B2b", parentId: "B2", alive: true },
    ],
  });
  assert.equal(m.get("A"), "1/2");
  assert.equal(m.get("B1"), "1/4");
  assert.equal(m.get("B2a"), "1/8");
  assert.equal(m.get("B2b"), "1/8");
});

test("孩子输入顺序变化只影响排序，不改变分摊", () => {
  const base = demoTreeV1();
  const reversed: TreeInput = { rootId: base.rootId, persons: [...base.persons].reverse() };
  const m1 = sharesOf(base);
  const m2 = sharesOf(reversed);
  assert.deepEqual([...m1.entries()].sort(), [...m2.entries()].sort());
});

test("每个内部节点分出的合格支系份额总和等于进入份额", () => {
  const r = allocate(buildTree(demoTreeV2()));
  for (const a of r.nodeAudits) {
    if (a.qualifiedBranches === 0) continue;
    // branchShare * k == incoming（精确分数比较）
    const lhsNum = BigInt(a.branchShareNum) * BigInt(a.qualifiedBranches);
    const lhsDen = BigInt(a.branchShareDen);
    const rhsNum = BigInt(a.incomingNum);
    const rhsDen = BigInt(a.incomingDen);
    assert.equal(lhsNum * rhsDen, rhsNum * lhsDen, `节点 ${a.nodeId} 分出总和不等于进入份额`);
    assert.equal(a.distributedSumNum, a.incomingNum);
    assert.equal(a.distributedSumDen, a.incomingDen);
  }
});

test("非法树诊断：未知父引用", () => {
  assert.throws(
    () =>
      buildTree({
        rootId: "R",
        persons: [
          { id: "R", parentId: null, alive: false },
          { id: "A", parentId: "ZZZ", alive: true },
        ],
      }),
    (e: unknown) => e instanceof AppError && (e as AppError).code === "UNKNOWN_PARENT"
  );
});

test("非法树诊断：重复编号", () => {
  assert.throws(
    () =>
      buildTree({
        rootId: "R",
        persons: [
          { id: "R", parentId: null, alive: false },
          { id: "R", parentId: null, alive: false },
        ],
      }),
    (e: unknown) => e instanceof AppError && (e as AppError).code === "DUPLICATE_ID"
  );
});

test("非法树诊断：循环", () => {
  assert.throws(
    () =>
      buildTree({
        rootId: "R",
        persons: [
          { id: "R", parentId: null, alive: false },
          { id: "A", parentId: "B", alive: true },
          { id: "B", parentId: "A", alive: true },
        ],
      }),
    (e: unknown) => e instanceof AppError && (e as AppError).code === "ORPHAN_NODES"
  );
});

test("非法树诊断：孤立节点", () => {
  assert.throws(
    () =>
      buildTree({
        rootId: "R",
        persons: [
          { id: "R", parentId: null, alive: false },
          { id: "A", parentId: "R", alive: true },
          { id: "X", parentId: "Y", alive: true },
          { id: "Y", parentId: "X", alive: true },
        ],
      }),
    (e: unknown) => e instanceof AppError && (e as AppError).code === "ORPHAN_NODES"
  );
});

test("非法树诊断：状态未知（非布尔）", () => {
  assert.throws(
    () =>
      buildTree({
        rootId: "R",
        persons: [
          { id: "R", parentId: null, alive: false },
          { id: "A", parentId: "R", alive: "unknown" as unknown as boolean },
        ],
      }),
    (e: unknown) => e instanceof AppError && (e as AppError).code === "UNKNOWN_STATUS"
  );
});

test("深度限制以清晰错误替代栈溢出", () => {
  const persons = [{ id: "n0", parentId: null as string | null, alive: false }];
  for (let i = 1; i <= 300; i++) {
    persons.push({ id: `n${i}`, parentId: `n${i - 1}`, alive: i === 300 });
  }
  assert.throws(
    () => buildTree({ rootId: "n0", persons }, { maxNodes: 10000, maxDepth: 200 }),
    (e: unknown) => e instanceof AppError && (e as AppError).code === "LIMIT_EXCEEDED"
  );
});
