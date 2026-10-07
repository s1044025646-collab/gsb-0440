/**
 * 核心数据类型定义。
 * 本项目只处理虚构树形分摊，不采集真实身份信息。
 */

/** 人员在世状态；未知状态不得当作已故处理。 */
export type VitalStatus = "alive" | "deceased";

/** 输入的人员节点。id 必须在一棵树内唯一。 */
export interface InputPerson {
  id: string;
  /** 父节点 id；根节点为 null。 */
  parentId: string | null;
  status: VitalStatus;
  /** 可选展示名，仅用于显示，不参与计算。 */
  name?: string;
}

/** 用于创建家族树版本的输入载荷。 */
export interface TreeInput {
  /** 分配起点（份额来源本人，不参与受领）。 */
  rootId: string;
  persons: InputPerson[];
}

/** 约分后的精确有理数。 */
export interface Fraction {
  numerator: string;
  denominator: string;
  /** 仅供展示的有限位小数，不参与任何计算。 */
  decimal: string;
}

/** 来源路径上的一层：在某已故节点下该支系被选中时记录。 */
export interface PathStep {
  /** 在该层需要继续分配的已故节点 id。 */
  atNodeId: string;
  /** 被选中的直接子支系根节点 id。 */
  childId: string;
  /** 该节点下合格（含有在世后代或子节点本身在世）的支系数量。 */
  qualifyingBranchCount: number;
  /** 本层因子 1/qualifyingBranchCount。 */
  factor: Fraction;
}

/** 单个在世受领人的分配结果与来源解释。 */
export interface RecipientShare {
  personId: string;
  name?: string;
  share: Fraction;
  /** 从分配起点到受领人的支系路径及各层因子。 */
  path: PathStep[];
}

/** 被跳过支系的解释。 */
export interface SkippedBranch {
  /** 发生跳过的已故父节点。 */
  atNodeId: string;
  /** 该直接子支系根节点；若为根层则根自身的说明另行处理。 */
  childId: string;
  reason: "no_living_descendant";
  detail: string;
}

/** 一次完整分配演算的结果。 */
export interface AllocationResult {
  rootId: string;
  recipients: RecipientShare[];
  unallocated: Fraction;
  skippedBranches: SkippedBranch[];
  /** 是否没有任何可受领后代。 */
  noRecipient: boolean;
  /** 受领份额 + 未分配是否精确等于 1（恒为 true，作为显式自检字段）。 */
  totalsToOne: boolean;
}

/** 校验诊断条目。 */
export interface ValidationIssue {
  code: ErrorCode;
  message: string;
  /** 关联的人员 id（如适用）。 */
  personId?: string;
}

export type ErrorCode =
  | "EMPTY_TREE"
  | "MISSING_ROOT"
  | "ROOT_NOT_UNIQUE_PARENT"
  | "DUPLICATE_ID"
  | "UNKNOWN_PARENT"
  | "MULTIPLE_PARENTS_STRUCTURE"
  | "PERSON_MULTIPLE_PARENTS"
  | "ORPHAN_NODE"
  | "CYCLE_DETECTED"
  | "INVALID_STATUS"
  | "MISSING_FIELD"
  | "TREE_TOO_LARGE"
  | "TREE_TOO_DEEP"
  | "NOT_FOUND"
  | "VERSION_MISMATCH"
  | "INVALID_PAYLOAD"
  | "INVALID_EXTERNAL_TABLE";

/** 外部提交的受领人份额表条目（用于独立核验）。 */
export interface ExternalShareEntry {
  personId: string;
  numerator: string;
  denominator: string;
}

export interface ExternalShareTable {
  rootId?: string;
  entries: ExternalShareEntry[];
}

/** 单条核验不符。 */
export interface VerificationMismatch {
  code:
    | "NOT_A_RECIPIENT"
    | "RECIPIENT_MISSING"
    | "SHARE_MISMATCH"
    | "TOTAL_NOT_ONE"
    | "UNALLOCATED_MISMATCH"
    | "DUPLICATE_ENTRY"
    | "UNKNOWN_PERSON"
    | "DECEASED_LISTED";
  message: string;
  personId?: string;
  expected?: Fraction;
  actual?: Fraction;
}

export interface VerificationResult {
  valid: boolean;
  /** 外部表声明总额。 */
  declaredTotal: Fraction;
  mismatches: VerificationMismatch[];
}

/** 规则版本，用于解释结果时固定规则语义。 */
export const RULE_VERSION = "branch-per-stirpes-1.0";

/** 安全上限，防止超大输入导致栈溢出或资源耗尽。 */
export const LIMITS = {
  maxNodes: 10000,
  maxDepth: 1000,
} as const;
