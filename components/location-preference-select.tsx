"use client";

import { saveActiveLocationPreference } from "@/lib/location-preference";

export function LocationPreferenceSelect({
  locations,
  defaultValue,
  name = "ubicacion",
  ariaLabel = "Sucursal",
}: {
  locations: Array<{ id: string; name: string }>;
  defaultValue: string;
  name?: string;
  ariaLabel?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      name={name}
      defaultValue={defaultValue}
      onChange={(event) =>
        saveActiveLocationPreference(event.currentTarget.value)
      }
    >
      {locations.map((location) => (
        <option value={location.id} key={location.id}>
          {location.name}
        </option>
      ))}
    </select>
  );
}
