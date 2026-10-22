import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { stable } from "./woo-test/plan.mjs";
import { verifyLocalCatalogPhotoBytes } from "./catalogo-fotos-verificar-bytes.mjs";
const sha = (x) => createHash("sha256").update(x).digest("hex");
const must = (ok, why) => {
  if (!ok) throw Error(why);
};
const clean = (x) => {
  const r = { ...x };
  delete r.row_hash;
  return r;
};
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function sourceVariant(v) {
  return {
    id: v.id,
    status: v.status,
    attributes: v.attributes ?? [],
    images: v.images,
  };
}
export function prepareProtectedPhotoRefresh({
  plan,
  families,
  categories,
  woo,
  proofs,
  request_id,
  export_sha256,
}) {
  const { plan_sha256, ...body } = plan;
  must(
    plan.protocol === "m9-photo-gap-refresh-1" &&
      plan.project_id === "zsezjtswqeijboezvado" &&
      sha(stable(body)) === plan_sha256 &&
      plan.inert_batch?.executable === false &&
      plan.inert_batch.items.length === 24 &&
      proofs.protocol === "m9-photo-local-bytes-1" &&
      proofs.plan_sha256 === plan_sha256 &&
      proofs.proofs.length === 7 &&
      woo.pagination_complete === true &&
      families.length === 7 &&
      /^[a-f0-9-]{36}$/.test(request_id) &&
      /^[a-f0-9]{64}$/.test(export_sha256),
    "EXACT_PROTECTED_REFRESH_INPUT_REQUIRED",
  );
  const parents = new Map(woo.products.map((p) => [p.id, p])),
    cat = new Map(categories.map((x) => [x.product_id, x.binding])),
    proof = new Map(proofs.proofs.map((x) => [x.url, x]));
  const packets = families
    .map((f) => {
      const parent = parents.get(f.woo_product_id);
      must(
        parent?.status === "publish" &&
          parent.type === "variable" &&
          f.source.snapshot.source_status === "publish" &&
          f.product.image_path === null &&
          f.draft?.content?.images?.length > 0,
        "PROTECTED_REFRESH_SOURCE_OR_MANUAL_REVIEW",
      );
      const variations = new Map(parent.variations.map((v) => [v.id, v]));
      const evidence = f.evidence.map(clean),
        copies = f.copies.map(clean);
      for (const e of evidence) {
        const observed = variations.get(e.woo_variation_id),
          v = f.catalog.variants.find((v) => v.id === e.variant_id),
          c = copies.find((c) => c.variant_id === e.variant_id);
        must(
          observed?.status === "publish" &&
            stable(sourceVariant(observed)) === stable(e.source_variant) &&
            v?.barcode === e.barcode &&
            v.woo_product_id === e.woo_product_id &&
            v.woo_variation_id === e.woo_variation_id &&
            e.source_fingerprint === f.source_hash &&
            c &&
            f.evidence.find((x) => x.variant_id === e.variant_id).row_hash ===
              c.evidence_hash,
          "PREVIOUS_PHOTO_EVIDENCE_NOT_EXACT",
        );
      }
      const items = plan.inert_batch.items
        .filter((x) => x.product_id === f.product_id)
        .map((x) => {
          const v = variations.get(x.woo_variation_id),
            saved = f.source.snapshot.variants.filter(
              (v) =>
                v.barcode === x.barcode &&
                v.woo_variation_id === x.woo_variation_id,
            );
          const p = proof.get(v?.images);
          must(
            v?.status === "publish" &&
              x.expected.source_hash === f.source_hash &&
              x.expected.catalog_hash === f.catalog_hash &&
              x.expected.draft_hash === f.draft_hash &&
              saved.length === 1 &&
              saved[0].images_woo === "" &&
              stable(saved[0].attributes_woo) === stable(v.attributes ?? []) &&
              v.images === x.new_images &&
              p,
            "NEW_PHOTO_BINDING_OR_BYTES_CHANGED",
          );
          return {
            variant_id: x.variant_id,
            barcode: x.barcode,
            woo_product_id: x.woo_product_id,
            woo_variation_id: x.woo_variation_id,
            source_variant: sourceVariant(v),
            photos: [
              {
                url: p.url,
                sha256: p.sha256,
                bytes: p.bytes,
                mime: p.mime,
                alt: "",
              },
            ],
          };
        })
        .sort((a, b) => compare(a.variant_id, b.variant_id));
      must(items.length > 0, "EMPTY_REFRESH_FAMILY");
      return {
        product_id: f.product_id,
        woo_product_id: f.woo_product_id,
        product_before: f.product,
        catalog_hash: f.catalog_hash,
        source_before: f.source,
        draft_before: f.draft,
        evidence_before: evidence,
        copies_before: copies,
        category_before: cat.get(f.product_id) ?? null,
        woo_variants: parent.variations.map(sourceVariant),
        new_items: items,
      };
    })
    .sort((a, b) => compare(a.product_id, b.product_id));
  must(
    packets.reduce((n, f) => n + f.new_items.length, 0) === 24 &&
      packets.reduce((n, f) => n + f.evidence_before.length, 0) === 25,
    "FIXED_REFRESH_SCOPE_REQUIRED",
  );
  return {
    protocol: "m9-variant-photo-refresh-1",
    request_id,
    export_sha256,
    read_plan_sha256: plan_sha256,
    file_proofs: proofs.proofs.map(({ url, sha256, bytes, mime }) => ({
      url,
      sha256,
      bytes,
      mime,
    })),
    families: packets,
  };
}
export async function writeProtectedPhotoRefresh(configPath, out) {
  const config = JSON.parse(await readFile(configPath, "utf8")),
    data = {};
  for (const name of ["plan", "families", "categories", "woo", "proofs"]) {
    const input = config.inputs[name],
      path = resolve(dirname(configPath), input.path),
      bytes = await readFile(path);
    must(sha(bytes) === input.sha256, "REFRESH_INPUT_SHA_CHANGED");
    data[name] = JSON.parse(bytes);
    if (name === "proofs") await verifyLocalCatalogPhotoBytes(dirname(path));
  }
  const packet = prepareProtectedPhotoRefresh({
    ...data,
    request_id: config.request_id,
    export_sha256: config.inputs.woo.sha256,
  });
  await mkdir(out, { recursive: false, mode: 0o700 });
  const content = JSON.stringify(packet, null, 2) + "\n";
  await writeFile(resolve(out, "payload.json"), content, {
    flag: "wx",
    mode: 0o600,
  });
  const receipt = {
    families: 7,
    new_evidence: 24,
    previous_evidence: 25,
    expected_category_holds: 7,
    byte_files_verified: 7,
    packet_file_sha256: sha(content),
    staging_write_performed: false,
    storage_upload_performed: false,
    woo_write_performed: false,
    application_requires_review: true,
  };
  await writeFile(
    resolve(out, "preparacion.json"),
    JSON.stringify(receipt, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  return receipt;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 4)
    throw Error("USAGE: CONFIG NEW_PRIVATE_OUTPUT_DIR");
  console.log(
    JSON.stringify(
      await writeProtectedPhotoRefresh(
        resolve(process.argv[2]),
        resolve(process.argv[3]),
      ),
    ),
  );
}
