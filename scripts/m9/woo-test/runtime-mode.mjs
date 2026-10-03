import { resolve } from "node:path";

export function runtimeMode(root, option, marker) {
  if (option !== undefined && option !== "--recovery")
    throw new Error("UNKNOWN_RUNTIME_OPTION");
  if (option === "--recovery") {
    if (
      marker?.version !== "m9-local-recovery-1" ||
      marker.port !== 9427 ||
      marker.restored_root !== resolve(root) ||
      typeof marker.source !== "string" ||
      resolve(marker.source) === resolve(root) ||
      !/^[a-f0-9]{64}$/.test(marker.backup_manifest_sha256)
    )
      throw new Error("VERIFIED_RESTORE_REQUIRED");
    return { port: 9427, readOnly: true };
  }
  if (marker) throw new Error("RECOVERY_REQUIRES_READ_ONLY_MODE");
  return { port: 9417, readOnly: false };
}
