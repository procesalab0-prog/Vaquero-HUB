"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

export function MemberCodes({
  memberNumber,
  barcode = false,
  barcodeOnly = false,
}: {
  memberNumber: string;
  barcode?: boolean;
  barcodeOnly?: boolean;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [qr, setQr] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([import("qrcode"), import("jsbarcode")])
      .then(async ([qrModule, bars]) => {
        const data = await qrModule.default.toDataURL(memberNumber, {
          color: { dark: "#000000", light: "#ffffff" },
          errorCorrectionLevel: "M",
          margin: 4,
          width: 360,
        });
        if (cancelled) return;
        setQr(data);
        if (svg.current)
          bars.default(svg.current, memberNumber, {
            format: "CODE128",
            background: "#ffffff",
            lineColor: "#000000",
            displayValue: false,
            height: 66,
            width: 3,
            margin: 16,
          });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [memberNumber, barcode]);
  return (
    <div className={barcode ? "mi-codes mi-codes-large" : "mi-codes"}>
      {!barcodeOnly && (
        <div className="mi-qr">
          {qr ? (
            <Image
              src={qr}
              alt={`QR del socio ${memberNumber}`}
              width={360}
              height={360}
              unoptimized
            />
          ) : (
            <span>{failed ? "Usa tu número de socio" : "Preparando QR…"}</span>
          )}
        </div>
      )}
      {barcode && (
        <div className="mi-barcode">
          <svg
            ref={svg}
            role="img"
            aria-label={`Código de barras del socio ${memberNumber}`}
          />
        </div>
      )}
    </div>
  );
}
