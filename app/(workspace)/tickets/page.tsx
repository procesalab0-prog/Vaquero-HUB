import type { Metadata } from "next";
import { TicketsWorkspace } from "./tickets-workspace";

export const metadata: Metadata = { title: "Tickets" };

export default function TicketsPage() {
  return <TicketsWorkspace />;
}
