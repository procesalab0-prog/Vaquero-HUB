import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stable } from "./woo-test/plan.mjs";
import { auditStagedCatalog } from "./audit-staged-catalog.mjs";

const json = (v) => JSON.stringify(v, null, 2) + "\n";
const sha = (v) => createHash("sha256").update(v).digest("hex");
const digest = (v) => sha(stable(v));
const same = (a, b) => stable(a) === stable(b);
const inventoryFields = new Set([
  "Inventario",
  "Cantidad de bajo inventario",
  "¿En inventario?",
]);
const csvKinds = Object.fromEntries(
  Object.entries({
    identity: ["ID", "Tipo", "SKU", "Descripción corta", "Superior"],
    editorial: ["Nombre", "Descripción", "Imágenes"],
    status: ["Publicado"],
    taxonomy: ["Categorías"],
    commercial: [
      "Precio normal",
      "Precio rebajado",
      "Día en que empieza el precio rebajado",
      "Día en que termina el precio rebajado",
    ],
  }).flatMap(([kind, fields]) => fields.map((field) => [field, kind])),
);
const groups = {
  identity: ["type", "sku", "short_description"],
  editorial: ["name", "description", "images"],
  taxonomy: ["categories", "attributes"],
  status: ["status"],
  commercial: ["price", "sale_price"],
};
const statuses = new Set(["publish", "private", "draft"]);
const validId = (id) => Number.isSafeInteger(id) && id > 0;

function index(snapshot) {
  if (
    snapshot.schema_version !== 1 ||
    snapshot.scope !== "authenticated_csv_excludes_trash" ||
    snapshot.pagination_complete !== true ||
    !Array.isArray(snapshot.products) ||
    snapshot.expected_parents_from_panel !== snapshot.products.length ||
    !/^[a-f0-9]{64}$/.test(snapshot.source_csv_sha256 ?? "")
  )
    throw Error("COMPLETE_AUTHENTICATED_CSV_REQUIRED");
  const parents = new Map(),
    nodes = new Map();
  for (const p of snapshot.products) {
    if (
      !validId(p.id) ||
      nodes.has(p.id) ||
      !["simple", "variable"].includes(p.type) ||
      !statuses.has(p.status) ||
      !Array.isArray(p.variations) ||
      !Array.isArray(p.attributes) ||
      typeof p.short_description !== "string" ||
      typeof p.name !== "string"
    )
      throw Error("INVALID_OR_DUPLICATE_PARENT");
    parents.set(p.id, p);
    nodes.set(p.id, { parent_id: p.id, role: "parent", value: p });
    for (const v of p.variations) {
      if (
        !validId(v.id) ||
        nodes.has(v.id) ||
        !statuses.has(v.status) ||
        !Array.isArray(v.attributes)
      )
        throw Error("INVALID_OR_DUPLICATE_VARIATION");
      nodes.set(v.id, { parent_id: p.id, role: "variation", value: v });
    }
  }
  if (snapshot.source_records !== nodes.size)
    throw Error("SOURCE_RECORD_COUNT_MISMATCH");
  return { parents, nodes };
}

function changes(before, after) {
  const result = [];
  for (const [kind, fields] of Object.entries(groups))
    for (const field of fields)
      if (!same(before[field] ?? null, after[field] ?? null))
        result.push({ kind, field });
  for (const field of ["manage_stock", "stock_quantity"])
    if (!same(before[field] ?? null, after[field] ?? null))
      result.push({ kind: "inventory_excluded", field });
  const a = before.source_fields ?? {},
    b = after.source_fields ?? {};
  for (const field of [
    ...new Set([...Object.keys(a), ...Object.keys(b)]),
  ].sort()) {
    if (same(a[field] ?? null, b[field] ?? null)) continue;
    result.push({
      kind: inventoryFields.has(field)
        ? "inventory_excluded"
        : (csvKinds[field] ??
          (/^(Nombre del atributo |Valor\(es\) del atributo )/.test(field)
            ? "taxonomy"
            : "other_source_fields")),
      field: "csv:" + field,
    });
  }
  if (!same(before.source_issues ?? [], after.source_issues ?? []))
    result.push({ kind: "source_issues", field: "source_issues" });
  return result;
}

