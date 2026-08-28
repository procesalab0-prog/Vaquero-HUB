import type { Metadata } from "next";
import { mockVariants } from "@/lib/mock-data";
import { ProductsWorkspace } from "./products-workspace";

export const metadata: Metadata = { title: "Productos" };

export default function ProductsPage() {
  return <ProductsWorkspace initialVariants={mockVariants} />;
}
