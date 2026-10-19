// Data must never terminate the outer DO body, even when single quotes are
// escaped correctly. Generated scripts explicitly enable standard strings.
export function quoteDoText(value, delimiter) {
  if (typeof value !== "string" || value.includes(delimiter))
    throw Error("UNSAFE_DO_DELIMITER");
  return "'" + value.replaceAll("'", "''") + "'";
}
