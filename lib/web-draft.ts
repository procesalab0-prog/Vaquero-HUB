export const WEB_STAGING_URL = "https://zsezjtswqeijboezvado.supabase.co";
export type WebImage = { url: string; alt: string };
export type WebContent = {
  name: string;
  base_code: string;
  description: string;
  short_description: string;
  images: WebImage[];
  categories: string[];
};
export type WebDraft = {
  catalog: {
    product_id: string;
    name: string;
    image_path: string | null;
    active: boolean;
    variants: Array<{
      id: string;
      sku: string;
      barcode: string;
      price_cents: number;
      active: boolean;
      woo_product_id: number | null;
      woo_variation_id: number | null;
      department: string | null;
      section: string | null;
      attributes: Record<string, string>;
    }>;
  };
  fingerprint: string;
  revision: number;
  can_edit: boolean;
  saved: boolean;
  content: WebContent;
  updated_at: string | null;
  source: null | {
    sha256: string;
    woo_product_id: number;
    source_status: string;
    unselected_woo_variation_ids: number[];
    variants: Array<{
      barcode: string;
      sale_price_woo: string;
      promotion_start: string;
      promotion_end: string;
    }>;
  };
};
// Informational only: keep the original export immutable. Server-side send
// eligibility still requires its own verified family evidence.
export function remainingSourceVariants(
  draft: Pick<WebDraft, "catalog" | "source">,
) {
  if (!draft.source) return [];
  const linked = new Set(
    draft.catalog.variants
      .filter(
        (v) => v.active && v.woo_product_id === draft.source!.woo_product_id,
      )
      .map((v) => v.woo_variation_id),
  );
  return draft.source.unselected_woo_variation_ids.filter(
    (id) => !linked.has(id),
  );
}
export function validWebImage(url: string) {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      ((u.hostname === "vaquerosm.com" &&
        u.pathname.startsWith("/wp-content/uploads/")) ||
        (u.hostname === "zsezjtswqeijboezvado.supabase.co" &&
          u.pathname.startsWith(
            "/storage/v1/object/public/product-images/",
          ))) &&
      /^[A-Za-z0-9%._~!$&'()*+,;=:@/?#-]+$/.test(url.slice(8)) &&
      url.length <= 2000
    );
  } catch {
    return false;
  }
}
export function webContentFromForm(
  form: FormData,
  fallbackName = "",
): WebContent {
  const field = (key: string) => String(form.get(`web_${key}`) ?? "");
  const content: WebContent = {
    name: field("name").trim() || fallbackName,
    base_code: field("base_code"),
    description: field("description"),
    short_description: field("short_description"),
    images: field("images")
      .split(/\r?\n/)
      .filter((v) => v.trim())
      .map((line) => {
        const [url, ...alt] = line.split(" | ");
        return { url: url.trim(), alt: alt.join(" | ").trim() };
      }),
    categories: field("categories")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
  };
  if (
    !content.name ||
    content.name.length > 240 ||
    content.base_code.length > 160 ||
    content.description.length > 30000 ||
    content.short_description.length > 4000 ||
    content.images.length > 20 ||
    content.categories.length > 20 ||
    content.images.some((i) => !validWebImage(i.url) || i.alt.length > 240) ||
    new Set(content.images.map((i) => i.url)).size !== content.images.length ||
    content.categories.some((c) => c.length > 240)
  )
    throw new Error("INVALID_WEB_CONTENT");
  return content;
}
export function webDraftIssues(content: WebContent, partial = false) {
  const issues: string[] = [];
  if (!content.base_code.trim())
    issues.push("Falta el código base del modelo.");
  if (!content.description.trim())
    issues.push("Falta la descripción completa.");
  if (!content.short_description.trim())
    issues.push("Falta la descripción corta.");
  if (!content.images.length) issues.push("Falta al menos una fotografía.");
  issues.push(
    content.categories.length
      ? "Las categorías web propuestas requieren correspondencia con WooCommerce."
      : "Faltan las categorías web propuestas.",
  );
  if (partial)
    issues.push(
      "Esta familia tiene otras variantes en WooCommerce fuera del piloto; deben conservarse.",
    );
  return issues;
}

export type SaveWebState = {
  ok: boolean;
  message: string;
  revision?: number;
  conflict?: boolean;
};

export type WebLabState = {
  enabled: boolean;
  supervised: true;
  last_verified_revision?: number | null;
  last_verified_variants?: Array<{
    variant_id: string;
    local_variation_id: number;
  }>;
  local_product_id?: number | null;
  production_enabled: false;
  job: null | {
    id: string;
    state: "READY" | "RUNNING" | "SUCCEEDED" | "REVIEW_REQUIRED" | "SUPERSEDED";
    revision: number;
    local_product_id: number | null;
  };
};
export type WebLabResult = { lab?: WebLabState; error?: string };
