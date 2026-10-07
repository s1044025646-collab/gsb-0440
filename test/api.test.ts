import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store";
import { Service } from "../src/service";
import { startServer } from "../src/server";
import { demoTreeV1 } from "../src/demo";
import type { Server } from "node:http";

let server: Server;
let base: string;

before(async () => {
  const service = new Service(new Store(":memory:"));
  const started = await startServer(service, 0);
  server = started.server;
  base = "http://127.0.0.1:" + started.port;
});

after(() => server.close());

async function put(path: string, body: unknown) {
  const res = await fetch(base + path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function post(path: string, body: unknown) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test("API：保存、计算、查询个人、跳过支系、核验、导出", async () => {
  const save = await put("/trees/api1", demoTreeV1());
  assert.equal(save.status, 201);
  assert.equal(save.body.version, 1);

  const alloc = await post("/trees/api1/allocate", {});
  assert.equal(alloc.status, 200);
  const result = alloc.body.result;
  const m = new Map<string, string>(result.shares.map((s: { personId: string; num: string; den: string }) => [s.personId, s.num + "/" + s.den]));
  assert.equal(m.get("A"), "1/2");
  assert.equal(m.get("B1"), "1/4");

  const share = await fetch(base + "/trees/api1/share/B1").then((r) => r.json());
  assert.equal(share.eligible, true);
  assert.equal(share.share.num, "1");
  assert.equal(share.share.den, "4");
  assert.equal(share.share.path.length, 2);

  const skipped = await fetch(base + "/trees/api1/skipped").then((r) => r.json());
  assert.equal(skipped.skippedBranches.length, 1);
  assert.equal(skipped.skippedBranches[0].childId, "C");

  const verifyOk = await post("/trees/api1/verify", {
    shares: [
      { personId: "A", num: "1", den: "2" },
      { personId: "B1", num: "1", den: "4" },
      { personId: "B2", num: "1", den: "4" },
    ],
  });
  assert.equal(verifyOk.body.ok, true);

  const verifyBad = await post("/trees/api1/verify", {
    shares: [
      { personId: "A", num: "1", den: "2" },
      { personId: "B1", num: "1", den: "3" },
      { personId: "B2", num: "1", den: "4" },
    ],
  });
  assert.equal(verifyBad.body.ok, false);
  assert.ok(verifyBad.body.issues.some((i: { code: string; personId?: string }) => i.code === "SHARE_MISMATCH" && i.personId === "B1"));

  const exp = await fetch(base + "/trees/api1/export").then((r) => r.json());
  assert.equal(exp.version, 1);
  assert.ok(exp.disclaimer.indexOf("不构成法律结论") !== -1);
});

test("API：非法树返回具体错误码且不落库", async () => {
  const bad = await put("/trees/bad1", {
    rootId: "R",
    persons: [
      { id: "R", parentId: null, alive: false },
      { id: "A", parentId: "X", alive: true },
    ],
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, "UNKNOWN_PARENT");
  const list = await fetch(base + "/trees").then((r) => r.json());
  assert.ok(!list.trees.includes("bad1"));
});
