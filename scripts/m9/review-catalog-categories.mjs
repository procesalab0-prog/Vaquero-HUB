import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { categoryPaths } from "./review-web-families.mjs";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => JSON.stringify(value, null, 2) + "\n";

// Parse against the complete known paths. A comma inside a category name must
// not silently become two categories. Multiple exact interpretations stay held.
export function parseCategoryPaths(source, categories) {
  if (typeof source !== "string" || !source || source.includes("\\"))
    return {
      state: "MANUAL_REVIEW",
      reasons: ["EMPTY_OR_ESCAPED_SOURCE"],
      mappings: [],
    };
  const paths = categoryPaths(categories).flatMap((p) =>
      [...new Set([p.path, p.path.replaceAll("&amp;", "&")])].map(
        (match_path) => ({ ...p, match_path }),
      ),
    ),
    solutions = new Map();
  let visits = 0,
    limit = false,
    repeated = false;
  function walk(offset, selected) {
    if (++visits > 10000) {
      limit = true;
      return;
    }
    if (solutions.size > 1 || limit) return;
    if (offset === source.length) {
      const ids = selected.map((p) => p.id).sort((a, b) => a - b);
      solutions.set(JSON.stringify(ids), selected);
      return;
    }
    for (const p of paths) {
      if (!source.startsWith(p.match_path, offset)) continue;
      const end = offset + p.match_path.length;
      if (end !== source.length && !source.startsWith(", ", end)) continue;
      if (selected.some((s) => s.id === p.id)) {
        repeated = true;
        continue;
      }
      walk(end === source.length ? end : end + 2, [...selected, p]);
    }
  }
  walk(0, []);
  const reasons = [];
  if (limit) reasons.push("PARSE_LIMIT_REVIEW");
  if (solutions.size > 1) reasons.push("AMBIGUOUS_CATEGORY_PATHS");
  if (!solutions.size)
    reasons.push(repeated ? "REPEATED_CATEGORY_ID" : "NO_EXACT_PATH_PARSE");
  return {
    state: reasons.length ? "MANUAL_REVIEW" : "UNIQUE_PATH_PROPOSAL",
    reasons,
    representation_alias_used:
      !reasons.length &&
      [...solutions.values()][0].some((p) => p.path !== p.match_path),
    mappings: reasons.length
      ? []
      : [...solutions.values()][0]
          .map(({ id, path }) => ({ id, path }))
          .sort((a, b) => a.id - b.id),
  };
}

