import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertPermission } from "./access.js";
import { DomainError } from "./errors.js";

describe("permission checks", () => {
  it("allows a call when the token includes the required permission", () => {
    assert.doesNotThrow(() => {
      assertPermission(["accounts:read", "cards:read"], "accounts:read");
    });
  });

  it("rejects a call that lacks the required permission", () => {
    assert.throws(
      () => assertPermission(["cards:read"], "accounts:read"),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, "forbidden");
        assert.match(error.message, /accounts:read/);
        return true;
      },
    );
  });

  it("rejects a token with no permissions", () => {
    assert.throws(
      () => assertPermission([], "treasury:read"),
      (error: unknown) => error instanceof DomainError && error.code === "forbidden",
    );
  });
});
