import { add, equal, frac, parseFraction } from "./fraction";
import { AppError, ValidatedTree } from "./model";
import { AllocationResult } from "./allocate";

export interface ExternalShare {
  personId: string;
  num: string;
  den: string;
}

export interface VerifyIssue {
  code: string;
  personId?: string;
  message: string;
  expected?: { num: string; den: string };
  actual?: { num: string; den: string };
}

export interface VerifyReport {
  ok: boolean;
  issues: VerifyIssue[];
  checkedRecipients: number;
  providedTotal: { num: string; den: string };
}

/**
 * 独立核验外部份额表：
 * 1) 每个受领人必须是在世且属于该树的可受领者；
 * 2) 每条份额必须与按规则重算的精确份额一致（层级分配核验）；
 * 3) 外部表份额总和加未分配份额必须精确等于 1。
 * 仅“加起来等于一”不足以判定正确。
 */
export function verifyShares(
  tree: ValidatedTree,
  expected: AllocationResult,
  external: ExternalShare[]
): VerifyReport {
  if (!Array.isArray(external)) {
    throw new AppError("INVALID_INPUT", "外部份额表必须是数组");
  }
  const issues: VerifyIssue[] = [];
  const expectedMap = new Map(expected.shares.map((s) => [s.personId, s]));
  const seen = new Set<string>();
  let providedTotal = frac(0n);

  for (const entry of external) {
    if (!entry || typeof entry.personId !== "string") {
      throw new AppError("INVALID_INPUT", "每条外部份额必须包含 personId/num/den", { entry });
    }
    const value = parseFraction(String(entry.num), String(entry.den));
    providedTotal = add(providedTotal, value);

    if (seen.has(entry.personId)) {
      issues.push({ code: "DUPLICATE_ENTRY", personId: entry.personId, message: `受领人 ${entry.personId} 重复出现` });
      continue;
    }
    seen.add(entry.personId);

    const person = tree.persons.get(entry.personId);
    if (!person) {
      issues.push({ code: "UNKNOWN_RECIPIENT", personId: entry.personId, message: `受领人 ${entry.personId} 不在树中` });
      continue;
    }
    if (!person.alive) {
      issues.push({
        code: "INELIGIBLE_RECIPIENT",
        personId: entry.personId,
        message: `受领人 ${entry.personId} 已故，不具备受领资格`,
      });
      continue;
    }
    const exp = expectedMap.get(entry.personId);
    if (!exp) {
      issues.push({
        code: "UNEXPECTED_RECIPIENT",
        personId: entry.personId,
        message: `受领人 ${entry.personId} 按规则不应受领（其支系被在世祖先阻断或无合格支系）`,
      });
      continue;
    }
    if (!equal(value, frac(BigInt(exp.num), BigInt(exp.den)))) {
      issues.push({
        code: "SHARE_MISMATCH",
        personId: entry.personId,
        message: `受领人 ${entry.personId} 的份额与按支系代位规则重算结果不符`,
        expected: { num: exp.num, den: exp.den },
        actual: { num: value.n.toString(), den: value.d.toString() },
      });
    }
  }

  for (const exp of expected.shares) {
    if (!seen.has(exp.personId)) {
      issues.push({
        code: "MISSING_RECIPIENT",
        personId: exp.personId,
        message: `外部份额表缺少应受领人 ${exp.personId}（应得 ${exp.num}/${exp.den}）`,
        expected: { num: exp.num, den: exp.den },
      });
    }
  }

  const grand = add(providedTotal, frac(BigInt(expected.unallocatedNum), BigInt(expected.unallocatedDen)));
  if (grand.n !== 1n || grand.d !== 1n) {
    issues.push({
      code: "TOTAL_MISMATCH",
      message: `外部份额总和加未分配份额应精确等于 1，实际为 ${grand.n}/${grand.d}`,
      actual: { num: grand.n.toString(), den: grand.d.toString() },
    });
  }

  return {
    ok: issues.length === 0,
    issues,
    checkedRecipients: seen.size,
    providedTotal: { num: providedTotal.n.toString(), den: providedTotal.d.toString() },
  };
}