export function reviewCatalogCategories(snapshot, woo, taxonomy) {
  if (
    snapshot.project_id !== "zsezjtswqeijboezvado" ||
    taxonomy.pagination_complete !== true ||
    taxonomy.total !== taxonomy.categories?.length ||
    !Array.isArray(woo.products)
  )
    throw Error("VERIFIED_INPUT_REQUIRED");
  categoryPaths(taxonomy.categories);
  const parents = new Map();
  for (const p of woo.products) {
    if (!Number.isSafeInteger(p.id) || p.id < 1 || parents.has(p.id))
      throw Error("DUPLICATE_OR_INVALID_WOO_PARENT");
    parents.set(p.id, p);
  }
  const groups = new Map();
  for (const row of snapshot.rows) {
    const id = row.current.woo_product_id;
    if (!parents.has(id)) throw Error("WOO_SOURCE_ID_MISSING");
    const prior = groups.get(id);
    if (prior && prior.product_id !== row.product_id)
      throw Error("WOO_PARENT_MULTIPLE_DESTINATIONS");
    groups.set(id, {
      product_id: row.product_id,
      codes: [...(prior?.codes ?? []), row.current.barcode],
    });
  }
  const publicProducts = new Map();
  for (const p of taxonomy.products) {
    if (publicProducts.has(p.id) || (p.status === 200 && p.data?.id !== p.id))
      throw Error("PUBLIC_PRODUCT_IDENTITY_REVIEW");
    publicProducts.set(p.id, p);
  }
  const items = [...groups]
    .sort(([a], [b]) => a - b)
    .map(([id, group]) => {
      const p = parents.get(id),
        parsed = parseCategoryPaths(p.categories, taxonomy.categories);
      const live = publicProducts.get(id),
        ids = parsed.mappings.map((m) => m.id),
        observed =
          live?.status === 200 && Array.isArray(live.data.categories)
            ? live.data.categories.map((c) => c.id).sort((a, b) => a - b)
            : null;
      const historicalMatch =
        parsed.state === "UNIQUE_PATH_PROPOSAL" &&
        observed !== null &&
        new Set(observed).size === observed.length &&
        JSON.stringify(ids) === JSON.stringify(observed);
      return {
        woo_product_id: id,
        product_id: group.product_id,
        name: p.name,
        source_status: p.status,
        source_categories: p.categories,
        codes: group.codes.sort(),
        ...parsed,
        historical_membership: historicalMatch
          ? "MATCH_AT_CAPTURE"
          : observed === null
            ? "NOT_CAPTURED_OR_NOT_PUBLIC"
            : "DIFFERS_OR_AMBIGUOUS",
        historical_membership_ids: observed,
        requires_fresh_public_membership: true,
        send_allowed: false,
      };
    });
  const ids = items.map((p) => p.woo_product_id),
    requests = [];
  for (let i = 0; i < ids.length; i += 100)
    requests.push({
      method: "GET",
      url: `https://vaquerosm.com/wp-json/wc/store/v1/products?include=${ids.slice(i, i + 100).join(",")}&per_page=100&catalog_visibility=any&_fields=id,categories`,
      woo_ids: ids.slice(i, i + 100),
    });
  return {
    version: "m9-catalog-category-review-1",
    mode: "OFFLINE_READ_ONLY",
    taxonomy_captured_at: taxonomy.captured_at,
    write_allowed: false,
    woo_writes: false,
    summary: {
      products: items.length,
      unique_path_proposals: items.filter(
        (p) => p.state === "UNIQUE_PATH_PROPOSAL",
      ).length,
      manual_path_review: items.filter((p) => p.state === "MANUAL_REVIEW")
        .length,
      historical_membership_matches: items.filter(
        (p) => p.historical_membership === "MATCH_AT_CAPTURE",
      ).length,
      verified_current_memberships: 0,
      approved_for_send: 0,
    },
    items,
    public_request_proposal: {
      destination: "https://vaquerosm.com",
      methods: ["GET"],
      transmitted_fields: [
        "Woo product IDs already present in this site's export",
      ],
      excluded_fields: [
        "SICAR barcodes",
        "prices",
        "inventory",
        "internal product UUIDs",
        "credentials",
      ],
      requests,
      requires_authorization: true,
    },
  };
}
async function main() {
  const [snapshotPath, wooPath, reportDir, taxonomyPath, out] =
    process.argv.slice(2);
  if (!out)
    throw Error(
      "Usage: STAGING.json WOO.json VERIFIED_REPORT TAXONOMY.json NEW_OUTPUT",
    );
  const sb = await fs.readFile(snapshotPath),
    wb = await fs.readFile(wooPath),
    tb = await fs.readFile(taxonomyPath);
  const rh = JSON.parse(await fs.readFile(resolve(reportDir, "sha256.json"))),
    mb = await fs.readFile(resolve(reportDir, "manifest.json"));
  if (sha(mb) !== rh["manifest.json"] || sha(wb) !== JSON.parse(mb).woo_sha256)
    throw Error("SOURCE_CHANGED");
  const th = JSON.parse(
    await fs.readFile(resolve(dirname(taxonomyPath), "sha256.json")),
  );
  if (sha(tb) !== th["taxonomy.json"]) throw Error("TAXONOMY_CHANGED");
  const result = reviewCatalogCategories(
    JSON.parse(sb),
    JSON.parse(wb),
    JSON.parse(tb),
  );
  result.sources = {
    snapshot_sha256: sha(sb),
    woo_sha256: sha(wb),
    taxonomy_sha256: sha(tb),
  };
  const files = {
    "revision.json": json(result),
    "resumen.json": json(result.summary),
    "consultas-publicas-propuestas.json": json(result.public_request_proposal),
  };
  await fs.mkdir(out);
  for (const [name, value] of Object.entries(files))
    await fs.writeFile(resolve(out, name), value, { flag: "wx" });
  await fs.writeFile(
    resolve(out, "sha256.json"),
    json(
      Object.fromEntries(
        Object.entries(files).map(([name, value]) => [name, sha(value)]),
      ),
    ),
    { flag: "wx" },
  );
  console.log(result.summary);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
