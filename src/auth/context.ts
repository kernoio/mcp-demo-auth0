import { AsyncLocalStorage } from "node:async_hooks";
import { DomainError } from "../domain/errors.js";
import type { VerifiedAccess } from "./verify.js";

export const accessStore = new AsyncLocalStorage<VerifiedAccess>();

export function currentAccess(): VerifiedAccess {
  const access = accessStore.getStore();
  if (!access) {
    throw new DomainError("unauthenticated", "No authenticated caller");
  }
  return access;
}
