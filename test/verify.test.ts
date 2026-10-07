import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTree } from "../src/tree";
import { allocate } from "../src/allocate";
import { verifyShares } from "../src/verify";
import { demoTreeV1 } from "../src/demo";

function setup() {
  const tree = buildTree(demoTreeV1());
  const expected = allocate(tree);
  return { tree, expected };
}

test("正确的外部份额表通过核验", () => {
  const { tree, expected } = setup();
  const report = verifyShares(tree, expected, [
    { personId: "A", num: "1", den: "2" },
    { personId: "B1", num: "1", den: "4" },
    { personId: "B2", num: "1", den: "4" },
  ]);
  assert.equal(report.ok, true);
  assert.equal(report.issues.length, 0);
});

test("把 1/4 故意改成 1/3 会给出具体不符（即使不只看总额）", () => {
  const { tree, expected } = setup();
  const report = verifyShares(tree, expected, [
    { personId: "A", num: "1", den: "2" },
    { personId: "B1", num: "1", den: "3" },
    { personId: "B2", num: "1", den: "4" },
  ]);
  assert.equal(report.ok, false);
  const mismatch = report.issues.find((i) => i.code === "SHARE_MISMATCH");
  assert.ok(mismatch);
  assert.equal(mismatch.personId, "B1");
  assert.deepEqual(mismatch.expected, { num: "1", den: "4" });
  assert.deepEqual(mismatch.actual, { num: "1", den: "3" });
  assert.ok(report.issues.some((i) => i.code === "TOTAL_MISMATCH"));
});

test("总额凑成 1 但层级错误仍判不正确", () => {
  const { tree, expected } = setup();
  // A=1/2, B1=1/2, 缺 B2：总额=1 但分配错误。
  const report = verifyShares(tree, expected, [
    { personId: "A", num: "1", den: "2" },
    { personId: "B1", num: "1", den: "2" },
  ]);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.code === "SHARE_MISMATCH" && i.personId === "B1"));
  assert.ok(report.issues.some((i) => i.code === "MISSING_RECIPIENT" && i.personId === "B2"));
  assert.ok(!report.issues.some((i) => i.code === "TOTAL_MISMATCH"));
});

test("已故者作为受领人被拒绝", () => {
  const { tree, expected } = setup();
  const report = verifyShares(tree, expected, [
    { personId: "A", num: "1", den: "2" },
    { personId: "B1", num: "1", den: "4" },
    { personId: "B2", num: "1", den: "8" },
    { personId: "B", num: "1", den: "8" },
  ]);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.code === "INELIGIBLE_RECIPIENT" && i.personId === "B"));
});
