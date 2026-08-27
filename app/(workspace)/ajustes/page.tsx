import type { Metadata } from "next";
import { SettingsWorkspace } from "./settings-workspace";

export const metadata: Metadata = { title: "Ajustes" };

export default function SettingsPage() {
  return <SettingsWorkspace />;
}
