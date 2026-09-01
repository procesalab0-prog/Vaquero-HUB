"use client";

import { useWorkspace } from "@/components/workspace-context";

export function DashboardGreeting({ dateLabel }: { dateLabel: string }) {
  const { identity, activeLocation } = useWorkspace();
  const preferredName = identity.name.trim().split(/\s+/)[0] || identity.name;

  return (
    <div>
      <p className="eyebrow">{dateLabel}</p>
      <h1>Buen día, {preferredName}</h1>
      <p className="heading-copy">Esto es lo que está pasando en {activeLocation?.name ?? "tu sucursal"}.</p>
    </div>
  );
}
