import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { stable } from "./woo-test/plan.mjs";

const digest = (v) => createHash("sha256").update(stable(v)).digest("hex");
const sha = (v) => createHash("sha256").update(v).digest("hex");
const unique = (v) => [...new Set(v)].sort();
const same = (a, b) => stable(a) === stable(b);
const urls = (v) =>
  typeof v === "string"
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
const hold = "FAMILIA_CON_SECCIONES_DISTINTAS";
const flags = {
  import_allowed: false,
  refresh_allowed: false,
  delete_allowed: false,
  send_allowed: false,
};

// Diagnostic only. Neither canonical rows, exclusions, drafts nor guards are changed.
export function reviewSourceSections({
  comparison,
  woo,
  rows,
  exclusions,
  context,
  snapshot,
}) {
  if (
    context.project_id !== "zsezjtswqeijboezvado" ||
    snapshot.project_id !== context.project_id ||
    context.inventory_balances !== 0 ||
    context.inventory_movements !== 0 ||
    snapshot.inventory_balances !== 0 ||
    snapshot.inventory_movements !== 0 ||
    context.rows !== snapshot.rows.length
  )
    throw Error("INVALID_STAGING_CONTEXT");
  if (
    woo.pagination_complete !== true ||
    woo.expected_parents_from_panel !== woo.products?.length ||
    comparison.version !== "m9-woo-refresh-2" ||
    comparison.summary.identity_movements !== 0
  )
    throw Error("COMPLETE_CURRENT_WOO_COMPARISON_REQUIRED");
  const parents = new Map(),
    source = new Map(),
    staged = new Set(),
    destination = new Map(),
    holds = new Map();
  for (const p of woo.products) {
    if (parents.has(p.id)) throw Error("DUPLICATE_PARENT");
    parents.set(p.id, p);
  }
  for (const r of rows) {
    if (
      !r.barcode ||
      source.has(r.barcode) ||
      r.barcode !== r.fields?.["clave1 *"] ||
      r.description !== r.fields?.["descripción *"]
    )
      throw Error("INVALID_SOURCE_ROW");
    source.set(r.barcode, r);
  }
  for (const r of snapshot.rows) {
    if (staged.has(r.current.barcode) || !source.has(r.current.barcode))
      throw Error("INVALID_STAGED_CODE");
    staged.add(r.current.barcode);
  }
  for (const p of context.products) {
    if (
      destination.has(p.woo_id) ||
      (p.source &&
        (p.source.product_id !== p.product_id ||
          p.source.snapshot.woo_product_id !== p.woo_id)) ||
      (p.draft && p.draft.product_id !== p.product_id)
    )
      throw Error("INVALID_DESTINATION_LINK");
    destination.set(p.woo_id, p);
  }
  for (const e of exclusions) {
    if (holds.has(e.barcode) || !source.has(e.barcode) || staged.has(e.barcode))
      throw Error("STALE_EXCLUSIONS");
    holds.set(e.barcode, e);
  }
  const changed = comparison.items.filter(
    (p) => p.state === "SOURCE_CHANGED_MANUAL_REVIEW",
  );
  if (
    changed.length !== comparison.summary.states.SOURCE_CHANGED_MANUAL_REVIEW ||
    new Set(changed.map((p) => p.woo_product_id)).size !== changed.length
  )
    throw Error("INVALID_COMPARISON_COUNTS");
  const editorial = changed.map((item) => {
    const p = parents.get(item.woo_product_id),
      d = destination.get(item.woo_product_id),
      s = d?.source?.snapshot;
    if (!p) throw Error("CURRENT_PARENT_MISSING");
    const fields = s
      ? [
          ["name", s.name, p.name],
          ["type", s.type, p.type],
          ["source_status", s.source_status, p.status],
          ["description_html", s.description_html, p.description],
          [
            "short_description_html",
            s.short_description_html,
            p.short_description,
          ],
          ["image_urls", s.image_urls, urls(p.images)],
          ["categories_source", s.categories_source, p.categories],
          [
            "parent_attributes_source",
            s.parent_attributes_source,
            p.attributes,
          ],
        ]
      : [];
    const differences = fields
      .filter(([, a, b]) => !same(a, b))
      .map(([field, before, after]) => ({ field, before, after }));
    const tasks = [];
    if (item.kinds.includes("taxonomy"))
      tasks.push("VERIFY_WOO_CATEGORY_MEMBERSHIP_KEEP_SICAR_CLASSIFICATION");
    if (item.kinds.includes("commercial"))
      tasks.push("KEEP_SICAR_PRICE1_REVIEW_WOO_PROMOTIONS_SEPARATELY");
    if (item.kinds.includes("status"))
      tasks.push("KEEP_SICAR_CATALOG_NO_AUTOMATIC_UNPUBLISH");
    if (
      item.parent_changes.some(
        (c) => c.field === "images" || c.field === "csv:Imágenes",
      )
    )
      tasks.push("REVIEW_PARENT_GALLERY_AGAINST_SAVED_DRAFT");
    if (
      item.variation_changes.some((v) =>
        v.changes?.some(
          (c) => c.field === "images" || c.field === "csv:Imágenes",
        ),
      )
    )
      tasks.push("REVIEW_VARIATION_PHOTOS_SEPARATELY_FROM_PARENT_GALLERY");
    if (item.variation_changes.some((v) => /ABSENT/.test(v.state)))
      tasks.push("ABSENT_VARIATIONS_KEEP_NO_DELETE");
    if (item.kinds.includes("other_source_fields"))
      tasks.push("REVIEW_OTHER_CSV_FIELDS_NO_AUTOMATIC_MAPPING");
    const variants =
      s?.variants?.map((v) => {
        const current =
          p.type === "simple"
            ? p
            : p.variations.find((x) => x.id === v.woo_variation_id);
        return {
          barcode: v.barcode,
          woo_variation_id: v.woo_variation_id,
          state: current ? "PRESENT" : "ABSENT_KEEP",
          ...flags,
          changes: current
            ? [
                ["attributes_woo", v.attributes_woo, current.attributes],
                ["images_woo", v.images_woo, current.images],
                ["regular_price_woo", v.regular_price_woo, current.price ?? ""],
                ["sale_price_woo", v.sale_price_woo, current.sale_price ?? ""],
                [
                  "promotion_start",
                  v.promotion_start,
                  current.source_fields?.[
                    "Día en que empieza el precio rebajado"
                  ] ?? "",
                ],
                [
                  "promotion_end",
                  v.promotion_end,
                  current.source_fields?.[
                    "Día en que termina el precio rebajado"
                  ] ?? "",
                ],
              ]
                .filter(([, a, b]) => !same(a, b))
                .map(([field, before, after]) => ({ field, before, after }))
            : [],
        };
      }) ?? [];
    const state = !s
      ? "NOT_STAGED_NO_REFRESH"
      : differences.length ||
          variants.some((v) => v.state !== "PRESENT" || v.changes.length)
        ? "SAVED_SOURCE_REVIEW_REQUIRED"
        : "SAVED_SOURCE_ALREADY_CURRENT";
    return {
      woo_product_id: p.id,
      name: p.name,
      state,
      kinds: item.kinds.filter((k) => k !== "inventory_excluded"),
      tasks,
      product_id: d?.product_id ?? null,
      draft_revision: d?.draft?.revision ?? null,
      source_fingerprint: s ? digest(d.source) : null,
      draft_fingerprint: d?.draft ? digest(d.draft) : null,
      current_parent_fingerprint: digest(
        Object.fromEntries(fields.map(([k, , v]) => [k, v])),
      ),
      staged_codes: snapshot.rows
        .filter((r) => r.current.woo_product_id === p.id)
        .map((r) => r.current.barcode)
        .sort(),
      parent_differences: differences,
      gallery_review: differences.some((v) => v.field === "image_urls")
        ? {
            previous_urls: s.image_urls,
            current_urls: urls(p.images),
            added_urls: urls(p.images).filter((u) => !s.image_urls.includes(u)),
            removed_urls: s.image_urls.filter(
              (u) => !urls(p.images).includes(u),
            ),
            draft_image_count: d.draft?.content?.images?.length ?? null,
            locally_edited_text_fields:
              d.source.suggested_content && d.draft
                ? [
                    "name",
                    "base_code",
                    "description",
                    "short_description",
                    "categories",
                  ].filter(
                    (key) =>
                      !same(
                        d.source.suggested_content[key],
                        d.draft.content[key],
                      ),
                  )
                : null,
            required_before_refresh: [
              "VERIFY_SOURCE_AND_DRAFT_FINGERPRINTS_AGAIN",
              "VERIFY_OLD_AND_NEW_IMAGE_BYTES_AND_ORDER",
              "PRESERVE_LOCAL_TEXT_ALT_AND_GALLERY_EDITS",
              "REVIEW_REMOVALS_AND_VARIATION_PHOTOS_SEPARATELY",
              "GUARDED_STAGING_TRIAL_AND_IDEMPOTENT_REPEAT",
            ],
            ...flags,
          }
        : null,
      saved_variants: variants,
      variation_changes: item.variation_changes
        .map((v) => ({
          id: v.id,
          state: v.state,
          changes:
            v.changes?.filter((c) => c.kind !== "inventory_excluded") ?? [],
        }))
        .filter((v) => v.changes.length || /ABSENT/.test(v.state)),
      ...flags,
    };
  });
  const ids = unique(
    exclusions
      .filter((e) => e.reasons.includes(hold))
      .flatMap((e) => source.get(e.barcode).candidate_product_ids ?? []),
  )
    .map(Number)
    .sort((a, b) => a - b);
  const sections = ids.map((id) => {
    const assigned = rows.filter((r) => r.product_id === id),
      broad = rows.filter((r) => (r.candidate_product_ids ?? []).includes(id));
    const affected = exclusions.filter(
      (e) =>
        e.reasons.includes(hold) &&
        (source.get(e.barcode).candidate_product_ids ?? []).includes(id),
    );
    const firmSections = unique(assigned.map((r) => r.fields.categoria));
    const sole = affected.filter(
      (e) =>
        e.reasons.length === 1 &&
        source.get(e.barcode).product_id === id &&
        source.get(e.barcode).candidate_product_ids?.length === 1,
    );
    const state =
      firmSections.length === 1 && firmSections[0] && sole.length
        ? "CANDIDATE_SCOPE_REVIEW"
        : firmSections.length > 1
          ? "OWNER_SECTION_REVIEW"
          : "IDENTITY_OR_OTHER_GUARD_REVIEW";
    const member = (r) => ({
      barcode: r.barcode,
      description: r.description,
      department: r.fields.departamento,
      section: r.fields.categoria,
      classification: r.classification,
      product_id: r.product_id,
      variation_id: r.variation_id,
      candidate_product_ids: r.candidate_product_ids,
      staged: staged.has(r.barcode),
    });
    return {
      woo_product_id: id,
      name: parents.get(id)?.name ?? null,
      state,
      firm_sections: firmSections,
      broad_sections: unique(broad.map((r) => r.fields.categoria)),
      held_codes: affected.map((e) => e.barcode).sort(),
      sole_hold_codes: sole.map((e) => e.barcode).sort(),
      assigned_rows: assigned.map(member),
      unassigned_candidate_rows: broad
        .filter((r) => r.product_id !== id)
        .map(member),
      evidence_sha256: digest({ assigned, broad, affected }),
      ...flags,
    };
  });
  const summary = {
    mode: "READ_ONLY_TECHNICAL_REVIEW",
    source_rows: rows.length,
    staged_rows: staged.size,
    pending_rows: rows.length - staged.size,
    woo_changed_parents: editorial.length,
    source_states: Object.fromEntries(
      unique(editorial.map((x) => x.state)).map((k) => [
        k,
        editorial.filter((x) => x.state === k).length,
      ]),
    ),
    section_parents: sections.length,
    section_held_rows: new Set(sections.flatMap((s) => s.held_codes)).size,
    scope_review_parents: sections.filter(
      (s) => s.state === "CANDIDATE_SCOPE_REVIEW",
    ).length,
    scope_review_codes: unique(
      sections
        .filter((s) => s.state === "CANDIDATE_SCOPE_REVIEW")
        .flatMap((s) => s.sole_hold_codes),
    ).length,
    owner_section_parents: sections.filter(
      (s) => s.state === "OWNER_SECTION_REVIEW",
    ).length,
    other_guard_parents: sections.filter(
      (s) => s.state === "IDENTITY_OR_OTHER_GUARD_REVIEW",
    ).length,
    database_writes: 0,
    inventory_included: false,
    ...flags,
  };
  return { summary, editorial, sections };
}

