import { test } from "node:test";
import assert from "node:assert/strict";
import { validateTreeInput } from "../src/tree";
import { allocate, internalConsistencyChecks, fromFraction } from "../src/allocation";
import { verifyExternalTable } from "../src/verification";
import { equal, frac } from "../src/fraction";
import { TreeInput, InputPerson } from "../src/types";

const P = (id: string, parentId: string | null, status: "alive" | "deceased"): InputPerson => ({ id, parentId, status });

function tree(rootId: string, persons: Array<[string, string | null, "alive" | "deceased"]>): TreeInput {
  return { rootId, persons: persons.map(([id, p, s]) => P(id, p, s)) };
}

function run(input: TreeInput) {
  const checked = validateTreeInput(input);
  if (!checked.valid) throw new Error(checked.issues.map((i) => i.code).join(","));
  const result = allocate(checked.tree);
  const errors = internalConsistencyChecks(checked.tree, result);
  assert.deepEqual(errors, []);
  return { tree: checked.tree, result };
}

const shareOf = (input: TreeInput, id: string) => {
  const { result } = run(input);
  const r = result.recipients.find((x) => x.personId === id);
  return r ? fromFraction(r.share) : null;
};

test("题目示例：A=1/2，B1=B2=1/4，C 支系跳过", () => {
  const input = tree("R", [
    ["R", null, "deceased"],
    ["A", "R", "alive"],
    ["B", "R", "deceased"],
    ["C", "R", "deceased"],
    ["B1", "B", "alive"],
    ["B2", "B", "alive"],
    ["C1", "C", "deceased"],
  ]);
  const { result } = run(input);
  assert.ok(equal(shareOf(input, "A")!, frac(1, 2)));
  assert.ok(equal(shareOf(input, "B1")!, frac(1, 4)));
  assert.ok(equal(shareOf(input, "B2")!, frac(1, 4)));
  assert.equal(shareOf(input, "C"), null);
  assert.equal(result.noRecipient, false);
  assert.equal(result.unallocated.numerator, "0");
  assert.ok(result.skippedBranches.some((s) => s.childId === "C"));
});

test("A 有在世孩子时 A 仍独自受领，后代不越过他", () => {
  const input = tree("R", [
    ["R", null, "deceased"],
    ["A", "R", "alive"],
    ["B", "R", "deceased"],
    ["A1", "A", "alive"],
    ["B1", "B", "alive"],
  ]);
  assert.ok(equal(shareOf(input, "A")!, frac(1, 2)));
  assert.equal(shareOf(input, "A1"), null);
  assert.ok(equal(shareOf(input, "B1")!, frac(1, 2)));
});

test("单个合格支系得全部份额", () => {
  const input = tree("R", [
    ["R", null, "deceased"],
    ["X", "R", "deceased"],
    ["Y", "R", "deceased"],
    ["X1", "X", "alive"],
    ["Y1", "Y", "deceased"],
  ]);
  assert.ok(equal(shareOf(input, "X1")!, frac(1)));
});

test("连续多层已故节点：因子逐层相乘", () => {
  const input = tree("R", [
    ["R", null, "deceased"],
    ["D1", "R", "deceased"],
    ["D2", "D1", "deceased"],
    ["D3", "D2", "deceased"],
    ["L", "D3", "alive"],
  ]);
  const { result } = run(input);
  assert.ok(equal(shareOf(input, "L")!, frac(1)));
  assert.equal(result.recipients[0]!.path.length, 4);
});

test("全部无人受领：未分配份额为 1，不除以零", () => {
  const input = tree("R", [
    ["R", null, "deceased"],
    ["X", "R", "deceased"],
    ["Y", "R", "deceased"],
  ]);
  const { result } = run(input);
  assert.equal(result.noRecipient, true);
  assert.ok(equal(fromFraction(result.unallocated), frac(1)));
  assert.equal(result.recipients.length, 0);
});

test("三等分得到精确分数 1/3，小数只是展示", () => {
  const input = tree("R", [
    ["R", null, "deceased"],
    ["A", "R", "alive"],
    ["B", "R", "alive"],
    ["C", "R", "alive"],
  ]);
  for (const id of ["A", "B", "C"]) {
    assert.ok(equal(shareOf(input, id)!, frac(1, 3)));
  }
  const r = run(input).result.recipients[0]!;
  assert.match(r.share.decimal, /^0\.333333/);
  assert.equal(r.share.numerator + "/" + r.share.denominator, "1/3");
});

