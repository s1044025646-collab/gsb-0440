import path from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { Store } from "./db";
import { AllocationService } from "./service";
import { TreeInput, RecipientShare } from "./types";
import { validateTreeInput } from "./tree";
import { allocate } from "./allocation";
import { verifyExternalTable } from "./verification";
import { runDemo } from "./demo";

const DATA_DIR = process.env.FAMILY_TREE_DATA_DIR ?? path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "family-tree.db");

function makeStore(): Store {
  return new Store(DB_PATH);
}

function readJson(file: string): unknown {
  if (!existsSync(file)) fail(`文件不存在: ${file}`);
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    fail(`无法解析 JSON: ${(e as Error).message}`);
  }
}

function fail(msg: string): never {
  console.error(`错误: ${msg}`);
  process.exit(1);
}

function printTree(input: TreeInput): void {
  const checked = validateTreeInput(input);
  if (!checked.valid) {
    console.log("（树非法，无法绘制）");
    return;
  }
  const tree = checked.tree;
  const label = (id: string): string => {
    const n = tree.nodes.get(id);
    const tag = n?.status === "alive" ? "在世" : "已故";
    return `${id}${n?.name ? `（${n.name}）` : ""} [${tag}]`;
  };
  const walk = (id: string, prefix: string, last: boolean, depth: number): void => {
    const branch = depth === 0 ? "" : last ? "└─ " : "├─ ";
    console.log(`${prefix}${branch}${label(id)}`);
    const kids = tree.childrenOf.get(id) ?? [];
    kids.forEach((k, i) => {
      const nextPrefix = prefix + (depth === 0 ? "" : last ? "   " : "│  ");
      walk(k.id, nextPrefix, i === kids.length - 1, depth + 1);
    });
  };
  console.log("树状关系：");
  walk(tree.rootId, "", true, 0);
}

function printRecipients(shares: RecipientShare[]): void {
  console.log("\n受领表（精确份额）：");
  if (shares.length === 0) {
    console.log("  （无人可受领）");
    return;
  }
  for (const r of shares) {
    console.log(`  ${r.personId}${r.name ? `（${r.name}）` : ""}: ${r.share.numerator}/${r.share.denominator} ≈ ${r.share.decimal}`);
  }
}

function printPaths(shares: RecipientShare[]): void {
  console.log("\n来源路径（各层合格支系数与因子）：");
  if (shares.length === 0) {
    console.log("  （无）");
    return;
  }
  for (const r of shares) {
    const chain = r.path
      .map((s) => `${s.atNodeId} → ${s.childId} [合格支系 ${s.qualifyingBranchCount}，× ${s.factor.numerator}/${s.factor.denominator}]`)
      .join("； ");
    console.log(`  ${r.personId}: ${chain}  =>  ${r.share.numerator}/${r.share.denominator}`);
  }
}

function cmdAllocate(args: string[]): void {
  const treeId = Number(args[0]);
  const version = args[1] ? Number(args[1]) : undefined;
  if (Number.isNaN(treeId)) fail("用法: allocate <treeId> [version]");
  const svc = new AllocationService(makeStore());
  const outcome = svc.compute(treeId, version);
  const v = svc.getVersionPayload(treeId, version);
  console.log(`家族树 #${treeId} 版本 v${outcome.version}（规则 ${outcome.ruleVersion}，${outcome.cached ? "读取已存报告" : "重新演算"}）`);
  printTree(v.payload);
  printRecipients(outcome.result.recipients);
  console.log(`\n未分配份额: ${outcome.result.unallocated.numerator}/${outcome.result.unallocated.denominator}`);
  if (outcome.result.skippedBranches.length > 0) {
    console.log("\n被跳过支系：");
    for (const s of outcome.result.skippedBranches) console.log(`  - ${s.detail}`);
  }
  printPaths(outcome.result.recipients);
  console.log(`\n精确合计自检: 受领 + 未分配 = 1 -> ${outcome.result.totalsToOne ? "通过" : "失败"}`);
}

