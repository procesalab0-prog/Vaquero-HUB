import React from "react";
import { createRoot } from "react-dom/client";
import { UsdCheckout } from "@/components/usd-checkout";
import { ThermalReceipt } from "@/components/thermal-receipt";
// This isolated Vite build uses the classic JSX transform, unlike Next.js.
Object.assign(globalThis, { React });
const quote = {
  id: "QA-QUOTE",
  reference_date: "2026-10-02",
  rate_million: 20000000,
  reference_rate_million: 20000000,
  adjustment_million: 0,
  expires_at: new Date(Date.now() + 300000).toISOString(),
  refund_currency: "MXN",
  refund_rate: "ORIGINAL_SALE",
} as const;
createRoot(document.getElementById("root")!).render(
  <>
    <UsdCheckout
      sessionId="QA-SESSION"
      totalCents={10000}
      disabled={false}
      prepareAction={async () => ({ ok: true, quote })}
      onConfirm={async (input) => {
        document.getElementById("result")!.textContent = JSON.stringify(input);
      }}
    />
    <output id="result" />
    <ThermalReceipt
      mode="gift"
      folio="QA-V-000001"
      date="02/10/2026"
      items={[
        {
          name: "Bota prueba",
          variant: "Talla 27",
          code: "17996",
          quantity: 1,
          unitPrice: 100,
        },
      ]}
      usdTender={{
        received_usd_cents: 550,
        rate_million: 20000000,
        equivalent_mxn_cents: 11000,
        change_mxn_cents: 1000,
      }}
    />
  </>,
);
