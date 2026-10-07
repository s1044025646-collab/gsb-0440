import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Store } from "../src/db";
import { AllocationService, ServiceError } from "../src/service";
import { TreeInput } from "../src/types";

function v1(): TreeInput {
  return {
    rootId: "R",
    persons: [
      { id: "R", parentId: null, status: "deceased" },
      { id: "A", parentId: "R", status: "alive" },
      { id: "B", parentId: "R", status: "deceased" },
      { id: "B1", parentId: "B", status: "alive" },
      { id: "B2", parentId: "B", status: "alive" },
    ],
  };
}

function v2(): TreeInput {
  return {
    rootId: "R",
    persons: [
      { id: "R", parentId: null, status: "deceased" },
      { id: "A", parentId: "R", status: "deceased" },
      { id: "A1", parentId: "A", status: "alive" },
      { id: "A2", parentId: "A", status: "alive" },
      { id: "B", parentId: "R", status: "deceased" },
      { id: "B1", parentId: "B", status: "alive" },
      { id: "B2", parentId: "B", status: "alive" },
    ],
  };
}

function tempDb(): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "family-tree-"));
  return { dir, file: path.join(dir, "test.db") };
}

test("非法树保存时回滚，不留下半份版本/报告", () => {
  const { dir, file } = tempDb();
  const store = new Store(file);
  const svc = new AllocationService(store);
  assert.throws(
    () => svc.createTree({ rootId: "R", persons: [{ id: "R", parentId: "X", status: "alive" }] }, null),
    ServiceError,
  );
  assert.equal(store.db.prepare("SELECT COUNT(*) AS c FROM trees").get()!.c, 0);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS c FROM versions").get()!.c, 0);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS c FROM reports").get()!.c, 0);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test("状态改变新建版本，旧版本结果保持旧状态；重启后复算一致", () => {
  const { dir, file } = tempDb();
  let store = new Store(file);
  let svc = new AllocationService(store);
  const t = svc.createTree(v1(), null);
  svc.compute(t.treeId, 1);
  svc.addVersion(t.treeId, v2());
  svc.compute(t.treeId, 2);

  const oldA = svc.compute(t.treeId, 1).result.recipients.find((r) => r.personId === "A");
  assert.equal(oldA!.share.numerator + "/" + oldA!.share.denominator, "1/2");
  const newAllocation = svc.compute(t.treeId, 2).result;
  const a1 = newAllocation.recipients.find((r) => r.personId === "A1")!;
  assert.equal(a1.share.numerator + "/" + a1.share.denominator, "1/4");
  const b1 = newAllocation.recipients.find((r) => r.personId === "B1")!;
  assert.equal(b1.share.numerator + "/" + b1.share.denominator, "1/4");
  store.close();

  // 模拟重启：重新打开数据库，旧版本报告可取回且结果一致。
  store = new Store(file);
  svc = new AllocationService(store);
  const reopened = svc.compute(t.treeId, 1);
  assert.equal(reopened.cached, true);
  assert.equal(reopened.result.recipients.find((r) => r.personId === "A")!.share.denominator, "2");
  store.close();
  rmSync(dir, { recursive: true, force: true });
});
