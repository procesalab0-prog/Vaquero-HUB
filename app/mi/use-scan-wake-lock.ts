"use client";

import { useEffect } from "react";

/** Prevents dimming while scanning; browsers cannot set hardware brightness. */
export function useScanWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let disposed = false;
    let pending = false;
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      if (disposed || pending || lock || document.visibilityState !== "visible")
        return;
      pending = true;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (disposed) await next.release();
        else {
          lock = next;
          next.addEventListener("release", () => {
            if (lock === next) lock = null;
          });
        }
      } catch {
        /* Scanning remains available if the device denies the lock. */
      } finally {
        pending = false;
      }
    };
    const visibility = () => {
      if (document.visibilityState === "visible") void acquire();
      else {
        const previous = lock;
        lock = null;
        void previous?.release().catch(() => {});
      }
    };
    void acquire();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", visibility);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
