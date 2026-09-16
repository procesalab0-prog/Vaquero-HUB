import type { Metadata } from "next";
import Link from "next/link";
import {
  CalendarClock,
  ChevronRight,
  CircleDollarSign,
  PackageCheck,
  Search,
  TriangleAlert,
} from "lucide-react";

import { resolveActiveLocation } from "@/lib/auth/active-location";
import { requirePermission } from "@/lib/auth/authorization";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  cancelActiveLayaway,
  cancelOverdueLayaway,
  fulfillLayaway,
  receiveLayawayPayment,
  substituteLayawayItem,
} from "./actions";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Apartados" };

type LayawayRow = {
  id: string;
  folio: string;
  status: "OPEN" | "PARTIALLY_PAID" | "PAID" | "COMPLETED" | "CANCELLED";
  due_date: string;
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
  customer_name: string;
  member_number: string;
  item_count: number;
  unit_count: number;
  created_at: string;
};

type PaymentReceipt = {
  folio: string;
  layaway_folio: string;
  received_at: string;
  total_cents: number;
  balance_before_cents: number;
  balance_cents: number;
  customer_name: string;
  member_number: string;
  location_name: string;
  cashier_name: string;
  register_name: string;
  parts: Array<{
    method_name: string;
    amount_cents: number;
    reference?: string;
  }>;
};

type LayawayItemRow = {
  id: string;
  layaway_id: string;
  line_number: number;
  variant_id: string;
  product_name: string;
  sku: string;
  variant_description: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
};

type SelectedLayawayItem = LayawayItemRow & {
  layaway_folio: string;
  layaway_status: LayawayRow["status"];
  location_id: string;
  paid_cents: number;
  balance_cents: number;
  total_cents: number;
};

type CatalogRow = {
  variant_id: string;
  product_name: string;
  sku: string;
  price_cents: number;
  attributes: Record<string, string> | null;
  is_active: boolean;
};

type InventoryRow = { variant_id: string; available_qty: number };

type ReplacementCandidate = CatalogRow & {
  available_qty: number;
  disabled_reason?: string;
};

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});
const date = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" });
const activeStatuses = new Set<LayawayRow["status"]>([
  "OPEN",
  "PARTIALLY_PAID",
  "PAID",
]);

const statusLabels: Record<LayawayRow["status"], string> = {
  OPEN: "Abierto",
  PARTIALLY_PAID: "Con abonos",
  PAID: "Liquidado",
  COMPLETED: "Entregado",
  CANCELLED: "Cancelado",
};

