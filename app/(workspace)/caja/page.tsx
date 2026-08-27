import type { Metadata } from "next";
import { CashRegister } from "./cash-register";

export const metadata: Metadata = { title: "Caja" };

export default function CashPage() {
  return <CashRegister />;
}