test("不同孩子顺序不改变分摊（顺序无关性）", () => {
  const mk = (order: string[]) =>
    tree("R", [
      ["R", null, "deceased"],
      ...order.map((id): [string, string, "alive"] => [id, "R", "alive"]),
    ]);
  const ids = ["A", "B", "C"];
  const r1 = run(mk(ids));
  const r2 = run(mk([...ids].reverse()));
  const map1 = new Map(r1.result.recipients.map((x) => [x.personId, x.share]));
  for (const x of r2.result.recipients) {
    assert.equal(x.share.numerator, map1.get(x.personId)!.numerator);
    assert.equal(x.share.denominator, map1.get(x.personId)!.denominator);
  }
});

test("路径因子乘积等于份额（小树手算）", () => {
  const input = tree("R", [
    ["R", null, "deceased"],
    ["A", "R", "alive"],
    ["B", "R", "deceased"],
    ["B1", "B", "alive"],
    ["B2", "B", "alive"],
  ]);
  const { result } = run(input);
  const b1 = result.recipients.find((x) => x.personId === "B1")!;
  assert.equal(b1.path.length, 2);
  assert.equal(b1.path[0]!.qualifyingBranchCount, 2);
  assert.equal(b1.path[0]!.factor.numerator, "1");
  assert.equal(b1.path[0]!.factor.denominator, "2");
  assert.equal(b1.path[1]!.qualifyingBranchCount, 2);
});

test("非法结构诊断：重复编号、未知父、多父、孤立节点、循环", () => {
  const dup = validateTreeInput(tree("R", [["R", null, "alive"], ["R", "A", "alive"]] as never));
  assert.equal(dup.valid, false);
  assert.ok(dup.issues.some((i) => i.code === "DUPLICATE_ID"));

  const unknown = validateTreeInput(tree("R", [["R", null, "alive"], ["X", "GHOST", "alive"]]));
  assert.ok(!unknown.valid && unknown.issues.some((i) => i.code === "UNKNOWN_PARENT"));

  const orphan = validateTreeInput(tree("R", [["R", null, "alive"], ["O", null, "alive"]]));
  assert.ok(!orphan.valid && orphan.issues.some((i) => i.code === "ROOT_NOT_UNIQUE_PARENT"));

  const detached = validateTreeInput(tree("R", [
    ["R", null, "alive"],
    ["X", "R", "alive"],
    ["O", "X2", "alive"],
    ["X2", "O", "alive"],
  ]));
  assert.ok(!detached.valid);
  assert.ok(detached.issues.some((i) => i.code === "CYCLE_DETECTED" || i.code === "ORPHAN_NODE"));
});

test("未知状态不能当作已故", () => {
  const bad = validateTreeInput({ rootId: "R", persons: [{ id: "R", parentId: null, status: "unknown" }] });
  assert.equal(bad.valid, false);
  assert.ok(bad.issues.some((i) => i.code === "INVALID_STATUS"));
});

test("独立核验：1/4 改成 1/3 给出具体不符", () => {
  const input = tree("R", [
    ["R", null, "deceased"],
    ["A", "R", "alive"],
    ["B", "R", "deceased"],
    ["B1", "B", "alive"],
    ["B2", "B", "alive"],
  ]);
  const { tree: t, result } = run(input);
  const ok = verifyExternalTable(t, result, {
    entries: [
      { personId: "A", numerator: "1", denominator: "2" },
      { personId: "B1", numerator: "1", denominator: "4" },
      { personId: "B2", numerator: "1", denominator: "4" },
    ],
  });
  assert.equal(ok.valid, true);

  const bad = verifyExternalTable(t, result, {
    entries: [
      { personId: "A", numerator: "1", denominator: "2" },
      { personId: "B1", numerator: "1", denominator: "3" },
      { personId: "B2", numerator: "1", denominator: "4" },
    ],
  });
  assert.equal(bad.valid, false);
  assert.ok(bad.mismatches.some((m) => m.code === "SHARE_MISMATCH" && m.personId === "B1"));
  assert.ok(bad.mismatches.some((m) => m.code === "TOTAL_NOT_ONE"));
});

test("核验：已故者被列示受领会被拒绝", () => {
  const input = tree("R", [["R", null, "deceased"], ["A", "R", "alive"]]);
  const { tree: t, result } = run(input);
  const vr = verifyExternalTable(t, result, { entries: [{ personId: "R", numerator: "1", denominator: "1" }] });
  assert.ok(vr.mismatches.some((m) => m.code === "DECEASED_LISTED" || m.code === "NOT_A_RECIPIENT"));
});
