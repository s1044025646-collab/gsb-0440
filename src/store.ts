import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { AppError, TreeInput } from "./model";
import { AllocationResult } from "./allocate";

export interface TreeVersionRow {
  treeId: string;
  version: number;
  ruleVersion: string;
  createdAt: string;
  input: TreeInput;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tree_versions (
        tree_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        rule_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        input_json TEXT NOT NULL,
        PRIMARY KEY (tree_id, version)
      );
      CREATE TABLE IF NOT EXISTS reports (
        report_id TEXT NOT NULL PRIMARY KEY,
        tree_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        rule_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        result_json TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  /** 保存新版本。若与最新版本内容完全一致则复用该版本号。 */
  saveVersion(treeId: string, input: TreeInput, ruleVersion: string): TreeVersionRow {
    const latest = this.latestVersion(treeId);
    const inputJson = JSON.stringify(input);
    if (latest !== null) {
      const row = this.getVersion(treeId, latest);
      if (JSON.stringify(row.input) === inputJson && row.ruleVersion === ruleVersion) {
        return row;
      }
    }
    const version = (latest ?? 0) + 1;
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO tree_versions (tree_id, version, rule_version, created_at, input_json) VALUES (?, ?, ?, ?, ?)"
      )
      .run(treeId, version, ruleVersion, createdAt, inputJson);
    return { treeId, version, ruleVersion, createdAt, input };
  }

  latestVersion(treeId: string): number | null {
    const row = this.db
      .prepare("SELECT MAX(version) AS v FROM tree_versions WHERE tree_id = ?")
      .get(treeId) as { v: number | null };
    return row.v;
  }

  getVersion(treeId: string, version?: number): TreeVersionRow {
    const v = version ?? this.latestVersion(treeId);
    if (v === null) {
      throw new AppError("TREE_NOT_FOUND", `家族树 ${treeId} 不存在`, { treeId });
    }
    const row = this.db
      .prepare("SELECT * FROM tree_versions WHERE tree_id = ? AND version = ?")
      .get(treeId, v) as
      | { tree_id: string; version: number; rule_version: string; created_at: string; input_json: string }
      | undefined;
    if (!row) {
      throw new AppError("VERSION_NOT_FOUND", `家族树 ${treeId} 的版本 ${v} 不存在`, { treeId, version: v });
    }
    return {
      treeId: row.tree_id,
      version: row.version,
      ruleVersion: row.rule_version,
      createdAt: row.created_at,
      input: JSON.parse(row.input_json) as TreeInput,
    };
  }

  listVersions(treeId: string): Array<{ version: number; ruleVersion: string; createdAt: string }> {
    const rows = this.db
      .prepare("SELECT version, rule_version, created_at FROM tree_versions WHERE tree_id = ? ORDER BY version")
      .all(treeId) as Array<{ version: number; rule_version: string; created_at: string }>;
    return rows.map((r) => ({ version: r.version, ruleVersion: r.rule_version, createdAt: r.created_at }));
  }

  listTrees(): string[] {
    const rows = this.db.prepare("SELECT DISTINCT tree_id FROM tree_versions ORDER BY tree_id").all() as Array<{
      tree_id: string;
    }>;
    return rows.map((r) => r.tree_id);
  }

  saveReport(treeId: string, version: number, ruleVersion: string, result: AllocationResult): string {
    const reportId = `${treeId}-v${version}-${Date.now()}`;
    this.db
      .prepare(
        "INSERT INTO reports (report_id, tree_id, version, rule_version, created_at, result_json) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(reportId, treeId, version, ruleVersion, new Date().toISOString(), JSON.stringify(result));
    return reportId;
  }

  getReport(reportId: string): { treeId: string; version: number; ruleVersion: string; result: AllocationResult } {
    const row = this.db.prepare("SELECT * FROM reports WHERE report_id = ?").get(reportId) as
      | { tree_id: string; version: number; rule_version: string; result_json: string }
      | undefined;
    if (!row) {
      throw new AppError("REPORT_NOT_FOUND", `报告 ${reportId} 不存在`, { reportId });
    }
    return {
      treeId: row.tree_id,
      version: row.version,
      ruleVersion: row.rule_version,
      result: JSON.parse(row.result_json) as AllocationResult,
    };
  }

  listReports(treeId: string): Array<{ reportId: string; version: number; createdAt: string }> {
    const rows = this.db
      .prepare("SELECT report_id, version, created_at FROM reports WHERE tree_id = ? ORDER BY created_at")
      .all(treeId) as Array<{ report_id: string; version: number; created_at: string }>;
    return rows.map((r) => ({ reportId: r.report_id, version: r.version, createdAt: r.created_at }));
  }
}
