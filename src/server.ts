import http, { IncomingMessage, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { AllocationService, ServiceError } from "./service";
import { RULE_VERSION } from "./types";

interface Route {
  method: string;
  pattern: RegExp;
  handler: (params: Record<string, string>, body: unknown, res: ServerResponse) => void;
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const text = JSON.stringify(data, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 5 * 1024 * 1024) {
        reject(new ServiceError("INVALID_PAYLOAD", "请求体超过 5MB 限制"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve(null);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch {
        reject(new ServiceError("INVALID_PAYLOAD", "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

export function createServer(service: AllocationService): http.Server {
  const routes: Route[] = [
    {
      method: "GET",
      pattern: /^\/health$/,
      handler: (_p, _b, res) => sendJson(res, 200, { ok: true, ruleVersion: RULE_VERSION }),
    },
    {
      method: "POST",
      pattern: /^\/trees$/,
      handler: (_p, body, res) => {
        const b = body as { name?: string } & Record<string, unknown>;
        if (!b || typeof b !== "object") throw new ServiceError("INVALID_PAYLOAD", "请求体无效");
        const { name, ...rest } = b;
        const out = service.createTree(rest as never, typeof name === "string" ? name : null);
        sendJson(res, 201, out);
      },
    },
    {
      method: "POST",
      pattern: /^\/trees\/(\d+)\/versions$/,
      handler: (p, body, res) => {
        const out = service.addVersion(Number(p.id), body as never);
        sendJson(res, 201, out);
      },
    },
    {
      method: "GET",
      pattern: /^\/trees\/(\d+)\/versions$/,
      handler: (p, _b, res) => {
        const list = service.listVersions(Number(p.id));
        sendJson(res, 200, { versions: list.map((v) => ({ version: v.version, ruleVersion: v.rule_version, createdAt: v.created_at })) });
      },
    },
    {
      method: "POST",
      pattern: /^\/trees\/(\d+)\/allocate$/,
      handler: (p, body, res) => {
        const version = (body as { version?: number } | null)?.version;
        sendJson(res, 200, service.compute(Number(p.id), version));
      },
    },
    {
      method: "GET",
      pattern: /^\/trees\/(\d+)\/persons\/([^/]+)\/source$/,
      handler: (p, _b, res) => {
        const source = service.getPersonSource(Number(p.id), decodeURIComponent(p.person as string));
        sendJson(res, 200, source);
      },
    },
    {
      method: "GET",
      pattern: /^\/trees\/(\d+)\/skipped$/,
      handler: (p, _b, res) => {
        const outcome = service.compute(Number(p.id));
        sendJson(res, 200, { skippedBranches: outcome.result.skippedBranches });
      },
    },
    {
      method: "POST",
      pattern: /^\/trees\/(\d+)\/verify$/,
      handler: (p, body, res) => {
        const b = body as { version?: number; table?: unknown };
        if (!b || typeof b.table !== "object") {
          throw new ServiceError("INVALID_PAYLOAD", "需要提供 table 字段");
        }
        const result = service.verify(Number(p.id), b.table as never, b.version);
        sendJson(res, 200, result);
      },
    },
    {
      method: "GET",
      pattern: /^\/trees\/(\d+)\/export$/,
      handler: (p, _b, res) => {
        const v = service.getVersionPayload(Number(p.id));
        const outcome = service.compute(Number(p.id));
        sendJson(res, 200, { version: v.version, ruleVersion: v.rule_version, tree: v.payload, allocation: outcome.result });
      },
    },
  ];

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url as string, "http://localhost");
      let body: unknown = null;
      if (req.method === "POST") body = await readBody(req);
      for (const route of routes) {
        if (route.method !== req.method) continue;
        const m = route.pattern.exec(url.pathname);
        if (!m) continue;
        const params: Record<string, string> = {};
        const names = ["id", "person"];
        m.slice(1).forEach((g, i) => (params[names[i] as string] = g));
        route.handler(params, body, res);
        return;
      }
      sendJson(res, 404, { error: { code: "NOT_FOUND", message: `路径 ${url.pathname} 不存在` } });
    } catch (e) {
      if (e instanceof ServiceError) {
        sendJson(res, 400, { error: { code: e.code, message: e.message, issues: e.issues } });
        return;
      }
      sendJson(res, 500, { error: { code: "INTERNAL", message: (e as Error).message } });
    }
  });

  return server;
}

/** 在端口 0 上监听让系统分配空闲端口，或使用指定端口。 */
export function listen(server: http.Server, preferredPort?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(preferredPort ?? 0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve(addr.port);
    });
  });
}
