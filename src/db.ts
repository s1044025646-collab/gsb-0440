import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { AllocationResult, RULE_VERSION, TreeInput } from "./types";

export interface TreeRecord {
  id: number;
  name: string | null;
  created_at: string;
}

export interface VersionRecord {
  id: number;
  tree_id: number;
  version: number;
  root_id: string;
  payload: TreeInput;
  rule_version: string;
  created_at: string;
}

export interface ReportRecord {
  id: number;
  version_id: number;
  result: AllocationResult;
  rule_version: string;
  created_at: string;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tree_id INTEGER NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        root_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        rule_version TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(tree_id, version)
      );
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version_id INTEGER NOT NULL UNIQUE REFERENCES versions(id) ON DELETE CASCADE,
        result TEXT NOT NULL,
        rule_version TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  /** 保存一个全新家族树（含初始版本）。非法时由调用方在校验后决定是否调用。 */
  saveNewTree(payload: TreeInput, name: string | null): { treeId: number; versionId: number; version: number } {
    this.db.exec("BEGIN");
    try {
      const treeInfo = this.db.prepare("INSERT INTO trees (name) VALUES (?)").run(name);
      const treeId = Number(treeInfo.lastInsertRowid);
      const versionInfo = this.db
        .prepare("INSERT INTO versions (tree_id, version, root_id, payload, rule_version) VALUES (?, 1, ?, ?, ?)")
        .run(treeId, payload.rootId, JSON.stringify(payload), RULE_VERSION);
      this.db.exec("COMMIT");
      return { treeId, versionId: Number(versionInfo.lastInsertRowid), version: 1 };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** 人员状态改变 => 新建版本；原版本与其报告保持不变。 */
  saveNewVersion(treeId: number, payload: TreeInput): { versionId: number; version: number } {
    this.db.exec("BEGIN");
    try {
      const row = this.db
        .prepare("SELECT COALESCE(MAX(version), 0) AS v FROM versions WHERE tree_id = ?")
        .get(treeId) as { v: number } | undefined;
      if (!row) {
        throw new Error("家族树不存在");
      }
      const next = row.v + 1;
      const info = this.db
        .prepare("INSERT INTO versions (tree_id, version, root_id, payload, rule_version) VALUES (?, ?, ?, ?, ?)")
        .run(treeId, next, payload.rootId, JSON.stringify(payload), RULE_VERSION);
      this.db.exec("COMMIT");
      return { versionId: Number(info.lastInsertRowid), version: next };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  saveReport(versionId: number, result: AllocationResult): void {
    this.db
      .prepare(
        "INSERT INTO reports (version_id, result, rule_version) VALUES (?, ?, ?) ON CONFLICT(version_id) DO UPDATE SET result = excluded.result, rule_version = excluded.rule_version",
      )
      .run(versionId, JSON.stringify(result), RULE_VERSION);
  }

  getTree(treeId: number): TreeRecord | undefined {
    return this.db.prepare("SELECT * FROM trees WHERE id = ?").get(treeId) as TreeRecord | undefined;
  }

  listVersions(treeId: number): VersionRecord[] {
    return this.db
      .prepare("SELECT * FROM versions WHERE tree_id = ? ORDER BY version")
      .all(treeId)
      .map((r) => this.hydrateVersion(r as Record<string, unknown>));
  }

  getVersion(treeId: number, version?: number): VersionRecord | undefined {
    const row = version
      ? (this.db.prepare("SELECT * FROM versions WHERE tree_id = ? AND version = ?").get(treeId, version) as
          | Record<string, unknown>
          | undefined)
      : (this.db
          .prepare("SELECT * FROM versions WHERE tree_id = ? ORDER BY version DESC LIMIT 1")
          .get(treeId) as Record<string, unknown> | undefined);
    return row ? this.hydrateVersion(row) : undefined;
  }

  private hydrateVersion(row: Record<string, unknown>): VersionRecord {
    return {
      id: Number(row.id),
      tree_id: Number(row.tree_id),
      version: Number(row.version),
      root_id: String(row.root_id),
      payload: JSON.parse(String(row.payload)) as TreeInput,
      rule_version: String(row.rule_version),
      created_at: String(row.created_at),
    };
  }

  getReport(versionId: number): ReportRecord | undefined {
    const row = this.db.prepare("SELECT * FROM reports WHERE version_id = ?").get(versionId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return {
      id: Number(row.id),
      version_id: Number(row.version_id),
      result: JSON.parse(String(row.result)) as AllocationResult,
      rule_version: String(row.rule_version),
      created_at: String(row.created_at),
    };
  }

  close(): void {
    this.db.close();
  }
}
