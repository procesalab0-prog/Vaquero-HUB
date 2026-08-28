import type { Metadata } from "next";
import { mockVariants } from "@/lib/mock-data";
import { InventoryWorkspace } from "./inventory-workspace";

export const metadata: Metadata = { title: "Inventario" };

export default function InventoryPage() {
  return <InventoryWorkspace variants={mockVariants} />;
}
