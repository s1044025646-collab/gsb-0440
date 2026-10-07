import { Store, VersionRecord } from "./db";
import { validateTreeInput, ValidTree } from "./tree";
import { allocate, internalConsistencyChecks } from "./allocation";
import { verifyExternalTable } from "./verification";
import { AllocationResult, ExternalShareTable, RULE_VERSION, TreeInput, ValidationIssue, VerificationResult } from "./types";

export class ServiceError extends Error {
  constructor(
    public code: string,
    message: string,
    public issues: ValidationIssue[] = [],
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export interface ComputeOutcome {
  treeId: number;
  version: number;
  versionId: number;
  ruleVersion: string;
  result: AllocationResult;
  cached: boolean;
}

export class AllocationService {
  constructor(private store: Store) {}

  createTree(payload: TreeInput, name: string | null = null): { treeId: number; version: number; versionId: number } {
    const checked = validateTreeInput(payload);
    if (!checked.valid) {
      throw new ServiceError("VALIDATION_FAILED", "家族树校验未通过", checked.issues);
    }
    return this.store.saveNewTree(payload, name);
  }

  addVersion(treeId: number, payload: TreeInput): { version: number; versionId: number } {
    if (!this.store.getTree(treeId)) {
      throw new ServiceError("NOT_FOUND", `家族树 ${treeId} 不存在`);
    }
    const checked = validateTreeInput(payload);
    if (!checked.valid) {
      throw new ServiceError("VALIDATION_FAILED", "家族树校验未通过", checked.issues);
    }
    return this.store.saveNewVersion(treeId, payload);
  }

  private loadValidTree(version: VersionRecord): ValidTree {
    const checked = validateTreeInput(version.payload);
    if (!checked.valid) {
      throw new ServiceError("VALIDATION_FAILED", "已保存版本无法重新校验", checked.issues);
    }
    return checked.tree;
  }

  /** 计算（或取回缓存报告）。旧版本始终按其保存时的原状态重新演算/解释。 */
  compute(treeId: number, version?: number): ComputeOutcome {
    const versionRecord = this.store.getVersion(treeId, version);
    if (!versionRecord) {
      throw new ServiceError("NOT_FOUND", version ? `版本 ${version} 不存在` : `家族树 ${treeId} 不存在`);
    }
    const cached = this.store.getReport(versionRecord.id);
    if (cached && cached.rule_version === RULE_VERSION) {
      return {
        treeId,
        version: versionRecord.version,
        versionId: versionRecord.id,
        ruleVersion: cached.rule_version,
        result: cached.result,
        cached: true,
      };
    }
    const tree = this.loadValidTree(versionRecord);
    const result = allocate(tree);
    const errors = internalConsistencyChecks(tree, result);
    if (errors.length > 0) {
      throw new ServiceError("INTERNAL_CONSISTENCY", errors.join("; "));
    }
    this.store.saveReport(versionRecord.id, result);
    return {
      treeId,
      version: versionRecord.version,
      versionId: versionRecord.id,
      ruleVersion: RULE_VERSION,
      result,
      cached: false,
    };
  }

  getPersonSource(treeId: number, personId: string, version?: number) {
    const outcome = this.compute(treeId, version);
    const recipient = outcome.result.recipients.find((r) => r.personId === personId);
    if (!recipient) {
      return { recipient: null, skipped: this.describePersonSkipped(outcome.result, personId) };
    }
    return { recipient, skipped: null };
  }

  private describePersonSkipped(result: AllocationResult, personId: string): string | null {
    const skip = result.skippedBranches.find((s) => s.childId === personId);
    return skip ? skip.detail : "该人员不是受领人（已故且其所在支系无在世后代，或被在世长辈阻断）";
  }

  verify(treeId: number, table: ExternalShareTable, version?: number): VerificationResult {
    const versionRecord = this.store.getVersion(treeId, version);
    if (!versionRecord) {
      throw new ServiceError("NOT_FOUND", "版本不存在");
    }
    const tree = this.loadValidTree(versionRecord);
    const outcome = this.compute(treeId, version);
    return verifyExternalTable(tree, outcome.result, table);
  }

  getVersionPayload(treeId: number, version?: number): VersionRecord {
    const v = this.store.getVersion(treeId, version);
    if (!v) throw new ServiceError("NOT_FOUND", "版本不存在");
    return v;
  }

  listVersions(treeId: number): VersionRecord[] {
    if (!this.store.getTree(treeId)) {
      throw new ServiceError("NOT_FOUND", `家族树 ${treeId} 不存在`);
    }
    return this.store.listVersions(treeId);
  }
}
