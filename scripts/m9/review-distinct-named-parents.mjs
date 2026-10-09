// Names are editorial text. This proves distinct Woo identities without
// merging parents, approving SICAR-only families, or enabling publication.
const nameKey = (s) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
const literalBase = (s) => {
  if (typeof s !== "string") return null;
  const code = s.normalize("NFC").trim().toUpperCase();
  return /^[\p{L}0-9][\p{L}0-9._/&-]{0,119}$/u.test(code) ? code : null;
};
export function reviewDistinctNamedParents(woo) {
  if (!Array.isArray(woo.products)) throw Error("WOO_PRODUCTS_REQUIRED");
  const ids = new Set(),
    names = new Map(),
    bases = new Map();
  for (const p of woo.products) {
    if (
      !Number.isSafeInteger(p.id) ||
      p.id <= 0 ||
      ids.has(p.id) ||
      typeof p.name !== "string"
    )
      throw Error("INVALID_OR_DUPLICATE_WOO_PARENT");
    ids.add(p.id);
    const name = nameKey(p.name),
      base = literalBase(p.short_description);
    names.set(name, [...(names.get(name) ?? []), p]);
    if (base) bases.set(base, [...(bases.get(base) ?? []), p.id]);
  }
  return woo.products
    .map((p) => {
      const peers = names.get(nameKey(p.name)),
        reasons = [];
      if (peers.length < 2)
        return {
          woo_product_id: p.id,
          state: "UNIQUE_NAME",
          peers: [],
          reasons: [],
          write_allowed: false,
        };
      const codes = peers.map((x) => literalBase(x.short_description));
      if (codes.some((x) => !x)) reasons.push("BASE_NOT_LITERAL_OR_EMPTY");
      if (new Set(codes).size !== codes.length)
        reasons.push("SAME_BASE_REQUIRES_MANUAL_REVIEW");
      if (codes.some((c) => c && bases.get(c).length !== 1))
        reasons.push("BASE_REUSED_IN_WOO");
      if (
        codes.some(
          (c, i) =>
            c &&
            codes.some(
              (d, j) =>
                i !== j && d && d !== c && (c.startsWith(d) || d.startsWith(c)),
            ),
        )
      )
        reasons.push("OVERLAPPING_BASES_REVIEW");
      return {
        woo_product_id: p.id,
        state: reasons.length ? "MANUAL_REVIEW" : "DISTINCT_LITERAL_BASES",
        name: p.name,
        peers: peers
          .map((x) => ({
            woo_product_id: x.id,
            status: x.status,
            name: x.name,
            base_original: x.short_description,
            base: literalBase(x.short_description),
          }))
          .sort((a, b) => a.woo_product_id - b.woo_product_id),
        reasons: reasons.sort(),
        requires_exact_variant_and_destination_plan: true,
        write_allowed: false,
      };
    })
    .sort((a, b) => a.woo_product_id - b.woo_product_id);
}
