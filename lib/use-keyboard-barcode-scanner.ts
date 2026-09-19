"use client";

import { useEffect, useRef } from "react";

const scannerKeyGapMs = 120;

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** Captura lectores USB configurados como teclado, aun sin un campo enfocado. */
export function useKeyboardBarcodeScanner(
  onScan: (code: string) => void,
  enabled = true,
) {
  const onScanRef = useRef(onScan);
  const bufferRef = useRef("");
  const lastKeyAtRef = useRef(0);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isEditableTarget(event.target)
      )
        return;

      const now = performance.now();
      if (now - lastKeyAtRef.current > scannerKeyGapMs) bufferRef.current = "";
      lastKeyAtRef.current = now;

      if (event.key === "Enter" || event.key === "Tab") {
        const code = bufferRef.current.trim();
        bufferRef.current = "";
        if (code.length < 4) return;
        event.preventDefault();
        onScanRef.current(code);
        return;
      }

      if (event.key.length === 1) bufferRef.current += event.key;
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled]);
}
