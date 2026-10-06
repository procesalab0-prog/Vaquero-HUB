"use client";
import { useRef, useState } from "react";
import Link from "next/link";
export function GalleryMigration({
  items,
  copyMigrationGallery,
}: {
  items: { id: string; name: string }[];
  copyMigrationGallery: (
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
      for (const item of items) {
        if (stop.current) break;
        if (results[item.id]?.ok) continue;
        let result;
        try {
          result = await copyMigrationGallery(item.id);
        } catch {
          result = {
            ok: false,
            message:
              "No se confirmó el resultado. Puedes volver a comprobarlo sin duplicar archivos.",
          };
        }
        setResults((previous) => ({ ...previous, [item.id]: result }));
      }
    } finally {
      setRunning(false);
    }
  }
  return (
    <>
      <p role="status">
        {Object.values(results).filter((r) => r.ok).length} de {items.length}{" "}
        productos comprobados.
      </p>
      <button type="button" disabled={running} onClick={run}>
        Copiar fotos conciliadas
      </button>
      {running && (
        <button
          type="button"
          onClick={() => {
            stop.current = true;
          }}
        >
          Detener después del producto actual
        </button>
      )}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <Link href={`/productos/ficha-web?producto=${item.id}`}>
              {item.name}
            </Link>{" "}
            — {results[item.id]?.message ?? "Pendiente"}
            {results[item.id] && !results[item.id].ok
              ? " · Revisión manual"
              : ""}
          </li>
        ))}
      </ul>
    </>
  );
}
