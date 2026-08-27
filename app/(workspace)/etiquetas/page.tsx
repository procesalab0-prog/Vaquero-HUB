import type { Metadata } from "next";
import { mockVariants } from "@/lib/mock-data";
import { LabelsWorkspace } from "./labels-workspace";

export const metadata: Metadata = { title: "Etiquetas y códigos" };

export default function LabelsPage() {
  return <LabelsWorkspace variants={mockVariants} />;
}