// Read-only change detector. A change never grants a link, deletion or refresh.
export function wooRefresh(previous, current, sourceRows, snapshot) {
  const old = index(previous),
    next = index(current);
  if (snapshot.inventory_balances !== 0 || snapshot.inventory_movements !== 0)
    throw Error("INVENTORY_MUST_REMAIN_EMPTY");
  const audit = auditStagedCatalog(snapshot, sourceRows);
  if (audit.summary.review_rows) throw Error("STAGED_CATALOG_CHANGED");
  for (const row of snapshot.rows) {
    const p = row.current.woo_product_id,
      v = row.current.woo_variation_id;
    if (p !== null && !old.parents.has(p) && !next.parents.has(p))
      throw Error("STAGED_PARENT_ABSENT_FROM_BOTH_EXPORTS");
    if (
      v !== null &&
      ![old.nodes.get(v), next.nodes.get(v)].some(
        (n) => n?.role === "variation" && n.parent_id === p,
      )
    )
      throw Error("STAGED_VARIATION_NOT_IN_VERIFIED_PARENT");
  }
  const items = [],
    movements = [];
  for (const id of [
    ...new Set([...old.nodes.keys(), ...next.nodes.keys()]),
  ].sort((a, b) => a - b)) {
    const a = old.nodes.get(id),
      b = next.nodes.get(id);
    if (a && b && (a.role !== b.role || a.parent_id !== b.parent_id))
      movements.push({
        id,
        previous_parent_id: a.parent_id,
        current_parent_id: b.parent_id,
        previous_role: a.role,
        current_role: b.role,
        state: "IDENTITY_MOVED_MANUAL_REVIEW",
      });
  }
  const countState = {},
    impact = [];
  for (const id of [
    ...new Set([...old.parents.keys(), ...next.parents.keys()]),
  ].sort((a, b) => a - b)) {
    const a = old.parents.get(id),
      b = next.parents.get(id);
    const details =
      a && b ? changes(a, b).map((x) => ({ ...x, woo_id: id })) : [];
    const variants = [];
    const av = new Map((a?.variations ?? []).map((v) => [v.id, v])),
      bv = new Map((b?.variations ?? []).map((v) => [v.id, v]));
    for (const vid of [...new Set([...av.keys(), ...bv.keys()])].sort(
      (x, y) => x - y,
    )) {
      const x = av.get(vid),
        y = bv.get(vid);
      const delta = x && y ? changes(x, y) : [];
      if (!x || !y || delta.length)
        variants.push({
          id: vid,
          state: !x
            ? "NEW_VARIATION_REVIEW"
            : !y
              ? "ABSENT_VARIATION_NO_DELETE"
              : delta.every((d) => d.kind === "inventory_excluded")
                ? "INVENTORY_ONLY_EXCLUDED"
                : "VARIATION_CHANGED_REVIEW",
          changes: delta,
        });
    }
    const moved = movements.filter(
      (m) => m.previous_parent_id === id || m.current_parent_id === id,
    );
    const kinds = [
      ...new Set([
        ...details.map((d) => d.kind),
        ...variants.flatMap((v) => v.changes.map((d) => d.kind)),
        ...(variants.some((v) =>
          ["NEW_VARIATION_REVIEW", "ABSENT_VARIATION_NO_DELETE"].includes(
            v.state,
          ),
        )
          ? ["structure"]
          : []),
        ...(moved.length ? ["identity_moved"] : []),
      ]),
    ].sort();
    const state = !a
      ? "NEW_PARENT_MANUAL_REVIEW"
      : !b
        ? "ABSENT_PARENT_NO_DELETE"
        : !kinds.length
          ? "UNCHANGED"
          : kinds.every((k) => k === "inventory_excluded")
            ? "INVENTORY_ONLY_EXCLUDED"
            : "SOURCE_CHANGED_MANUAL_REVIEW";
    countState[state] = (countState[state] ?? 0) + 1;
    const managed = snapshot.rows.filter(
      (r) =>
        r.current.woo_product_id === id ||
        moved.some((m) => m.id === r.current.woo_variation_id),
    );
    const item = {
      woo_product_id: id,
      name: b?.name ?? a.name,
      state,
      kinds,
      previous_status: a?.status ?? null,
      current_status: b?.status ?? null,
      parent_changes: details,
      variation_changes: variants,
      identity_movements: moved,
      staged_codes: [...new Set(managed.map((r) => r.current.barcode))].sort(),
      import_allowed: false,
      refresh_allowed: false,
      delete_allowed: false,
      send_allowed: false,
    };
    items.push(item);
    if (
      managed.length &&
      !["UNCHANGED", "INVENTORY_ONLY_EXCLUDED"].includes(state)
    )
      impact.push({
        woo_product_id: id,
        state,
        kinds,
        variants: managed.map((r) => ({
          barcode: r.current.barcode,
          product_id: r.product_id,
          variant_id: r.variant_id,
          woo_variation_id: r.current.woo_variation_id,
          protected_row_sha256: digest({
            current: r.current,
            stored: r.stored,
          }),
        })),
        action: "RECONCILE_SOURCE_AND_REVIEW_DRAFT_BEFORE_REFRESH",
        write_allowed: false,
      });
  }
  return {
    version: "m9-woo-refresh-2",
    purpose: "READ_ONLY_SOURCE_COMPARISON_NOT_IMPORTABLE",
    evidence_sha256: digest({ previous, current, sourceRows, snapshot }),
    summary: {
      previous_parents: old.parents.size,
      current_parents: next.parents.size,
      previous_records: old.nodes.size,
      current_records: next.nodes.size,
      states: countState,
      identity_movements: movements.length,
      staged_parent_impacts: impact.length,
      staged_codes_to_review: new Set(
        impact.flatMap((i) => i.variants.map((v) => v.barcode)),
      ).size,
      approved_refreshes: 0,
      approved_deletions: 0,
    },
    write_allowed: false,
    send_allowed: false,
    inventory_included: false,
    items,
    identity_movements: movements,
    staged_impact: impact,
  };
}

