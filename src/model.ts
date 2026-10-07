export interface PersonInput {
  id: string;
  name?: string;
  parentId: string | null;
  alive: boolean;
}

export interface TreeInput {
  rootId: string;
  persons: PersonInput[];
}

export interface Person extends PersonInput {
  id: string;
  name: string;
}

export interface ValidatedTree {
  rootId: string;
  persons: Map<string, Person>;
  children: Map<string, string[]>;
}

export interface Limits {
  maxNodes: number;
  maxDepth: number;
}

export const DEFAULT_LIMITS: Limits = { maxNodes: 10000, maxDepth: 200 };

/** 业务错误：携带稳定错误码与诊断明细。 */
export class AppError extends Error {
  code: string;
  details: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