export default async function LayawaysPage({
  searchParams,
}: {
  searchParams: Promise<{
    ubicacion?: string;
    busqueda?: string;
    estado?: string;
    status?: string;
    payment?: string;
    penalty?: string;
    refund?: string;
    released?: string;
    cambiar?: string;
    reemplazo?: string;
    total?: string;
    balance?: string;
    sale?: string;
    folio?: string;
  }>;
}) {
  const params = await searchParams;
  if (!isSupabaseConfigured()) {
    return <LayawayPageContent rows={[]} locationId="preview" preview />;
  }
  const { supabase, profile, roleId } =
    await requirePermission("layaways.manage");
  const locations = (profile?.user_locations ?? []).flatMap((entry) =>
    Array.isArray(entry.locations)
      ? entry.locations
      : entry.locations
        ? [entry.locations]
        : [],
  );
  const location = await resolveActiveLocation(locations, params.ubicacion);
  if (!location) {
    return (
      <LayawayPageContent
        rows={[]}
        locationId=""
        status="No tienes una sucursal disponible."
      />
    );
  }
  const allowedStatus = [
    "OPEN",
    "PARTIALLY_PAID",
    "PAID",
    "COMPLETED",
    "CANCELLED",
  ].includes(params.estado ?? "")
    ? params.estado!
    : null;
  const [
    modifyPermission,
    deliverPermission,
    cancelExceptionPermission,
    result,
    receiptResult,
  ] = await Promise.all([
    supabase
      .from("role_permissions")
      .select("permission_code")
      .eq("role_id", roleId)
      .eq("permission_code", "layaways.modify")
      .maybeSingle(),
    supabase
      .from("role_permissions")
      .select("permission_code")
      .eq("role_id", roleId)
      .eq("permission_code", "layaways.deliver")
      .maybeSingle(),
    supabase
      .from("role_permissions")
      .select("permission_code")
      .eq("role_id", roleId)
      .eq("permission_code", "layaways.cancel_exception")
      .maybeSingle(),
    supabase.rpc("list_layaways", {
      p_location_id: location.id,
      p_query: (params.busqueda ?? "").trim().slice(0, 100),
      p_status: allowedStatus,
      p_limit: 100,
    }),
    params.payment
      ? supabase.rpc("get_layaway_payment_receipt", {
          p_payment_id: params.payment,
        })
      : Promise.resolve({ data: null, error: null }),
  ]);
  const canModify = Boolean(modifyPermission.data);
  const canDeliver = Boolean(deliverPermission.data);
  const canCancelException = Boolean(cancelExceptionPermission.data);
  const replacementQuery = (params.reemplazo ?? "").trim().slice(0, 100);
  const rows = (result.data ?? []) as LayawayRow[];
  const [itemsResult, selectedItemResult, catalogResult, inventoryResult] =
    await Promise.all([
      supabase.rpc("list_layaway_items", {
        p_layaway_ids: rows.map((row) => row.id),
      }),
      params.cambiar && canModify
        ? supabase.rpc("get_layaway_item", { p_item_id: params.cambiar })
        : Promise.resolve({ data: null, error: null }),
      params.cambiar && canModify
        ? supabase.rpc("search_catalog", {
            p_query: replacementQuery,
            p_limit: 50,
          })
        : Promise.resolve({ data: [], error: null }),
      params.cambiar && canModify
        ? supabase.rpc("get_inventory_snapshot", {
            p_location_id: location.id,
            p_query: replacementQuery,
            p_limit: 100,
          })
        : Promise.resolve({ data: [], error: null }),
    ]);
  const selectedItem = selectedItemResult.data as SelectedLayawayItem | null;
  const dataError =
    modifyPermission.error ??
    deliverPermission.error ??
    cancelExceptionPermission.error ??
    result.error ??
    receiptResult.error ??
    itemsResult.error ??
    selectedItemResult.error ??
    catalogResult.error ??
    inventoryResult.error;
  if (dataError) {
    console.error("[apartados] data unavailable", {
      message: dataError.message,
      selectedItem: params.cambiar ?? null,
    });
  }
  const stocks = new Map(
    ((inventoryResult.data ?? []) as InventoryRow[]).map((row) => [
      row.variant_id,
      Number(row.available_qty),
    ]),
  );
  const candidates = ((catalogResult.data ?? []) as CatalogRow[])
    .filter(
      (row) => row.is_active && row.variant_id !== selectedItem?.variant_id,
    )
    .map((row): ReplacementCandidate => {
      const available = stocks.get(row.variant_id) ?? 0;
      const quantity = Number(selectedItem?.quantity ?? 0);
      const resultingTotal = selectedItem
        ? Number(selectedItem.total_cents) -
          Number(selectedItem.line_total_cents) +
          quantity * Number(row.price_cents)
        : 0;
      return {
        ...row,
        available_qty: available,
        disabled_reason:
          available < quantity
            ? "Sin existencia suficiente"
            : selectedItem && resultingTotal < Number(selectedItem.paid_cents)
              ? "Requeriría devolver dinero"
              : undefined,
      };
    });
  return (
    <LayawayPageContent
      rows={rows}
      locationId={location.id}
      query={params.busqueda ?? ""}
      selectedStatus={allowedStatus ?? ""}
      status={dataError?.message}
      operationStatus={params.status}
      operationTotalCents={Number(params.total ?? 0)}
      operationBalanceCents={Number(params.balance ?? 0)}
      penaltyCents={Number(params.penalty ?? 0)}
      refundCents={Number(params.refund ?? 0)}
      releasedBalanceCents={Number(params.released ?? 0)}
      receipt={receiptResult.data as PaymentReceipt | null}
      items={(itemsResult.data ?? []) as LayawayItemRow[]}
      canModify={canModify}
      selectedItem={selectedItem}
      candidates={candidates}
      replacementQuery={replacementQuery}
      canDeliver={canDeliver}
      canCancelException={canCancelException}
      deliveredSaleFolio={params.folio}
    />
  );
}

