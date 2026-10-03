import { execFileSync } from "node:child_process";
import { it, expect } from "vitest";
import { runtimeMode } from "../../scripts/m9/woo-test/runtime-mode.mjs";

it("restores SQLite and files and refuses corrupt, active or unsafe backups", () => {
  expect(() =>
    execFileSync("python3", ["tests/unit/m9-recovery.py"], { stdio: "pipe" }),
  ).not.toThrow();
});
it("only boots a marked recovery on its separate read-only port", () => {
  const marker = {
    version: "m9-local-recovery-1",
    source: "/source",
    restored_root: "/copy",
    backup_manifest_sha256: "a".repeat(64),
    port: 9427,
  };
  expect(runtimeMode("/copy", "--recovery", marker)).toEqual({
    port: 9427,
    readOnly: true,
  });
  expect(() => runtimeMode("/copy", undefined, marker)).toThrow("READ_ONLY");
  expect(() => runtimeMode("/source", "--recovery", marker)).toThrow(
    "VERIFIED_RESTORE",
  );
  expect(() => runtimeMode("/copy", "--recovery", null)).toThrow(
    "VERIFIED_RESTORE",
  );
  expect(() => runtimeMode("/copy", "--prod", null)).toThrow("UNKNOWN_RUNTIME");
  expect(runtimeMode("/source", undefined, null)).toEqual({
    port: 9417,
    readOnly: false,
  });
});
