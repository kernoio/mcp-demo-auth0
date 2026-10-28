export const domainCodes = [
  "unauthenticated",
  "forbidden",
  "not_found",
  "currency_mismatch",
  "insufficient_funds",
  "same_account",
  "wrong_organization",
  "invalid_amount",
  "invalid_state",
  "unexpected",
] as const;

export type DomainCode = (typeof domainCodes)[number];

export class DomainError extends Error {
  readonly code: DomainCode;

  constructor(code: DomainCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
