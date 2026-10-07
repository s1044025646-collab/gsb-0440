import {
  AllocationResult,
  ExternalShareTable,
  VerificationMismatch,
  VerificationResult,
} from "./types";
import { ValidTree } from "./tree";
import { BigFraction, add, equal, frac, parseFraction, toStrings } from "./fraction";
import { fromFraction, toFraction } from "./allocation";

/**
 * 独立核验外部份额表。不仅检查总和为 1，还检查：
 * 1. 每个受领人资格（必须是树内在世节点，且确为演算受领人）；
 * 2. 每人份额是否与逐层按支系演算一致；
 * 3. 是否遗漏受领人、重复列示；
 * 4. 外部表声明总额与未分配部分。
 */
export function verifyExternalTable(
  tree: ValidTree,
  expected: AllocationResult,
  table: ExternalShareTable,
): VerificationResult {
  const mismatches: VerificationMismatch[] = [];

  if (!table || typeof table !== "object" || !Array.isArray(table.entries)) {
    mismatches.push({ code: "TOTAL_NOT_ONE", message: "外部份额表格式无效：entries 必须为数组" });
    return { valid: false, declaredTotal: toStrings(frac(0)), mismatches };
  }

  const expectedById = new Map(expected.recipients.map((r) => [r.personId, r]));
  const seen = new Set<string>();
  let declaredTotal: BigFraction = frac(0);

  for (const entry of table.entries) {
    if (!entry || typeof entry.personId !== "string") {
      mismatches.push({ code: "UNKNOWN_PERSON", message: "存在缺少 personId 的条目" });
      continue;
    }
    const id = entry.personId;
    if (seen.has(id)) {
      mismatches.push({ code: "DUPLICATE_ENTRY", message: `受领人 ${id} 被重复列示`, personId: id });
      continue;
    }
    seen.add(id);

    const node = tree.nodes.get(id);
    if (!node) {
      mismatches.push({ code: "UNKNOWN_PERSON", message: `人员 ${id} 不存在于该树`, personId: id });
      continue;
    }
    if (node.status === "deceased") {
      mismatches.push({ code: "DECEASED_LISTED", message: `已故节点 ${id} 不能直接受领`, personId: id });
    }

    let actual: BigFraction;
    try {
      actual = parseFraction(String(entry.numerator), String(entry.denominator));
    } catch (e) {
      mismatches.push({
        code: "SHARE_MISMATCH",
        message: `人员 ${id} 的份额无法解析为精确分数：${(e as Error).message}`,
        personId: id,
      });
      continue;
    }
    declaredTotal = add(declaredTotal, actual);

    const want = expectedById.get(id);
    if (!want) {
      mismatches.push({
        code: "NOT_A_RECIPIENT",
        message: `人员 ${id} 不是合格受领人（其所在支系不应受领或其被在世长辈阻断）`,
        personId: id,
        actual: toFraction(actual),
      });
      continue;
    }
    if (!equal(actual, fromFraction(want.share))) {
      mismatches.push({
        code: "SHARE_MISMATCH",
        message: `人员 ${id} 份额应为 ${want.share.numerator}/${want.share.denominator}，外部表声明 ${actual.n}/${actual.d}`,
        personId: id,
        expected: want.share,
        actual: toFraction(actual),
      });
    }
  }

  for (const r of expected.recipients) {
    if (!seen.has(r.personId)) {
      mismatches.push({
        code: "RECIPIENT_MISSING",
        message: `合格受领人 ${r.personId} 在外部表中缺失，应得 ${r.share.numerator}/${r.share.denominator}`,
        personId: r.personId,
        expected: r.share,
      });
    }
  }

  if (!equal(declaredTotal, frac(1))) {
    mismatches.push({
      code: "TOTAL_NOT_ONE",
      message: `外部表声明总额为 ${declaredTotal.n}/${declaredTotal.d}，不等于 1`,
      actual: toFraction(declaredTotal),
    });
  }

  // 无人受领时：正确的外部表应为空且未分配为 1。
  if (expected.noRecipient && table.entries.length > 0) {
 mismatches.push({ code: "TOTAL_NOT_ONE", message: "该树无人可受领，外部表不应列示任何受领人" });
  }

  return {
    valid: mismatches.length === 0,
    declaredTotal: toFraction(declaredTotal),
    mismatches,
  };
}
