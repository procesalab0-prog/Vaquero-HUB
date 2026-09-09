export const ACTIVE_LOCATION_COOKIE = "mi_tienda_active_location";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function pickActiveLocation<T extends { id: string }>(
  locations: T[],
  requestedLocationId?: string,
  storedLocationId?: string,
) {
  return (
    locations.find((location) => location.id === requestedLocationId) ??
    locations.find((location) => location.id === storedLocationId) ??
    locations[0]
  );
}

export function saveActiveLocationPreference(locationId: string) {
  if (typeof document === "undefined" || !locationId) return;
  document.cookie = `${ACTIVE_LOCATION_COOKIE}=${encodeURIComponent(locationId)}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}

