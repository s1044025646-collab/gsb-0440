import * as http from "node:http";
import { AppError } from "./model";
import { Service } from "./service";

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 5 * 1024 * 1024) {
        reject(new AppError("PAYLOAD_TOO_LARGE", "请求体超过 5MB 限制"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch {
        reject(new AppError("INVALID_JSON", "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

export function createServer(service: Service): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const method = req.method ?? "GET";
      const versionParam = url.searchParams.get("version");
      const version = versionParam !== null ? Number(versionParam) : undefined;
      if (versionParam !== null && (!Number.isInteger(version) || version! <= 0)) {
        throw new AppError("INVALID_VERSION", "version 必须是正整数");
      }

      if (method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, { ok: true });
      }

      // /trees/:id/...
      if (parts[0] === "trees" && parts.length >= 2) {
        const treeId = decodeURIComponent(parts[1]);
        const sub = parts[2];

        if (method === "PUT" && parts.length === 2) {
          const body = (await readBody(req)) as { rootId?: string; persons?: unknown };
          const saved = service.saveTree(treeId, { rootId: body.rootId as string, persons: body.persons as never });
          return sendJson(res, 201, saved);
        }
        if (method === "GET" && parts.length === 2) {
          return sendJson(res, 200, { treeId, versions: service.store.listVersions(treeId) });
        }
        if (method === "POST" && sub === "validate") {
          return sendJson(res, 200, service.validate(treeId, version));
        }
        if (method === "POST" && sub === "allocate") {
          return sendJson(res, 200, service.compute(treeId, version));
        }
        if (method === "GET" && sub === "share" && parts.length === 4) {
          return sendJson(res, 200, service.personShare(treeId, decodeURIComponent(parts[3]), version));
        }
        if (method === "GET" && sub === "skipped") {
          return sendJson(res, 200, { treeId, skippedBranches: service.skipped(treeId, version) });
        }
        if (method === "POST" && sub === "verify") {
          const body = (await readBody(req)) as { shares?: never };
          return sendJson(res, 200, service.verify(treeId, body.shares as never, version));
        }
        if (method === "GET" && sub === "export") {
          return sendJson(res, 200, service.export(treeId, version));
        }
        if (method === "GET" && sub === "reports") {
          return sendJson(res, 200, { treeId, reports: service.store.listReports(treeId) });
        }
      }

      if (method === "GET" && url.pathname === "/trees") {
        return sendJson(res, 200, { trees: service.store.listTrees() });
      }

      throw new AppError("NOT_FOUND", `未匹配的路由: ${method} ${url.pathname}`);
    } catch (err) {
      if (err instanceof AppError) {
        return sendJson(res, 400, { error: { code: err.code, message: err.message, details: err.details ?? null } });
      }
      const message = err instanceof Error ? err.message : String(err);
      return sendJson(res, 500, { error: { code: "INTERNAL", message } });
    }
  });
}

/** 启动服务。port 为 0 或未提供时由系统分配空闲端口。 */
export function startServer(service: Service, port = 0): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer(service);
    server.on("error", reject);
    server.listen(port, () => {
      const addr = server.address();
      const actual = typeof addr === "object" && addr ? addr.port : port;
      resolve({ server, port: actual });
    });
  });
}
