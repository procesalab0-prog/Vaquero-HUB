"use client";
import { useRef, useState } from "react";
import Link from "next/link";
export function GalleryMigration({
  items,
  buttonLabel = "Copiar fotos conciliadas",
  copyMigrationGallery,
  variantCopies = false,
  concurrency = 1,
}: {
  buttonLabel?: string;
  items: { id: string; name: string; done?: boolean }[];
  variantCopies?: boolean;
  concurrency?: number;
  copyMigrationGallery?: (
    id: string,
  ) => Promise<{ ok: boolean; message: string }>;
}) {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<
    Record<string, { ok: boolean; message: string }>
  >({});
  const stop = useRef(false);
  async function run() {
    stop.current = false;
    setRunning(true);
    try {
      let cursor = 0;
      async function worker() {
        while (cursor < items.length) {
          const item = items[cursor++];
          if (stop.current) break;
          if (item.done || results[item.id]?.ok) continue;
          let result;
          try {
            if (variantCopies) {
              const response = await fetch("/api/productos/fotos-variantes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ productId: item.id }),
              });
              if (!response.ok) throw Error("COPY_RESPONSE");
              result = await response.json();
              if (
                typeof result.ok !== "boolean" ||
                typeof result.message !== "string"
              )
                throw Error("COPY_RESPONSE");
            } else if (copyMigrationGallery)
              result = await copyMigrationGallery(item.id);
            else throw Error("COPY_HANDLER");
          } catch {
            result = {
              ok: false,
              message:
                "No se confirmó el resultado. Puedes volver a comprobarlo sin duplicar archivos.",
            };
          }
          setResults((previous) => ({ ...previous, [item.id]: result }));
        }
      }
      await Promise.all(
        Array.from({ length: Math.max(1, Math.min(4, concurrency)) }, () =>
          worker(),
        ),
      );
    } finally {
      setRunning(false);
    }
  }
  return (
    <>
      <p role="status">
        {items.filter((item) => item.done || results[item.id]?.ok).length} de{" "}
        {items.length} productos comprobados.
      </p>
      <button
        type="button"
        disabled={
          running || items.every((item) => item.done || results[item.id]?.ok)
        }
        onClick={run}
      >
        {buttonLabel}
      </button>
      {running && (
        <button
          type="button"
          onClick={() => {
            stop.current = true;
          }}
        >
          Detener después de los productos en curso
        </button>
      )}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <Link href={`/productos/ficha-web?producto=${item.id}`}>
              {item.name}
            </Link>{" "}
            —{" "}
            {results[item.id]?.message ??
              (item.done ? "Fotos ya guardadas en Mi Tienda." : "Pendiente")}
            {results[item.id] && !results[item.id].ok
              ? " · Revisión manual"
              : ""}
          </li>
        ))}
      </ul>
    </>
  );
}
