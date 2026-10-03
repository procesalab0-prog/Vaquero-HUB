import { createHash } from "node:crypto";

export const VERSION = "m9-woo-local-worker-1";
export const hash = (value) =>
  createHash("sha256").update(stable(value)).digest("hex");
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function assert(value, message) {
  if (!value) throw new Error(message);
}
const positive = (n) => Number.isSafeInteger(n) && n > 0;
const text = (v, max = 240) =>
  typeof v === "string" && v.length > 0 && v.length <= max && v === v.trim();
const uuid = (s) =>
  typeof s === "string" &&
  /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s);
function keys(o, allowed) {
  assert(
    o &&
      typeof o === "object" &&
      !Array.isArray(o) &&
      Object.keys(o).every((k) => allowed.includes(k)),
    "UNSUPPORTED_FIELD",
  );
}
export function localStore(store) {
  keys(store, ["id", "base_url", "environment"]);
  assert(
    text(store.id) && store.environment === "LOCAL_WOO_TEST",
    "TEST_STORE_REQUIRED",
  );
  const u = new URL(store.base_url);
  assert(
    u.protocol === "http:" &&
      u.hostname === "127.0.0.1" &&
      u.port &&
      u.pathname === "/" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash,
    "LOCAL_ONLY_NO_REMOTE_WOO",
  );
  return u.origin;
}
const escape = (s) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
export const plainHtml = (s) =>
  `<p>${escape(s.replaceAll("\r\n", "\n")).replaceAll("\n", "<br />")}</p>`;
// WordPress turns the generated double break into a paragraph boundary.
// Preserve all text and other markup: this is not an HTML-stripping comparison.
export const comparableWooHtml = (s) =>
  typeof s === "string"
    ? s
        .replaceAll("\r\n", "\n")
        .replaceAll("<br /><br />", "</p>\n<p>")
        .replace(/\n+$/, "")
    : s;
