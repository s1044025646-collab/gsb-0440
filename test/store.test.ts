import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store";
import { Service } from "../src/service";
import { AppError } from "../src/model";
import { demoTreeV1, demoTreeV2 } from "../src/demo";

function makeService(): Service {
  return new Service(new Store(":memory:"));
}

test("状态改变生成新版本，旧版本结果保持旧状态解释", () => {
  const svc = makeService();
  const v1 = svc.saveTree("t1", demoTreeV1());
  const v2 = svc.saveTree("t1", demoTreeV2());
  assert.equal(v1.version, 1);
  assert.equal(v2.version, 2);

  const r1 = svc.compute("t1", 1).result;
  const r2 = svc.compute("t1", 2).result;
  const m1 = new Map(r1.shares.map((s) => [s.personId, `${s.num}/${s.den}`]));
  const m2 = new Map(r2.shares.map((s) => [s.personId, `${s.num}/${s.den}`]));
  assert.equal(m1.get("A"), "1/2");
  assert.equal(m1.has("A1"), false);
  assert.equal(m2.has("A"), false);
  assert.equal(m2.get("A1"), "1/4");
  assert.equal(m2.get("B1"), "1/4");
  svc.store.close();
});

test("相同内容重复保存复用版本号", () => {
  const svc = makeService();
  const v1 = svc.saveTree("t1", demoTreeV1());
  const v2 = svc.saveTree("t1", demoTreeV1());
  assert.equal(v1.version, v2.version);
  svc.store.close();
});

test("非法树不落库（回滚），不留下半份数据", () => {
  const svc = makeService();
  svc.saveTree("t1", demoTreeV1());
  assert.throws(
    () =>
      svc.saveTree("t1", {
        rootId: "R",
        persons: [
          { id: "R", parentId: null, alive: false },
          { id: "A", parentId: "NOPE", alive: true },
        ],
      }),
    (e: unknown) => e instanceof AppError && (e as AppError).code === "UNKNOWN_PARENT"
  );
  assert.equal(svc.store.latestVersion("t1"), 1);
  assert.deepEqual(svc.store.listTrees(), ["t1"]);
  svc.store.close();
});

test("重启后可取回原版本重新计算同样结果（文件库）", () => {
  const fs = require("node:fs") as typeof import("node:fs");
  const os = require("node:os") as typeof import("node:os");
  const path = require("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fst-"));
  const db = path.join(dir, "t.db");

  const svc1 = new Service(new Store(db));
  svc1.saveTree("t1", demoTreeV1());
  const r1 = svc1.compute("t1", 1).result;
  svc1.store.close();

  const svc2 = new Service(new Store(db));
  const r2 = svc2.compute("t1", 1).result;
  assert.deepEqual(r2, r1);
  svc2.store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("个人来源查询：在世被阻断者不给份额", () => {
  const svc = makeService();
  const t = demoTreeV1();
  t.persons.push({ id: "A1", parentId: "A", alive: true });
  svc.saveTree("t1", t);
  const res = svc.personShare("t1", "A1");
  assert.equal(res.eligible, false);
  const resA = svc.personShare("t1", "A");
  assert.equal(resA.eligible, true);
  svc.store.close();
});