export async function prepareSourceSectionReview(configPath, out) {
  const config = JSON.parse(await readFile(configPath, "utf8")),
    inputs = {},
    evidence = {};
  for (const key of [
    "comparison",
    "woo",
    "rows",
    "exclusions",
    "context",
    "snapshot",
  ]) {
    const item = config.inputs?.[key];
    if (!item || !/^[a-f0-9]{64}$/.test(item.sha256))
      throw Error("INPUT_HASH_REQUIRED");
    const raw = await readFile(resolve(dirname(configPath), item.path));
    if (sha(raw) !== item.sha256) throw Error("INPUT_CHANGED:" + key);
    inputs[key] = JSON.parse(raw);
    evidence[key] = item.sha256;
  }
  const result = reviewSourceSections(inputs),
    files = {
      "resumen.json": result.summary,
      "cambios-woo.json": result.editorial,
      "secciones.json": result.sections,
      "manifest.json": {
        version: "m9-source-section-review-1",
        inputs: evidence,
        ...flags,
      },
    };
  await mkdir(out, { mode: 0o700 });
  const hashes = {};
  for (const [name, value] of Object.entries(files)) {
    const raw = JSON.stringify(value, null, 2) + "\n";
    hashes[name] = sha(raw);
    await writeFile(resolve(out, name), raw, { flag: "wx", mode: 0o600 });
  }
  await writeFile(
    resolve(out, "sha256.json"),
    JSON.stringify(hashes, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  return result.summary;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  prepareSourceSectionReview(resolve(process.argv[2]), resolve(process.argv[3]))
    .then((x) => console.log(JSON.stringify(x)))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
