"use client";

import { Check, Search, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { browserOperation } from "@/lib/browser-operations";
import { useWorkspace } from "@/components/workspace-context";

import { formatCustomerPhone, type CustomerSummary } from "@/lib/customers";

export function CustomerLookup({
  selected,
  onSelect,
  onClose,
}: {
  selected: CustomerSummary | null;
  onSelect: (customer: CustomerSummary | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const { activeLocation } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3 && !/^\d{4}$/.test(trimmed)) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/clientes/buscar?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal, cache: "no-store" },
        );
        const payload = (await response.json()) as {
          customers?: CustomerSummary[];
        };
        setResults(response.ok ? (payload.customers ?? []) : []);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <section
      className="checkout-modal customer-lookup-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customer-lookup-title"
    >
      <header>
        <div>
          <p className="eyebrow">Venta en curso</p>
          <h2 id="customer-lookup-title">Asociar cliente</h2>
          <p>Escribe teléfono, número de socio, nombre o correo.</p>
        </div>
        <button
          type="button"
          aria-label="Cerrar búsqueda de cliente"
          onClick={onClose}
          disabled={saving}
        >
          <X aria-hidden="true" />
        </button>
      </header>
      {selected ? (
        <div className="selected-customer">
          <span>
            <Check aria-hidden="true" />
          </span>
          <div>
            <strong>{selected.full_name}</strong>
            <small>
              {formatCustomerPhone(selected.phone_e164)} · Socio{" "}
              {selected.member_number}
            </small>
          </div>
          <button type="button" onClick={() => onSelect(null)}>
            Quitar
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className="secondary-button"
        disabled={saving}
        onClick={() => {
          setCreating(!creating);
          setError("");
        }}
      >
        {creating ? "Volver a buscar" : "Crear cliente aquí"}
      </button>
      {creating ? (
        <form
          className="form-stack inline-customer-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (saving) return;
            setSaving(true);
            setError("");
            try {
              const result = await browserOperation<
                | { ok: true; customer: CustomerSummary }
                | { ok: false; message: string }
              >("/api/operaciones", {
                operation: "customer.create",
                input: Object.fromEntries(new FormData(event.currentTarget)),
              });
              if (result.ok) {
                onSelect(result.customer);
                onClose();
              } else setError(result.message);
            } catch {
              setError(
                "No se pudo conectar. Tu venta sigue intacta; revisa si el cliente se guardó antes de repetir.",
              );
            } finally {
              setSaving(false);
            }
          }}
        >
          <input
            type="hidden"
            name="location_id"
            value={activeLocation?.id ?? ""}
          />
          <label>
            Nombre
            <input
              name="full_name"
              required
              maxLength={160}
              autoComplete="name"
            />
          </label>
          <label>
            Teléfono
            <input name="phone" required type="tel" autoComplete="tel" />
          </label>
          <label>
            Correo (opcional)
            <input name="email" type="email" autoComplete="email" />
          </label>
          <label>
            Versión del aviso entregado
            <input
              name="privacy_notice_version"
              required
              placeholder="Versión del aviso aprobado"
            />
          </label>
          <label>
            <input name="privacy_consent" type="checkbox" required />
            El cliente aceptó el aviso entregado
          </label>
          <label>
            <input name="marketing_consent" type="checkbox" />
            Acepta promociones (opcional)
          </label>
          {error ? <p role="alert">{error}</p> : null}
          <button
            type="submit"
            className="primary-button"
            disabled={saving || !activeLocation}
          >
            {saving ? "Guardando…" : "Guardar y asociar a esta venta"}
          </button>
          <small>
            La cuenta de Mi Vaquero se verifica por correo; este registro no
            crea una sesión ni autoriza crédito.
          </small>
        </form>
      ) : (
        <label className="customer-lookup-input">
          <Search aria-hidden="true" />
          <span className="sr-only">Buscar cliente</span>
          <input
            value={query}
            onChange={(event) => {
              const value = event.target.value;
              setQuery(value);
              if (value.trim().length < 3 && !/^\d{4}$/.test(value.trim()))
                setResults([]);
            }}
            placeholder="Ej. 352 123 4567"
          />
        </label>
      )}
      <div className="customer-lookup-results">
        {creating ? null : loading ? (
          <p>Buscando…</p>
        ) : (
          results.map((customer) => (
            <button
              type="button"
              key={customer.id}
              onClick={() => {
                onSelect(customer);
                onClose();
              }}
            >
              <UserRound aria-hidden="true" />
              <span>
                <strong>{customer.full_name}</strong>
                <small>
                  {formatCustomerPhone(customer.phone_e164)} ·{" "}
                  {customer.member_number}
                </small>
              </span>
            </button>
          ))
        )}
        {!creating &&
        !loading &&
        query.trim().length >= 3 &&
        results.length === 0 ? (
          <p>
            No encontramos coincidencias. Usa Crear cliente aquí sin salir de tu
            venta.
          </p>
        ) : null}
      </div>
    </section>
  );
}