function main(): void {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "demo":
      runDemo(DB_PATH);
      break;
    case "validate": {
      if (!args[0]) fail("用法: validate <tree.json>");
      const input = readJson(args[0]) as TreeInput;
      const checked = validateTreeInput(input);
      if (checked.valid) {
        console.log(`校验通过：根 ${checked.tree.rootId}，节点 ${checked.tree.nodes.size}，深度 ${checked.tree.depth}`);
      } else {
        console.log("校验失败：");
        for (const i of checked.issues) console.log(`  [${i.code}] ${i.message}${i.personId ? `（节点 ${i.personId}）` : ""}`);
        process.exit(2);
      }
      break;
    }
    case "calc": {
      if (!args[0]) fail("用法: calc <tree.json>");
      const input = readJson(args[0]) as TreeInput;
      const checked = validateTreeInput(input);
      if (!checked.valid) {
        for (const i of checked.issues) console.log(`  [${i.code}] ${i.message}`);
        process.exit(2);
      }
      const result = allocate(checked.tree);
      printTree(input);
      printRecipients(result.recipients);
      console.log(`\n未分配份额: ${result.unallocated.numerator}/${result.unallocated.denominator}`);
      printPaths(result.recipients);
      break;
    }
    case "save": {
      if (!args[0]) fail("用法: save <tree.json> [名称]");
      const input = readJson(args[0]) as TreeInput;
      const svc = new AllocationService(makeStore());
      const out = svc.createTree(input, args[1] ?? null);
      console.log(`已保存：treeId=${out.treeId} 版本 v${out.version}`);
      break;
    }
    case "version": {
      if (!args[0] || !args[1]) fail("用法: version <treeId> <tree.json>");
      const input = readJson(args[1]) as TreeInput;
      const svc = new AllocationService(makeStore());
      const out = svc.addVersion(Number(args[0]), input);
      console.log(`已新建版本：treeId=${args[0]} v${out.version}`);
      break;
    }
    case "allocate":
      cmdAllocate(args);
      break;
    case "verify": {
      if (!args[0] || !args[1]) fail("用法: verify <tree.json> <external-table.json>");
      const input = readJson(args[0]) as TreeInput;
      const table = readJson(args[1]);
      const checked = validateTreeInput(input);
      if (!checked.valid) fail("树非法，无法核验");
      const result = allocate(checked.tree);
      const vr = verifyExternalTable(checked.tree, result, table as never);
      console.log(vr.valid ? "核验通过：外部份额表正确。" : "核验未通过，存在以下不符：");
      for (const m of vr.mismatches) console.log(`  [${m.code}] ${m.message}`);
      console.log(`声明总额: ${vr.declaredTotal.numerator}/${vr.declaredTotal.denominator}`);
      if (!vr.valid) process.exit(3);
      break;
    }
    case "export": {
      if (!args[0]) fail("用法: export <treeId> [version]");
      const ver = args[1] ? Number(args[1]) : undefined;
      const svc = new AllocationService(makeStore());
      const v = svc.getVersionPayload(Number(args[0]), ver);
      const outcome = svc.compute(Number(args[0]), ver);
      console.log(JSON.stringify({ version: v.version, ruleVersion: v.rule_version, tree: v.payload, allocation: outcome.result }, null, 2));
      break;
    }
    default:
      console.log(
        [
          "家族树按支系代位分摊 CLI",
          "命令：",
          "  demo                         运行内置演示（保存版本、改变状态、独立核验）",
          "  validate <tree.json>         仅校验树结构",
          "  calc <tree.json>             不落库计算并打印树、受领表与来源路径",
          "  save <tree.json> [名称]       保存新家族树，返回 treeId",
          "  version <treeId> <tree.json>  状态改变后新建版本",
          "  allocate <treeId> [version]  计算（优先读已存报告）并展示",
          "  verify <tree.json> <table>   独立核验外部份额表",
          "  export <treeId> [version]    导出原树与分配报告 JSON",
        ].join("\n"),
      );
  }
}

main();