function price(cents) {
  assert(positive(cents), "INVALID_PUBLIC_PRICE");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
function unique(values, message) {
  assert(new Set(values).size === values.length, message);
}

// This input is a test-site binding, never a production Woo ID or a DB approval.
export function compilePlan(input) {
  keys(input, [
    "store",
    "product_id",
    "revision",
    "mode",
    "type",
    "content",
    "bindings",
    "variants",
    "target",
    "descriptive_attributes",
  ]);
  const origin = localStore(input.store);
  assert(
    uuid(input.product_id) && positive(input.revision),
    "INVALID_INTERNAL_ID_OR_REVISION",
  );
  assert(
    ["create", "update"].includes(input.mode) &&
      ["simple", "variable"].includes(input.type),
    "INVALID_MODE_OR_TYPE",
  );
  const { content: c, bindings: b, variants: vs } = input;
  keys(c, [
    "name",
    "base_code",
    "description",
    "short_description",
    "images",
    "categories",
  ]);
  assert(
    text(c.name) &&
      text(c.base_code) &&
      text(c.description, 30000) &&
      text(c.short_description, 10000),
    "INCOMPLETE_EDITORIAL_CONTENT",
  );
  // Current shop convention: short description is precisely the base code.
  assert(c.short_description === c.base_code, "BASE_CODE_REVIEW_REQUIRED");
  keys(b, ["store_id", "categories", "images"]);
  assert(b.store_id === input.store.id, "CROSS_STORE_BINDINGS");
  assert(
    Array.isArray(c.categories) &&
      c.categories.length > 0 &&
      c.categories.length <= 20,
    "CATEGORIES_REQUIRED",
  );
  assert(
    Array.isArray(b.categories) && b.categories.length === c.categories.length,
    "CATEGORY_BINDINGS_REQUIRED",
  );
  b.categories.forEach((v, i) => {
    keys(v, ["id", "path"]);
    assert(
      positive(v.id) && text(v.path) && v.path === c.categories[i],
      "CATEGORY_BINDINGS_CHANGED",
    );
  });
  unique(
    b.categories.map((v) => v.id),
    "DUPLICATE_CATEGORY",
  );
  assert(
    Array.isArray(c.images) &&
      c.images.length > 0 &&
      c.images.length <= 20 &&
      Array.isArray(b.images) &&
      b.images.length === c.images.length,
    "IMAGES_REQUIRED",
  );
  b.images.forEach((v, i) => {
    keys(v, ["id", "url"]);
    keys(c.images[i], ["url", "alt"]);
    assert(
      positive(v.id) &&
        v.url === c.images[i].url &&
        typeof c.images[i].alt === "string" &&
        c.images[i].alt.length <= 240,
      "IMAGE_BINDINGS_CHANGED",
    );
    const u = new URL(v.url);
    assert(
      ["http:", "https:"].includes(u.protocol) && !u.username && !u.password,
      "INVALID_IMAGE_URL",
    );
  });
  unique(
    b.images.map((v) => v.id),
    "DUPLICATE_IMAGE",
  );
  assert(
    Array.isArray(vs) &&
      vs.length > 0 &&
      vs.length <= 100 &&
      (input.type !== "simple" || vs.length === 1),
    "INVALID_VARIANTS",
  );
  for (const v of vs) {
    keys(v, ["id", "sku", "barcode", "price_cents", "attributes"]);
    assert(
      uuid(v.id) && text(v.sku) && text(v.barcode),
      "INVALID_VARIANT_IDENTITY",
    );
    price(v.price_cents);
    assert(Array.isArray(v.attributes), "INVALID_ATTRIBUTES");
    for (const a of v.attributes) {
      keys(a, ["name", "option"]);
      assert(text(a.name) && text(a.option), "INVALID_ATTRIBUTE");
    }
    unique(
      v.attributes.map((a) => a.name),
      "DUPLICATE_ATTRIBUTE",
    );
    assert(
      input.type === "simple"
        ? v.attributes.length === 0
        : v.attributes.length > 0,
      "INVALID_TYPE_ATTRIBUTES",
    );
  }
  for (const field of ["id", "sku", "barcode"])
    unique(
      vs.map((v) => v[field]),
      "DUPLICATE_VARIANT_IDENTITY",
    );
  unique(
    vs.map((v) =>
      stable([...v.attributes].sort((a, b) => a.name.localeCompare(b.name))),
    ),
    "DUPLICATE_VARIANT_ATTRIBUTES",
  );
  const attributeNames = vs[0].attributes.map((a) => a.name).sort();
  assert(
    vs.every(
      (v) =>
        stable(v.attributes.map((a) => a.name).sort()) ===
        stable(attributeNames),
    ),
    "INCONSISTENT_ATTRIBUTE_AXES",
  );
  const descriptive = (input.descriptive_attributes ?? []).map((a) => {
    keys(a, ["name", "options"]);
    assert(
      text(a.name) &&
        !attributeNames.includes(a.name) &&
        Array.isArray(a.options) &&
        a.options.length > 0 &&
        a.options.length <= 100 &&
        a.options.every((o) => text(o)),
      "INVALID_DESCRIPTIVE_ATTRIBUTE",
    );
    unique(a.options, "DUPLICATE_DESCRIPTIVE_OPTION");
    return {
      name: a.name,
      visible: true,
      variation: false,
      options: a.options,
    };
  });
  assert(descriptive.length <= 20, "INVALID_DESCRIPTIVE_ATTRIBUTE");
  unique(
    descriptive.map((a) => a.name),
    "DUPLICATE_DESCRIPTIVE_ATTRIBUTE",
  );
  const editorial = {
    name: c.name,
    description: plainHtml(c.description),
    short_description: plainHtml(c.short_description),
    categories: b.categories.map(({ id }) => ({ id })),
    // Existing attachments only: no HTTP image fetch or re-upload during retry.
    images: b.images.map(({ id }, i) => ({ id, alt: c.images[i].alt })),
  };
  const steps = [];
  const marker = (key) => [
    {
      key: "_mi_tienda_test_operation",
      value: hash([
        VERSION,
        input.store.id,
        input.product_id,
        input.revision,
        key,
      ]),
    },
  ];
  const identity = (v) => [
    { key: "_mi_tienda_variant_id", value: v.id },
    { key: "_mi_tienda_barcode", value: v.barcode },
  ];
  if (input.mode === "create") {
    assert(input.target === undefined, "CREATE_CANNOT_HAVE_WOO_TARGET");
    const payload = {
      ...editorial,
      type: input.type,
      status: "draft",
      meta_data: marker("parent"),
    };
    if (input.type === "simple")
      Object.assign(payload, {
        sku: vs[0].sku,
        regular_price: price(vs[0].price_cents),
        meta_data: [...payload.meta_data, ...identity(vs[0])],
      });
    else
      payload.attributes = attributeNames.map((name) => ({
        name,
        visible: true,
        variation: true,
        options: [
          ...new Set(
            vs.map((v) => v.attributes.find((a) => a.name === name).option),
          ),
        ],
      }));
    if (descriptive.length)
      payload.attributes = [...(payload.attributes ?? []), ...descriptive];
    steps.push({ key: "parent", method: "POST", path: "products", payload });
    if (input.type === "variable")
      for (const v of vs)
        steps.push({
          key: v.id,
          method: "POST",
          parent_ref: "parent",
          path: "variations",
          payload: {
            sku: v.sku,
            regular_price: price(v.price_cents),
            attributes: v.attributes,
            meta_data: [...marker(v.id), ...identity(v)],
          },
        });
  } else {
    const t = input.target;
    keys(t, ["store_id", "product_id", "snapshot", "variants"]);
    assert(
      t.store_id === input.store.id && positive(t.product_id),
      "CROSS_STORE_TARGET",
    );
    assert(
      t.snapshot?.id === t.product_id &&
        t.snapshot.type === input.type &&
        t.snapshot.status === "draft",
      "ONLY_TEST_DRAFT_UPDATES",
    );
    assert(
      Array.isArray(t.variants) && t.variants.length === vs.length,
      "EXPLICIT_VARIANT_BINDINGS_REQUIRED",
    );
    unique(
      t.variants.map((v) => v.id),
      "DUPLICATE_TARGET_VARIANT",
    );
    unique(
      t.variants.map((v) => v.variant_id),
      "DUPLICATE_TARGET_VARIANT",
    );
    if (input.descriptive_attributes !== undefined)
      editorial.attributes = [
        ...(t.snapshot.attributes ?? [])
          .filter((a) => a.variation)
          .map(({ name, visible, variation, options }) => ({
            name,
            visible,
            variation,
            options,
          })),
        ...descriptive,
      ];
    const changedEditorial = Object.fromEntries(
      Object.entries(editorial).filter(([key, value]) => {
        let current = t.snapshot[key];
        if (["description", "short_description"].includes(key))
          return comparableWooHtml(value) !== comparableWooHtml(current);
        if (key === "images")
          current = current?.map(({ id, alt }) => ({ id, alt }));
        if (key === "categories") current = current?.map(({ id }) => ({ id }));
        if (key === "attributes")
          current = current?.map(({ name, visible, variation, options }) => ({
            name,
            visible,
            variation,
            options,
          }));
        return hash(value) !== hash(current ?? null);
      }),
    );
    steps.push({
      key: "parent",
      method: "PUT",
      path: `products/${t.product_id}`,
      expected: t.snapshot,
      payload: {
        ...changedEditorial,
        ...(input.type === "simple"
          ? { regular_price: price(vs[0].price_cents) }
          : {}),
        meta_data: marker("parent"),
      },
    });
    for (const v of vs) {
      const target = t.variants.find((x) => x.variant_id === v.id);
      keys(target, ["variant_id", "id", "snapshot"]);
      assert(
        positive(target.id) && target.snapshot?.id === target.id,
        "INVALID_TARGET_VARIANT",
      );
      const s = target.snapshot;
      assert(
        s.sku === v.sku &&
          s.meta_data?.some(
            (m) => m.key === "_mi_tienda_barcode" && m.value === v.barcode,
          ) &&
          s.meta_data?.some(
            (m) => m.key === "_mi_tienda_variant_id" && m.value === v.id,
          ),
        "TARGET_IDENTITY_CHANGED",
      );
      if (input.type === "simple")
        assert(
          target.id === t.product_id && hash(s) === hash(t.snapshot),
          "SIMPLE_TARGET_CHANGED",
        );
      else {
        assert(
          t.snapshot.variations?.includes(target.id) &&
            hash(
              s.attributes
                .map(({ name, option }) => ({ name, option }))
                .sort((a, b) => a.name.localeCompare(b.name)),
            ) ===
              hash(
                [...v.attributes].sort((a, b) => a.name.localeCompare(b.name)),
              ),
          "VARIANT_ATTRIBUTES_CHANGED",
        );
        steps.push({
          key: v.id,
          method: "PUT",
          path: `products/${t.product_id}/variations/${target.id}`,
          expected: s,
          payload: {
            regular_price: price(v.price_cents),
            meta_data: marker(v.id),
          },
        });
      }
    }
  }
  return {
    version: VERSION,
    store: { ...input.store, base_url: origin },
    product_id: input.product_id,
    revision: input.revision,
    mode: input.mode,
    steps,
    barcodes: vs.map(({ id, barcode }) => ({ id, barcode })),
  };
}
