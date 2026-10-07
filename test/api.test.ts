import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Store } from "../src/db";
import { AllocationService } from "../src/service";
import { createServer, listen } from "../src/server";
import { Server } from "node:http";

function request(port: number, method: string, urlPath: string, body?: unknown) {
  return new Promise<{ status: number; json: any }>((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = require("node:http").request(
      { host: "127.0.0.1", port, path: urlPath, method, headers: data ? { "Content-Type": "application/json" } : {} },
      (res: any) => {
        let raw = "";
        res.on("data", (c: Buffer) => (raw += c));
        res.on("end", () => resolve({ status: res.statusCode, json: raw ? JSON.parse(raw) : null }));
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

test("HTTP API 端到端：创建、分配、核验、错误码", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ft-api-"));
  const store = new Store(path.join(dir, "api.db"));
  const server: Server = createServer(new AllocationService(store));
  const port = await listen(server, 0);

  const health = await request(port, "GET", "/health");
  assert.equal(health.status, 200);

  const body = {
    rootId: "R",
    persons: [
      { id: "R", parentId: null, status: "deceased" },
      { id: "A", parentId: "R", status: "alive" },
      { id: "B", parentId: "R", status: "deceased" },
      { id: "B1", parentId: "B", status: "alive" },
      { id: "B2", parentId: "B", status: "alive" },
    ],
  };
  const created = await request(port, "POST", "/trees", body);
  assert.equal(created.status, 201);
  const treeId = created.json.treeId;

  const alloc = await request(port, "POST", `/trees/${treeId}/allocate`, {});
  assert.equal(alloc.status, 200);
  assert.equal(alloc.json.result.recipients[0].share.denominator, "2");

  const verify = await request(port, "POST", `/trees/${treeId}/verify`, {
    table: {
      entries: [
        { personId: "A", numerator: "1", denominator: "2" },
        { personId: "B1", numerator: "1", denominator: "3" },
        { personId: "B2", numerator: "1", denominator: "4" },
      ],
    },
  });
  assert.equal(verify.json.valid, false);
  assert.ok(verify.json.mismatches.some((m: any) => m.code === "SHARE_MISMATCH"));

  const bad = await request(port, "POST", "/trees", { rootId: "Z", persons: [{ id: "R", parentId: null, status: "alive" }] });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, "VALIDATION_FAILED");

  server.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});
