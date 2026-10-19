"use client";
import { useEffect, useMemo, useState } from "react";
import type { InventoryItem } from "@/lib/domain";
import {
  previewInventoryCatalog,
  type InventoryCatalog,
  type InventoryCatalogLookup,
  type InventoryFilter,
} from "@/lib/inventory-catalog";

export function useInventoryCatalog({
  items,
  initialData,
  lookup,
  locationId,
  initialFilter = "all",
  initialQuery = "",
  initialExact = false,
}: {
  items: InventoryItem[];
  initialData?: InventoryCatalog;
  lookup?: InventoryCatalogLookup;
  locationId: string;
  initialFilter?: InventoryFilter;
  initialQuery?: string;
  initialExact?: boolean;
}) {
  const [query, setQueryValue] = useState(initialQuery);
  const [filter, setFilterValue] = useState<InventoryFilter>(initialFilter);
  const [page, setPage] = useState(1);
  const [exact, setExactValue] = useState(initialExact);
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([locationId, query, filter, page, exact, retry]);
  const [reply, setReply] = useState<{
    key: string;
    source?: InventoryCatalog;
    data?: InventoryCatalog;
    error?: string;
  }>({ key: "" });
  const seedMatches =
    initialData &&
    query === initialData.query &&
    filter === initialData.filter &&
    page === initialData.page &&
    exact === initialData.exact &&
    retry === 0;
  useEffect(() => {
    if (!lookup || seedMatches) return;
    let current = true;
    const timer = setTimeout(
      () => {
        lookup({ locationId, query, filter, page, exact })
          .then((result) => {
            if (current)
              setReply(
                result.ok
                  ? { key, source: initialData, data: result.data }
                  : { key, source: initialData, error: result.message },
              );
          })
          .catch(() => {
            if (current)
              setReply({
                key,
                source: initialData,
                error:
                  "No fue posible consultar el inventario. Intenta de nuevo.",
              });
          });
      },
      exact ? 0 : 250,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [
    lookup,
    seedMatches,
    locationId,
    query,
    filter,
    page,
    exact,
    key,
    initialData,
  ]);
  const preview = useMemo(
    () =>
      !lookup
        ? previewInventoryCatalog(items, { query, filter, page, exact })
        : null,
    [lookup, items, query, filter, page, exact],
  );
  const current = reply.key === key && reply.source === initialData;
  const data =
    preview ?? (seedMatches ? initialData : current ? reply.data : undefined);
  const error = current ? reply.error : undefined;
  return {
    query,
    filter,
    exact,
    data,
    error,
    pending: !data && !error,
    refresh: () => setRetry((v) => v + 1),
    setPage,
    setQuery: (value: string) => {
      setQueryValue(value);
      setExactValue(false);
      setPage(1);
    },
    setFilter: (value: InventoryFilter) => {
      setFilterValue(value);
      setPage(1);
    },
    setExact: (value: boolean) => {
      setExactValue(value && Boolean(query.trim()));
      setPage(1);
    },
  };
}

export function InventoryPagination({
  data,
  pending,
  error,
  onPage,
  onRetry,
  label = "Páginas de inventario",
}: {
  data?: InventoryCatalog | null;
  pending: boolean;
  error?: string;
  onPage: (page: number) => void;
  onRetry: () => void;
  label?: string;
}) {
  if (error)
    return (
      <div role="alert" className="inventory-feedback error">
        <span>{error}</span>
        <button type="button" className="secondary-button" onClick={onRetry}>
          Reintentar
        </button>
      </div>
    );
  if (pending || !data)
    return <p role="status">Consultando todo el catálogo…</p>;
  const pages = Math.max(1, Math.ceil(data.totalCount / data.pageSize));
  return (
    <nav className="inventory-pagination" aria-label={label}>
      <span role="status">
        {data.totalCount.toLocaleString("es-MX")} variantes coincidentes ·
        Página {data.page} de {pages}
      </span>
      <button
        type="button"
        className="secondary-button"
        disabled={data.page <= 1}
        onClick={() => onPage(data.page - 1)}
      >
        Anterior
      </button>
      <button
        type="button"
        className="secondary-button"
        disabled={data.page >= pages}
        onClick={() => onPage(data.page + 1)}
      >
        Siguiente
      </button>
    </nav>
  );
}
