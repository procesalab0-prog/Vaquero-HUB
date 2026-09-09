import "server-only";

import { cookies } from "next/headers";

import {
  ACTIVE_LOCATION_COOKIE,
  pickActiveLocation,
} from "@/lib/location-preference";

export async function resolveActiveLocation<T extends { id: string }>(
  locations: T[],
  requestedLocationId?: string,
) {
  const cookieStore = await cookies();
  return pickActiveLocation(
    locations,
    requestedLocationId,
    cookieStore.get(ACTIVE_LOCATION_COOKIE)?.value,
  );
}