function LayawayPageContent({
  rows,
  locationId,
  query = "",
  selectedStatus = "",
  status,
  operationStatus,
  operationTotalCents = 0,
  operationBalanceCents = 0,
  penaltyCents = 0,
  refundCents = 0,
  releasedBalanceCents = 0,
  receipt,
  items = [],
  canModify = false,
  selectedItem,
  candidates = [],
  replacementQuery = "",
  preview = false,
  canDeliver = false,
  canCancelException = false,
  deliveredSaleFolio,
}: {
  rows: LayawayRow[];
  locationId: string;
  query?: string;
  selectedStatus?: string;
  status?: string;
  operationStatus?: string;
  operationTotalCents?: number;
  operationBalanceCents?: number;
  penaltyCents?: number;
  refundCents?: number;
  releasedBalanceCents?: number;
  receipt?: PaymentReceipt | null;
  items?: LayawayItemRow[];
  canModify?: boolean;
  selectedItem?: SelectedLayawayItem | null;
  candidates?: ReplacementCandidate[];
  replacementQuery?: string;
  preview?: boolean;
  canDeliver?: boolean;
  canCancelException?: boolean;
  deliveredSaleFolio?: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const warningDate = new Date();
  warningDate.setDate(warningDate.getDate() + 7);
  const warning = warningDate.toISOString().slice(0, 10);
  const itemsByLayaway = new Map<string, LayawayItemRow[]>();
  for (const item of items) {
    const grouped = itemsByLayaway.get(item.layaway_id) ?? [];
    grouped.push(item);
    itemsByLayaway.set(item.layaway_id, grouped);
  }
  return (
    <section className="module-page layaways-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Mercancía comprometida</p>
          <h1>Apartados</h1>
          <p className="heading-copy">
            Consulta reservas reales por folio, cliente o número de socio.
          </p>
        </div>
        <Link className="primary-button" href={`/pos?ubicacion=${locationId}`}>
          <PackageCheck aria-hidden="true" /> Nuevo desde Venta
        </Link>
      </div>
      {operationStatus === "abono-registrado" ? (
        <p className="notice-banner" role="status">
          Abono registrado. El saldo y la caja ya fueron actualizados.
        </p>
      ) : null}
      {operationStatus === "entrega-registrada" ? (
        <div className="notice-banner" role="status">
          Apartado entregado. La venta {deliveredSaleFolio || "generada"} ya
          aparece en Tickets; los abonos no se cobraron de nuevo.{" "}
          <Link href="/tickets">Ver e imprimir ticket</Link>
        </div>
      ) : null}
      {operationStatus?.startsWith("entrega-") &&
      operationStatus !== "entrega-registrada" ? (
        <p className="inline-error operation-feedback" role="alert">
          {operationStatus === "entrega-caja-requerida"
            ? "Abre tu caja en esta sucursal antes de entregar el apartado."
            : operationStatus === "entrega-no-liquidada"
              ? "El apartado todavía tiene saldo o ya no está disponible para entrega."
              : operationStatus === "entrega-sucursal-incorrecta"
                ? "La entrega debe registrarse en la sucursal donde se apartó la mercancía."
                : operationStatus === "entrega-ya-registrada"
                  ? "Este apartado ya fue entregado."
                  : operationStatus === "entrega-inventario-inconsistente"
                    ? "La reserva no coincide con el inventario. No se creó ninguna venta; solicita una revisión."
                    : operationStatus === "entrega-confirmacion-requerida"
                      ? "Confirma que el cliente recibió toda la mercancía."
                      : "No fue posible entregar el apartado. No se modificó la venta, la caja ni el inventario."}
        </p>
      ) : null}
      {operationStatus === "apartado-cancelado" ? (
        <p className="notice-banner" role="status">
          Apartado cancelado. Se conservaron {money.format(penaltyCents / 100)}
          como penalización, se canceló el saldo de{" "}
          {money.format(releasedBalanceCents / 100)} y la mercancía volvió a
          estar disponible.
        </p>
      ) : null}
      {operationStatus === "apartado-cancelado-excepcion" ? (
        <p className="notice-banner" role="status">
          Apartado cancelado por excepción. Se devolverán{" "}
          {money.format(refundCents / 100)}, se conservarán{" "}
          {money.format(penaltyCents / 100)} como penalización y se canceló el
          saldo de {money.format(releasedBalanceCents / 100)}. La mercancía ya
          volvió a estar disponible.
        </p>
      ) : null}
      {operationStatus === "sustitucion-registrada" ? (
        <p className="notice-banner" role="status">
          Producto sustituido. El nuevo total es{" "}
          {money.format(operationTotalCents / 100)} y quedan{" "}
          {money.format(operationBalanceCents / 100)} por pagar.
        </p>
      ) : null}
      {operationStatus?.startsWith("sustitucion-") &&
      operationStatus !== "sustitucion-registrada" ? (
        <p className="inline-error operation-feedback" role="alert">
          {operationStatus === "sustitucion-sin-existencia"
            ? "La variante elegida ya no tiene existencia suficiente."
            : operationStatus === "sustitucion-reembolso-pendiente"
              ? "Ese cambio dejaría dinero a devolver y la política todavía no está definida."
              : operationStatus === "sustitucion-desactualizada"
                ? "Otra persona modificó el apartado. Ábrelo nuevamente antes de continuar."
                : operationStatus === "sustitucion-variante-repetida"
                  ? "Esa variante ya forma parte del mismo apartado."
                  : operationStatus === "sustitucion-no-disponible"
                    ? "El apartado ya no admite modificaciones."
                    : "No fue posible sustituir el producto. Revisa la selección y el motivo."}
        </p>
      ) : null}
      {operationStatus?.startsWith("cancelacion-") &&
      !operationStatus.startsWith("cancelacion-excepcion-") ? (
        <p className="inline-error operation-feedback" role="alert">
          {operationStatus === "cancelacion-no-vencido"
            ? "Este apartado todavía no vence. Su política de cancelación y devolución aún debe definirse."
            : operationStatus === "cancelacion-no-disponible"
              ? "El apartado ya fue cancelado, entregado o no está disponible."
              : "No fue posible cancelar el apartado. Revisa el motivo e intenta nuevamente."}
        </p>
      ) : null}
      {operationStatus?.startsWith("cancelacion-excepcion-") ? (
        <p className="inline-error operation-feedback" role="alert">
          {operationStatus === "cancelacion-excepcion-caja-requerida"
            ? "Abre tu propia caja en esta sucursal antes de registrar una devolución."
            : operationStatus === "cancelacion-excepcion-efectivo-insuficiente"
              ? "La caja no tiene efectivo suficiente para completar la devolución. No se canceló el apartado."
              : operationStatus === "cancelacion-excepcion-referencia-requerida"
                ? "Captura la referencia de devolución para cada pago electrónico."
                : operationStatus === "cancelacion-excepcion-monto-invalido"
                  ? "La devolución no puede superar lo que el cliente ha abonado."
                  : operationStatus === "cancelacion-excepcion-ya-vencido"
                    ? "Este apartado ya venció. Usa la cancelación de vencido, que aplica la penalización definida."
                    : operationStatus === "cancelacion-excepcion-no-disponible"
                      ? "El apartado ya fue cancelado, entregado o no está disponible."
                      : operationStatus ===
                          "cancelacion-excepcion-datos-invalidos"
                        ? "Confirma la operación y revisa el monto y el motivo."
                        : "No fue posible cancelar el apartado. No se modificó la caja ni el inventario."}
        </p>
      ) : null}
      {operationStatus?.startsWith("abono-") &&
      operationStatus !== "abono-registrado" ? (
        <p className="inline-error operation-feedback" role="alert">
          {operationStatus === "abono-caja-requerida"
            ? "Abre tu caja antes de recibir un abono."
            : operationStatus === "abono-mayor-saldo"
              ? "El abono supera el saldo pendiente."
              : "No fue posible registrar el abono. Revisa importes y referencias."}
        </p>
      ) : null}
      {selectedItem && canModify ? (
        <article className="layaway-substitution-editor">
          <header>
            <div>
              <p className="eyebrow">Sustituir producto</p>
              <h2>{selectedItem.layaway_folio}</h2>
            </div>
            <Link
              className="secondary-button"
              href={`/apartados?ubicacion=${encodeURIComponent(locationId)}`}
            >
              Cerrar
            </Link>
          </header>
          <div className="layaway-substitution-current">
            <span>Producto actual</span>
            <strong>{selectedItem.product_name}</strong>
            <small>
              {selectedItem.variant_description || "Única"} · {selectedItem.sku}
              {" · "}
              {Number(selectedItem.quantity)} pzas ·{" "}
              {money.format(Number(selectedItem.line_total_cents) / 100)}
            </small>
          </div>
          <form className="layaway-replacement-search" method="get">
            <input type="hidden" name="ubicacion" value={locationId} />
            <input type="hidden" name="cambiar" value={selectedItem.id} />
            <label>
              <Search aria-hidden="true" />
              <input
                name="reemplazo"
                defaultValue={replacementQuery}
                placeholder="Buscar producto, talla, color, SKU o código"
                maxLength={100}
              />
            </label>
            <button className="secondary-button" type="submit">
              Buscar reemplazo
            </button>
          </form>
          <form
            className="layaway-substitution-form"
            action={substituteLayawayItem}
          >
            <input
              type="hidden"
              name="layaway_id"
              value={selectedItem.layaway_id}
            />
            <input
              type="hidden"
              name="layaway_item_id"
              value={selectedItem.id}
            />
            <input
              type="hidden"
              name="expected_variant_id"
              value={selectedItem.variant_id}
            />
            <label>
              <span>Nuevo producto para toda la línea</span>
              <select name="new_variant_id" required defaultValue="">
                <option value="" disabled>
                  Selecciona entre {candidates.length} resultados
                </option>
                {candidates.map((candidate) => {
                  const attributes = Object.values(candidate.attributes ?? {})
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <option
                      key={candidate.variant_id}
                      value={candidate.variant_id}
                      disabled={Boolean(candidate.disabled_reason)}
                    >
                      {candidate.product_name} · {attributes || "Única"} ·{" "}
                      {candidate.sku} ·{" "}
                      {money.format(Number(candidate.price_cents) / 100)}
                      {" · "}
                      {Number(candidate.available_qty)} disponibles
                      {candidate.disabled_reason
                        ? ` · ${candidate.disabled_reason}`
                        : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            <label>
              <span>Motivo del cambio</span>
              <textarea
                name="reason"
                required
                minLength={3}
                maxLength={500}
                placeholder="Ej. El cliente solicitó otra talla"
              />
            </label>
            <p>
              Se reemplazarán las {Number(selectedItem.quantity)} piezas de esta
              línea. El sistema liberará la anterior, reservará la nueva y
              recalculará el saldo sin modificar los abonos recibidos.
            </p>
            <button
              className="primary-button"
              type="submit"
              disabled={
                !candidates.some((candidate) => !candidate.disabled_reason)
              }
            >
              Confirmar sustitución
            </button>
          </form>
        </article>
      ) : null}
      {receipt ? (
        <article className="layaway-receipt print-receipt">
          <header>
            <div>
              <small>Comprobante de abono</small>
              <strong>{receipt.folio}</strong>
            </div>
            <PrintButton />
          </header>
          <h2>Mi Tienda SM</h2>
          <p>
            {receipt.location_name} · {receipt.register_name}
          </p>
          <dl>
            <div>
              <dt>Apartado</dt>
              <dd>{receipt.layaway_folio}</dd>
            </div>
            <div>
              <dt>Cliente</dt>
              <dd>
                {receipt.customer_name} · {receipt.member_number}
              </dd>
            </div>
            <div>
              <dt>Atendió</dt>
              <dd>{receipt.cashier_name}</dd>
            </div>
            <div>
              <dt>Fecha</dt>
              <dd>{date.format(new Date(receipt.received_at))}</dd>
            </div>
          </dl>
          <div className="layaway-receipt-parts">
            {receipt.parts.map((part, index) => (
              <p key={`${part.method_name}-${index}`}>
                <span>{part.method_name}</span>
                <strong>{money.format(Number(part.amount_cents) / 100)}</strong>
              </p>
            ))}
          </div>
          <p className="layaway-receipt-total">
            <span>Abono</span>
            <strong>{money.format(Number(receipt.total_cents) / 100)}</strong>
          </p>
          <p>
            <span>
              Saldo anterior:{" "}
              {money.format(Number(receipt.balance_before_cents) / 100)}
            </span>
            <br />
            <strong>
              Saldo pendiente:{" "}
              {money.format(Number(receipt.balance_cents) / 100)}
            </strong>
          </p>
        </article>
      ) : null}
      <form className="layaway-filters" method="get">
        <input type="hidden" name="ubicacion" value={locationId} />
        <label>
          <Search aria-hidden="true" />
          <input
            name="busqueda"
            defaultValue={query}
            placeholder="Folio, cliente o número de socio"
            maxLength={100}
          />
        </label>
        <select
          name="estado"
          defaultValue={selectedStatus}
          aria-label="Estado del apartado"
        >
          <option value="">Todos los estados</option>
          <option value="OPEN">Abiertos</option>
          <option value="PARTIALLY_PAID">Con abonos</option>
          <option value="PAID">Liquidados</option>
          <option value="COMPLETED">Entregados</option>
          <option value="CANCELLED">Cancelados</option>
        </select>
        <button className="secondary-button" type="submit">
          Buscar
        </button>
      </form>
      {status ? (
        <p className="inline-error operation-feedback" role="alert">
          No fue posible consultar apartados.
        </p>
      ) : null}
      {preview ? (
        <p className="notice-banner">
          Vista previa: conecta Supabase para crear reservas reales.
        </p>
      ) : null}
      <div className="layaway-list">
        {rows.length === 0 ? (
          <div className="empty-state">
            <CalendarClock aria-hidden="true" />
            <strong>No hay apartados con esos filtros</strong>
            <p>Créalo desde el carrito de Venta para reservar la mercancía.</p>
          </div>
        ) : (
          rows.map((row) => {
            const active = activeStatuses.has(row.status);
            const rowItems = itemsByLayaway.get(row.id) ?? [];
            const timing = !active
              ? "closed"
              : row.due_date < today
                ? "overdue"
                : row.due_date <= warning
                  ? "warning"
                  : "current";
            return (
              <article className={`layaway-card ${timing}`} key={row.id}>
                <header>
                  <div>
                    <code>{row.folio}</code>
                    <strong>{row.customer_name}</strong>
                  </div>
                  <span>{statusLabels[row.status]}</span>
                </header>
                <div className="layaway-card-grid">
                  <span>
                    <small>Vence</small>
                    <strong>
                      {date.format(new Date(`${row.due_date}T12:00:00`))}
                    </strong>
                  </span>
                  <span>
                    <small>Mercancía</small>
                    <strong>
                      {Number(row.unit_count)} pzas · {Number(row.item_count)}{" "}
                      variantes
                    </strong>
                  </span>
                  <span>
                    <small>Pagado</small>
                    <strong>
                      {money.format(Number(row.paid_cents) / 100)}
                    </strong>
                  </span>
                  <span>
                    <small>Saldo</small>
                    <strong>
                      {money.format(Number(row.balance_cents) / 100)}
                    </strong>
                  </span>
                </div>
                <div className="layaway-items">
                  {rowItems.map((item) => (
                    <div key={item.id}>
                      <span>
                        <strong>{item.product_name}</strong>
                        <small>
                          {item.variant_description || "Única"} · {item.sku}
                        </small>
                      </span>
                      <span>
                        {Number(item.quantity)} ×{" "}
                        {money.format(Number(item.unit_price_cents) / 100)}
                      </span>
                      {active && canModify ? (
                        <Link
                          href={`/apartados?ubicacion=${encodeURIComponent(
                            locationId,
                          )}&cambiar=${encodeURIComponent(item.id)}`}
                        >
                          Sustituir <ChevronRight aria-hidden="true" />
                        </Link>
                      ) : null}
                    </div>
                  ))}
                </div>
                <footer>
                  Socio {row.member_number} · Total{" "}
                  {money.format(Number(row.total_cents) / 100)}
                </footer>
                {row.status === "PAID" && canDeliver ? (
                  <details className="layaway-payment-panel">
                    <summary>
                      <PackageCheck aria-hidden="true" /> Entregar apartado
                    </summary>
                    <form action={fulfillLayaway}>
                      <input type="hidden" name="layaway_id" value={row.id} />
                      <p>
                        Esta operación descontará físicamente las piezas
                        reservadas, creará la venta real y habilitará su ticket.
                        No volverá a cobrar los abonos.
                      </p>
                      <label className="layaway-delivery-confirmation">
                        <input
                          type="checkbox"
                          name="confirmed"
                          value="yes"
                          required
                        />
                        <span>
                          Confirmo que el cliente recibió todas las piezas en
                          esta sucursal.
                        </span>
                      </label>
                      <button className="primary-button" type="submit">
                        Confirmar entrega y generar ticket
                      </button>
                    </form>
                  </details>
                ) : null}
                {active && Number(row.balance_cents) > 0 ? (
                  <details className="layaway-payment-panel">
                    <summary>
                      <CircleDollarSign aria-hidden="true" /> Recibir abono
                    </summary>
                    <form action={receiveLayawayPayment}>
                      <input type="hidden" name="layaway_id" value={row.id} />
                      <p>
                        Puede combinar métodos. La suma no debe superar{" "}
                        {money.format(Number(row.balance_cents) / 100)}.
                      </p>
                      <div className="credit-payment-grid">
                        <label>
                          <span>Efectivo</span>
                          <input
                            name="cash"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max={Number(row.balance_cents) / 100}
                            step="0.01"
                            placeholder="0.00"
                          />
                        </label>
                        <label>
                          <span>Tarjeta</span>
                          <input
                            name="card"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max={Number(row.balance_cents) / 100}
                            step="0.01"
                            placeholder="0.00"
                          />
                        </label>
                        <label>
                          <span>Referencia tarjeta</span>
                          <input
                            name="card_reference"
                            placeholder="Mínimo 3 caracteres"
                          />
                        </label>
                        <label>
                          <span>Transferencia</span>
                          <input
                            name="transfer"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max={Number(row.balance_cents) / 100}
                            step="0.01"
                            placeholder="0.00"
                          />
                        </label>
                        <label>
                          <span>Referencia transferencia</span>
                          <input
                            name="transfer_reference"
                            placeholder="Mínimo 3 caracteres"
                          />
                        </label>
                        <label>
                          <span>Nota opcional</span>
                          <input name="note" minLength={3} maxLength={500} />
                        </label>
                      </div>
                      <button className="primary-button" type="submit">
                        Confirmar abono
                      </button>
                    </form>
                  </details>
                ) : null}
                {timing === "overdue" ? (
                  <details className="layaway-cancel-panel">
                    <summary>
                      <TriangleAlert aria-hidden="true" /> Cancelar vencido
                    </summary>
                    <form action={cancelOverdueLayaway}>
                      <input type="hidden" name="layaway_id" value={row.id} />
                      <p>
                        Se conservarán{" "}
                        <strong>
                          {money.format(Number(row.paid_cents) / 100)}
                        </strong>{" "}
                        como penalización y se liberarán{" "}
                        {Number(row.unit_count)} piezas. Esta operación no
                        entrega dinero de caja.
                      </p>
                      <label>
                        <span>Motivo de cancelación</span>
                        <textarea
                          name="reason"
                          minLength={3}
                          maxLength={500}
                          required
                          placeholder="Explica por qué se cancela el apartado vencido"
                        />
                      </label>
                      <button className="danger-button" type="submit">
                        Confirmar cancelación
                      </button>
                    </form>
                  </details>
                ) : null}
                {active && timing !== "overdue" && canCancelException ? (
                  <details className="layaway-cancel-panel">
                    <summary>
                      <TriangleAlert aria-hidden="true" /> Cancelar antes de
                      vencer
                    </summary>
                    <form action={cancelActiveLayaway}>
                      <input type="hidden" name="layaway_id" value={row.id} />
                      <p>
                        Administración o gerencia decide cuánto devolver. El
                        resto de lo abonado queda como penalización y las piezas
                        se liberan. La devolución conserva los métodos
                        originales.
                      </p>
                      <div className="credit-payment-grid">
                        <label>
                          <span>Importe total a devolver</span>
                          <input
                            name="refund"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max={Number(row.paid_cents) / 100}
                            step="0.01"
                            required
                            placeholder="0.00"
                          />
                          <small>
                            Máximo {money.format(Number(row.paid_cents) / 100)}.
                            Lo no devuelto quedará como penalización.
                          </small>
                        </label>
                        <label>
                          <span>Referencia devolución a tarjeta</span>
                          <input
                            name="card_reference"
                            placeholder="Sólo si hubo pago con tarjeta"
                          />
                        </label>
                        <label>
                          <span>Referencia devolución por transferencia</span>
                          <input
                            name="transfer_reference"
                            placeholder="Sólo si hubo transferencia"
                          />
                        </label>
                      </div>
                      <label>
                        <span>Motivo y decisión autorizada</span>
                        <textarea
                          name="reason"
                          minLength={3}
                          maxLength={500}
                          required
                          placeholder="Explica por qué se cancela y la penalización acordada"
                        />
                      </label>
                      <label className="layaway-delivery-confirmation">
                        <input
                          type="checkbox"
                          name="confirmed"
                          value="yes"
                          required
                        />
                        <span>
                          Confirmo la devolución, la penalización y la
                          liberación de {Number(row.unit_count)} piezas.
                        </span>
                      </label>
                      <button className="danger-button" type="submit">
                        Confirmar cancelación excepcional
                      </button>
                    </form>
                  </details>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
