#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { AppError, DEFAULT_LIMITS, Limits, TreeInput } from "./model";
import { Store } from "./store";
import { Service } from "./service";
import { startServer } from "./server";
import { buildTree } from "./tree";
import { renderResult, renderTree } from "./render";
import { demoTreeV1, demoTreeV2 } from "./demo";
import { allocate } from "./allocate";

const DATA_DIR = process.env.FST_DATA_DIR ?? path.join(process.cwd(), "data");
const DB_PATH = process.env.FST_DB ?? path.join(DATA_DIR, "familytree.db");

function makeService(): Service {
  const limits: Limits = {
    maxNodes: Number(process.env.FST_MAX_NODES ?? DEFAULT_LIMITS.maxNodes),
    maxDepth: Number(process.env.FST_MAX_DEPTH ?? DEFAULT_LIMITS.maxDepth),
  };
  return new Service(new Store(DB_PATH), limits);
}

function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) {
    throw new AppError("INVALID_JSON", `无法读取或解析文件 ${file}: ${(e as Error).message}`);
  }
}

function print(s: string): void {
  process.stdout.write(s + "\n");
}

const USAGE = `家族树按支系代位分摊 CLI（虚构演算，非法律意见）
用法:
  node dist/cli.js serve [--port N]              启动 API 服务（默认端口 0 = 自动选空闲端口）
  node dist/cli.js demo                          运行内置演示（A/B/C 示例 + A 改已故的新版本）
  node dist/cli.js save <treeId> <file.json>     校验并保存家族树（生成新版本）
  node dist/cli.js validate <treeId> [--version N]
  node dist/cli.js allocate <treeId> [--version N]   计算分配并保存报告
  node dist/cli.js share <treeId> <personId> [--version N]   查询个人来源路径
  node dist/cli.js skipped <treeId> [--version N]    说明被跳过的支系
  node dist/cli.js verify <treeId> <shares.json> [--version N]  核验外部份额表
  node dist/cli.js export <treeId> [--version N]     导出树与结果 JSON
  node dist/cli.js list                          列出已保存的家族树
环境变量: FST_DATA_DIR, FST_DB, FST_MAX_NODES, FST_MAX_DEPTH, PORT
`;

function versionFlag(args: string[]): number | undefined {
  const i = args.indexOf("--version");
  if (i === -1) return undefined;
  const v = Number(args[i + 1]);
  if (!Number.isInteger(v) || v <= 0) throw new AppError("INVALID_VERSION", "--version 必须是正整数");
  return v;
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help") {
    print(USAGE);
    return;
  }

  if (cmd === "serve") {
    const pi = args.indexOf("--port");
    const port = pi !== -1 ? Number(args[pi + 1]) : Number(process.env.PORT ?? 0);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new AppError("INVALID_PORT", "端口必须是 0-65535 的整数（0 表示自动选空闲端口）");
    }
    const service = makeService();
    const { port: actual } = await startServer(service, port);
    print(`API 服务已启动: http://127.0.0.1:${actual}  (数据库: ${DB_PATH})`);
    return;
  }

  if (cmd === "demo") {
    const service = makeService();
    print("=== 演示 v1：A 在世；B 已故(B1,B2 在世)；C 已故无在世后代 ===");
    const v1 = service.saveTree("demo", demoTreeV1());
    const row1 = service.store.getVersion("demo", v1.version);
    const tree1 = buildTree(row1.input);
    print(renderTree(tree1));
    const r1 = service.compute("demo", v1.version);
    print(renderResult(r1.result));
    print("");
    print("=== 演示 v2：A 改为已故，A1/A2 在 A 支系内部代位；B 支系份额不变 ===");
    const v2 = service.saveTree("demo", demoTreeV2());
    const row2 = service.store.getVersion("demo", v2.version);
    const tree2 = buildTree(row2.input);
    print(renderTree(tree2));
    const r2 = service.compute("demo", v2.version);
    print(renderResult(r2.result));
    print("");
    print(`版本: v1=${v1.version}, v2=${v2.version}；报告: ${r1.reportId}, ${r2.reportId}`);
    service.store.close();
    return;
  }

  const service = makeService();
  try {
    switch (cmd) {
      case "save": {
        const [treeId, file] = args;
        if (!treeId || !file) throw new AppError("USAGE", "save 需要 <treeId> <file.json>");
        const saved = service.saveTree(treeId, readJsonFile(file) as TreeInput);
        print(JSON.stringify(saved, null, 2));
        break;
      }
      case "validate": {
        const [treeId] = args;
        if (!treeId) throw new AppError("USAGE", "validate 需要 <treeId>");
        print(JSON.stringify(service.validate(treeId, versionFlag(args)), null, 2));
        break;
      }
      case "allocate": {
        const [treeId] = args;
        if (!treeId) throw new AppError("USAGE", "allocate 需要 <treeId>");
        const row = service.store.getVersion(treeId, versionFlag(args));
        const tree = buildTree(row.input, service.limits);
        print(renderTree(tree));
        const { reportId, result } = service.compute(treeId, row.version);
        print(renderResult(result));
        print(`报告已保存: ${reportId}`);
        break;
      }
      case "share": {
        const [treeId, personId] = args;
        if (!treeId || !personId) throw new AppError("USAGE", "share 需要 <treeId> <personId>");
        print(JSON.stringify(service.personShare(treeId, personId, versionFlag(args)), null, 2));
        break;
      }
      case "skipped": {
        const [treeId] = args;
        if (!treeId) throw new AppError("USAGE", "skipped 需要 <treeId>");
        print(JSON.stringify({ skippedBranches: service.skipped(treeId, versionFlag(args)) }, null, 2));
        break;
      }
      case "verify": {
        const [treeId, file] = args;
        if (!treeId || !file) throw new AppError("USAGE", "verify 需要 <treeId> <shares.json>");
        const body = readJsonFile(file) as { shares?: never } | never[];
        const shares = Array.isArray(body) ? body : (body as { shares: never }).shares;
        print(JSON.stringify(service.verify(treeId, shares as never, versionFlag(args)), null, 2));
        break;
      }
      case "export": {
        const [treeId] = args;
        if (!treeId) throw new AppError("USAGE", "export 需要 <treeId>");
        print(JSON.stringify(service.export(treeId, versionFlag(args)), null, 2));
        break;
      }
      case "list": {
        print(JSON.stringify({ trees: service.store.listTrees() }, null, 2));
        break;
      }
      case "compute-file": {
        // 一次性计算：不写入数据库。
        const [file] = args;
        if (!file) throw new AppError("USAGE", "compute-file 需要 <file.json>");
        const tree = buildTree(readJsonFile(file) as TreeInput, service.limits);
        print(renderTree(tree));
        print(renderResult(allocate(tree, service.limits)));
        break;
      }
      default:
        throw new AppError("USAGE", `未知命令: ${cmd}\n${USAGE}`);
    }
  } finally {
    if (cmd !== "serve") service.store.close();
  }
}

main().catch((err) => {
  if (err instanceof AppError) {
    process.stderr.write(JSON.stringify({ error: { code: err.code, message: err.message, details: err.details ?? null } }) + "\n");
  } else {
    process.stderr.write(String(err instanceof Error ? err.stack : err) + "\n");
  }
  process.exit(1);
});
