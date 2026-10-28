import { DomainError } from "./errors.js";

export function assertPermission(granted: readonly string[], required: string): void {
  if (!granted.includes(required)) {
    throw new DomainError("forbidden", `Missing permission ${required}`);
  }
}
