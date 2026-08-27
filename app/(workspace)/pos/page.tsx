import type { Metadata } from "next";
import { PosWorkspace } from "./pos-workspace";
import { mockVariants } from "@/lib/mock-data";

export const metadata: Metadata = { title: "Punto de venta" };

export default function PosPage() {
  return <PosWorkspace variants={mockVariants} />;
}