export async function prepareWooRefresh(configPath, output) {
  const config = JSON.parse(await readFile(configPath)),
    inputs = {};
  if (
    !["HISTORICAL_REHEARSAL", "RECEIVED_EXPORT_COMPARISON"].includes(
      config.evidence_scope,
    )
  )
    throw Error("EVIDENCE_SCOPE_REQUIRED");
  for (const name of ["previous", "current", "rows", "snapshot"]) {
    const input = config.inputs?.[name];
    if (!input || !/^[a-f0-9]{64}$/.test(input.sha256))
      throw Error("PINNED_INPUT_REQUIRED");
    const bytes = await readFile(resolve(dirname(configPath), input.path));
    if (sha(bytes) !== input.sha256) throw Error("INPUT_HASH_CHANGED");
    inputs[name] = JSON.parse(bytes);
  }
  const packet = {
    ...wooRefresh(
      inputs.previous,
      inputs.current,
      inputs.rows,
      inputs.snapshot,
    ),
    evidence_scope: config.evidence_scope,
  };
  const files = {
    "comparacion-woo.json": json(packet),
    "resumen.json": json(packet.summary),
    "impacto-staging.json": json(packet.staged_impact),
    "identidades-movidas.json": json(packet.identity_movements),
    "resumen.txt": `${config.evidence_scope}\n${json(packet.summary)}\nNo actualiza fichas, vínculos, precios SICAR ni existencias. Ausencias no autorizan borrados. Contrastar fuente, catálogo y borrador vigente antes de cualquier actualización. Las variaciones nuevas requieren Clave 1 SICAR confirmada.\n`,
  };
  await mkdir(output);
  for (const [name, value] of Object.entries(files))
    await writeFile(resolve(output, name), value, { flag: "wx" });
  await writeFile(
    resolve(output, "sha256.json"),
    json(
      Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha(v)])),
    ),
    { flag: "wx" },
  );
  return packet.summary;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [config, output] = process.argv.slice(2);
  if (!output) throw Error("Usage: PINNED_CONFIG.json NEW_OUTPUT");
  console.log(await prepareWooRefresh(resolve(config), resolve(output)));
}
