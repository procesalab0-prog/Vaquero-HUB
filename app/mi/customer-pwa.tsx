"use client";

import {
  CheckCircle2,
  CloudOff,
  Download,
  FileText,
  LogOut,
  Mail,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserPlus,
  Wifi,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  parseCustomerIdentifier,
  parseCustomerSelfRegistration,
} from "@/lib/customer-access";
import {
  CUSTOMER_CARD_STORAGE_KEY,
  parseOfflineCustomerCard,
  serializeOfflineCustomerCard,
} from "@/lib/customer-card-storage";
import { createCustomerClient } from "@/lib/supabase/customer-client";

type CardData = { memberNumber: string; fullName: string | null };
type LoyaltySummary = {
  enabled: boolean;
  launched_at: string | null;
  available_points: number;
  points_debt: number;
  lifetime_earned: number;
  lifetime_redeemed: number;
  point_value_cents: number;
  expiry_months: number;
  history: Array<{
    id: string;
    type:
      | "EARN"
      | "REDEEM"
      | "EXPIRE"
      | "RETURN_REVERSAL"
      | "DEBT_SETTLEMENT"
      | "ADJUSTMENT";
    points: number;
    balance_after: number;
    created_at: string;
    expires_at: string | null;
    reference_type: string;
  }>;
};
type CustomerTicket = {
  id: string;
  folio: string;
  status: "COMPLETED" | "CANCELLED";
  sold_at: string;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  register_name: string;
  return_window_days: number;
  location: { name: string; address: string | null; phone: string | null };
  items: Array<{
    product_name: string;
    variant_description: string;
    sku: string;
    quantity: number;
    unit_price_cents: number;
    gift_receipt: boolean;
  }>;
  payments: Array<{ method_name: string; amount_cents: number }>;
};
type CustomerPwaProps = {
  configured: boolean;
  phoneOtpEnabled: boolean;
  privacyNoticeVersion: string;
  privacyNoticeUrl: string;
};
const ticketDate = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium",
  timeZone: "America/Mexico_City",
});
const ticketDateTime = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Mexico_City",
});
const ticketMoney = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

export function CustomerPwa({
  configured,
  phoneOtpEnabled,
  privacyNoticeVersion,
  privacyNoticeUrl,
}: CustomerPwaProps) {
  const clientRef = useRef<ReturnType<typeof createCustomerClient> | null>(
    null,
  );
  const barcodeRef = useRef<SVGSVGElement>(null);
  const [card, setCard] = useState<CardData | null>(null);
  const [loyalty, setLoyalty] = useState<LoyaltySummary | null>(null);
  const [redemptionPoints, setRedemptionPoints] = useState("");
  const [redemptionCode, setRedemptionCode] = useState<{
    code: string;
    points: number;
    value_cents: number;
    expires_at: string;
  } | null>(null);
  const [tickets, setTickets] = useState<CustomerTicket[]>([]);
  const [ticketBusy, setTicketBusy] = useState<string | null>(null);
  const [qr, setQr] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<"access" | "register">("access");
  const [needsProfile, setNeedsProfile] = useState(false);
  const [registration, setRegistration] = useState({
    fullName: "",
    phone: "",
    email: "",
    birthdate: "",
    privacyAccepted: false,
    marketingConsent: false,
  });
  const [step, setStep] = useState<"identify" | "verify">("identify");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadOnlineCard = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const { data: sessionData } = await client.auth.getSession();
    setAuthenticated(Boolean(sessionData.session));
    if (!sessionData.session) return;

    const { data, error: cardError } = await client.rpc("get_my_customer_card");
    if (cardError) throw cardError;
    const record = Array.isArray(data) ? data[0] : null;
    if (!record?.member_number) {
      setNeedsProfile(true);
      setMode("register");
      setRegistration((current) => ({
        ...current,
        email: current.email || sessionData.session?.user.email || "",
      }));
      return;
    }
    setNeedsProfile(false);
    const nextCard = {
      memberNumber: record.member_number as string,
      fullName: record.full_name as string,
    };
    localStorage.setItem(
      CUSTOMER_CARD_STORAGE_KEY,
      serializeOfflineCustomerCard(nextCard.memberNumber),
    );
    setCard(nextCard);
    const ticketResult = await client.rpc("get_my_customer_tickets", {
      p_limit: 25,
    });
    if (!ticketResult.error)
      setTickets((ticketResult.data ?? []) as CustomerTicket[]);
    const loyaltyResult = await client.rpc("get_my_loyalty_summary");
    if (!loyaltyResult.error && loyaltyResult.data)
      setLoyalty(loyaltyResult.data as LoyaltySummary);
  }, []);

  async function createRedemptionCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = clientRef.current;
    const points = Number(redemptionPoints);
    if (
      !client ||
      !loyalty?.enabled ||
      !Number.isInteger(points) ||
      points <= 0 ||
      points > loyalty.available_points
    ) {
      setError("Escribe una cantidad válida dentro de tus puntos disponibles.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { data, error: codeError } = await client.rpc(
        "create_my_loyalty_redemption_code",
        { p_points: points },
      );
      if (codeError) throw codeError;
      setRedemptionCode(
        data as {
          code: string;
          points: number;
          value_cents: number;
          expires_at: string;
        },
      );
      setNotice("Muestra este código en caja. Vence en cinco minutos.");
    } catch {
      setError(
        "No fue posible generar el código. Actualiza tu saldo e inténtalo nuevamente.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function downloadCustomerTicket(ticket: CustomerTicket) {
    setTicketBusy(ticket.id);
    setError("");
    try {
      const { createTicketPdf, downloadTicketPdf } =
        await import("@/lib/ticket-pdf");
      const { blob, fileName } = await createTicketPdf({
        mode: "sale",
        folio: ticket.folio,
        soldAt: ticketDateTime.format(new Date(ticket.sold_at)),
        locationName: ticket.location.name,
        address: ticket.location.address,
        phone: ticket.location.phone,
        registerName: ticket.register_name,
        lines: ticket.items.map((item) => ({
          name: item.product_name,
          variant: item.variant_description,
          code: item.sku,
          quantity: Number(item.quantity),
          unitPriceCents: Number(item.unit_price_cents),
        })),
        subtotalCents: Number(ticket.subtotal_cents),
        discountCents: Number(ticket.discount_cents),
        totalCents: Number(ticket.total_cents),
        payments: ticket.payments.map((payment) => ({
          methodName: payment.method_name,
          amountCents: Number(payment.amount_cents),
        })),
        returnWindowDays: Number(ticket.return_window_days),
      });
      downloadTicketPdf(blob, fileName);
      setNotice(
        "Ticket descargado. Puedes guardarlo o compartirlo desde tu dispositivo.",
      );
    } catch {
      setError("No fue posible preparar ese ticket.");
    } finally {
      setTicketBusy(null);
    }
  }

  useEffect(() => {
    const hydrateTimer = window.setTimeout(() => {
      setOnline(navigator.onLine);
      const cached = parseOfflineCustomerCard(
        localStorage.getItem(CUSTOMER_CARD_STORAGE_KEY),
      );
      if (cached) {
        localStorage.setItem(
          CUSTOMER_CARD_STORAGE_KEY,
          serializeOfflineCustomerCard(cached.memberNumber),
        );
        setCard({ memberNumber: cached.memberNumber, fullName: null });
      }
    }, 0);

    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      const scope = window.location.pathname.startsWith("/mi") ? "/mi" : "/";
      navigator.serviceWorker
        .register("/mi/sw.js", { scope })
        .catch(() => undefined);
    }

    if (!configured)
      return () => {
        window.clearTimeout(hydrateTimer);
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
      };

    const client = createCustomerClient();
    clientRef.current = client;
    loadOnlineCard().catch(() =>
      setError(
        "No pudimos actualizar tu tarjeta. La copia guardada sigue disponible.",
      ),
    );
    const { data: listener } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN")
        window.setTimeout(
          () =>
            loadOnlineCard().catch(() =>
              setError(
                "Tu acceso se confirmó, pero falta vincular la tarjeta.",
              ),
            ),
          0,
        );
      if (event === "SIGNED_OUT") setAuthenticated(false);
    });

    return () => {
      window.clearTimeout(hydrateTimer);
      listener.subscription.unsubscribe();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [configured, loadOnlineCard]);

  useEffect(() => {
    if (!card?.memberNumber) return;
    let cancelled = false;
    Promise.all([import("qrcode"), import("jsbarcode")])
      .then(async ([qrModule, barcodeModule]) => {
        const nextQr = await qrModule.default.toDataURL(card.memberNumber, {
          color: { dark: "#1e1917", light: "#ffffff" },
          errorCorrectionLevel: "M",
          margin: 2,
          width: 280,
        });
        if (cancelled) return;
        setQr(nextQr);
        if (barcodeRef.current) {
          barcodeModule.default(barcodeRef.current, card.memberNumber, {
            background: "#ffffff",
            displayValue: false,
            format: "CODE128",
            height: 62,
            lineColor: "#1e1917",
            margin: 0,
            width: 2,
          });
        }
      })
      .catch(() => setQr(""));
    return () => {
      cancelled = true;
    };
  }, [card?.memberNumber]);

  async function requestAccess(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const parsed = parseCustomerIdentifier(identifier);
    if (!parsed)
      return setError("Escribe un teléfono mexicano o correo válido.");
    if (parsed.channel === "phone" && !phoneOtpEnabled)
      return setError(
        "El acceso por SMS aún no está activado. Usa el correo registrado en tienda.",
      );
    setBusy(true);
    try {
      const response = await fetch("/api/mi/acceso", {
        body: JSON.stringify({ identifier }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok)
        throw new Error(payload.message ?? "INVALID_IDENTIFIER");
      setStep("verify");
      setNotice(
        parsed.channel === "email"
          ? "Revisa tu correo y escribe aquí el código de seis dígitos. El enlace también puede abrir Mi Vaquero en el dispositivo donde lo pulses."
          : "Escribe el código de seis dígitos que enviamos por SMS.",
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error &&
          requestError.message !== "INVALID_IDENTIFIER"
          ? requestError.message
          : "No fue posible solicitar el acceso.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function requestRegistration(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!privacyNoticeVersion || !privacyNoticeUrl)
      return setError(
        "El registro se habilitará cuando esté publicado el aviso de privacidad.",
      );
    const parsed = parseCustomerSelfRegistration(registration);
    if (!parsed)
      return setError(
        "Revisa nombre, teléfono, correo, fecha y aceptación del aviso.",
      );
    setBusy(true);
    try {
      const response = await fetch("/api/mi/registro", {
        body: JSON.stringify(registration),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok)
        throw new Error(payload.message ?? "REGISTRATION_REQUEST_FAILED");
      setStep("verify");
      setNotice(
        "Revisa tu correo y escribe el código de seis dígitos para crear tu cuenta.",
      );
    } catch (registrationError) {
      setError(
        registrationError instanceof Error
          ? registrationError.message
          : "No fue posible iniciar el registro.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function completeRegistration() {
    const client = clientRef.current;
    const parsed = parseCustomerSelfRegistration(registration);
    if (!client || !parsed || !privacyNoticeVersion || !privacyNoticeUrl) {
      setError(
        "Revisa nombre, teléfono, correo, fecha y aceptación del aviso.",
      );
      return false;
    }

    const { data: sessionData } = await client.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw new Error("Vuelve a verificar tu correo.");

    const response = await fetch("/api/mi/registro/completar", {
      body: JSON.stringify(parsed),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      const message = payload.message ?? "";
      if (message.includes("PHONE_ALREADY_REGISTERED"))
        throw new Error(
          "Ese teléfono ya pertenece a otro registro. Pide ayuda en tienda para unirlo de forma segura.",
        );
      if (message.includes("STAFF_ACCOUNT_NOT_ALLOWED"))
        throw new Error(
          "Ese correo pertenece al sistema de empleados. Usa otro correo para Mi Vaquero.",
        );
      if (message.includes("CUSTOMER_ACCOUNT_ALREADY_LINKED"))
        throw new Error(
          "Ese cliente ya tiene otra cuenta vinculada. Pide ayuda en tienda.",
        );
      throw new Error(
        message || "No fue posible crear la cuenta. Inténtalo nuevamente.",
      );
    }
    setNeedsProfile(false);
    await loadOnlineCard();
    return true;
  }

  async function verifyAccess(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const client = clientRef.current;
    const parsed = parseCustomerIdentifier(
      mode === "register" ? registration.email : identifier,
    );
    if (!client || !parsed || !/^\d{6}$/.test(token))
      return setError("Escribe el código completo de seis dígitos.");
    setBusy(true);
    try {
      const result =
        parsed.channel === "phone"
          ? await client.auth.verifyOtp({
              phone: parsed.value,
              token,
              type: "sms",
            })
          : await client.auth.verifyOtp({
              email: parsed.value,
              token,
              type: "email",
            });
      if (result.error) throw result.error;
      if (mode === "register") {
        try {
          await completeRegistration();
          setNotice("Tu cuenta y tarjeta quedaron creadas.");
        } catch (registrationError) {
          setError(
            registrationError instanceof Error
              ? registrationError.message
              : "El correo quedó verificado, pero no fue posible crear la cuenta.",
          );
          return;
        }
      } else {
        await loadOnlineCard();
        setNotice("Tarjeta activada en este dispositivo.");
      }
      setToken("");
    } catch {
      setError("El código no es válido o ya venció. Solicita uno nuevo.");
    } finally {
      setBusy(false);
    }
  }

  async function finishVerifiedRegistration(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      if (await completeRegistration())
        setNotice("Tu cuenta y tarjeta quedaron creadas.");
    } catch (registrationError) {
      setError(
        registrationError instanceof Error
          ? registrationError.message
          : "No fue posible completar el registro.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await clientRef.current?.auth.signOut();
    setAuthenticated(false);
    setNeedsProfile(false);
    setNotice(
      "Cerraste sesión. Tu número de socio sigue disponible sin conexión.",
    );
  }

  async function removeCard() {
    if (
      !window.confirm(
        "¿Quitar esta tarjeta del dispositivo? Después necesitarás volver a verificar tu acceso.",
      )
    )
      return;
    await clientRef.current?.auth.signOut();
    localStorage.removeItem(CUSTOMER_CARD_STORAGE_KEY);
    setCard(null);
    setLoyalty(null);
    setRedemptionCode(null);
    setAuthenticated(false);
    setNeedsProfile(false);
    setMode("access");
    setStep("identify");
    setNotice("La tarjeta se quitó únicamente de este dispositivo.");
  }

  function registrationFields(emailLocked = false) {
    return (
      <div className="mi-registration-fields">
        <label htmlFor="customer-register-name">Nombre completo</label>
        <input
          id="customer-register-name"
          value={registration.fullName}
          onChange={(event) =>
            setRegistration((current) => ({
              ...current,
              fullName: event.target.value,
            }))
          }
          autoComplete="name"
          maxLength={120}
          placeholder="Tu nombre completo"
        />
        <label htmlFor="customer-register-phone">Teléfono</label>
        <input
          id="customer-register-phone"
          value={registration.phone}
          onChange={(event) =>
            setRegistration((current) => ({
              ...current,
              phone: event.target.value,
            }))
          }
          autoComplete="tel"
          inputMode="tel"
          placeholder="352 123 4567"
        />
        <label htmlFor="customer-register-email">Correo</label>
        <input
          id="customer-register-email"
          value={registration.email}
          onChange={(event) =>
            setRegistration((current) => ({
              ...current,
              email: event.target.value,
            }))
          }
          autoComplete="email"
          inputMode="email"
          readOnly={emailLocked}
          placeholder="correo@ejemplo.com"
        />
        <label htmlFor="customer-register-birthdate">
          Fecha de nacimiento <small>Opcional</small>
        </label>
        <input
          id="customer-register-birthdate"
          type="date"
          value={registration.birthdate}
          onChange={(event) =>
            setRegistration((current) => ({
              ...current,
              birthdate: event.target.value,
            }))
          }
          autoComplete="bday"
          max={new Date().toISOString().slice(0, 10)}
        />
        <label className="mi-consent">
          <input
            type="checkbox"
            checked={registration.privacyAccepted}
            onChange={(event) =>
              setRegistration((current) => ({
                ...current,
                privacyAccepted: event.target.checked,
              }))
            }
          />
          <span>
            Acepto el{" "}
            {privacyNoticeUrl ? (
              <a href={privacyNoticeUrl} target="_blank" rel="noreferrer">
                aviso de privacidad
              </a>
            ) : (
              "aviso de privacidad"
            )}
            .
          </span>
        </label>
        <label className="mi-consent optional">
          <input
            type="checkbox"
            checked={registration.marketingConsent}
            onChange={(event) =>
              setRegistration((current) => ({
                ...current,
                marketingConsent: event.target.checked,
              }))
            }
          />
          <span>
            Quiero recibir promociones. <small>Opcional</small>
          </span>
        </label>
      </div>
    );
  }

  return (
    <main className="mi-app">
      <header className="mi-header">
        <Image
          src="/brand/logo-vaquerosm-blanco.png"
          alt="Vaquero SM"
          width={188}
          height={68}
          priority
        />
        <span className={online ? "mi-connectivity online" : "mi-connectivity"}>
          {online ? (
            <Wifi aria-hidden="true" />
          ) : (
            <CloudOff aria-hidden="true" />
          )}
          {online ? "En línea" : "Sin conexión"}
        </span>
      </header>

      <section className="mi-content">
        {card ? (
          <>
            <div className="mi-title">
              <p>Tarjeta digital</p>
              <h1>
                {card.fullName
                  ? `Hola, ${card.fullName.split(" ")[0]}`
                  : "Mi tarjeta Vaquero"}
              </h1>
              <span>
                {authenticated
                  ? "Información actualizada"
                  : "Disponible sin iniciar sesión"}
              </span>
            </div>
            <article className="member-card">
              <div className="member-card-brand">
                <Image
                  src="/brand/emblema-blanco.png"
                  alt=""
                  width={52}
                  height={52}
                />
                <span>VAQUERO SM</span>
              </div>
              <div className="member-qr">
                {qr ? (
                  <Image
                    src={qr}
                    alt={`Código QR del socio ${card.memberNumber}`}
                    width={280}
                    height={280}
                    unoptimized
                  />
                ) : (
                  <span>Generando QR…</span>
                )}
              </div>
              <div className="member-number">
                <small>NÚMERO DE SOCIO</small>
                <strong>
                  {card.memberNumber.slice(0, 4)} {card.memberNumber.slice(4)}
                </strong>
              </div>
              <div className="member-barcode">
                <svg
                  ref={barcodeRef}
                  role="img"
                  aria-label={`Código de barras del socio ${card.memberNumber}`}
                />
              </div>
            </article>

            <div className="mi-safe-note">
              <ShieldCheck aria-hidden="true" />
              <span>
                <strong>Funciona sin internet</strong>
                <small>
                  Este dispositivo conserva únicamente tu número de socio. Tus
                  datos personales no se guardan aquí.
                </small>
              </span>
            </div>
            {authenticated && loyalty?.enabled ? (
              <section className="mi-loyalty-panel">
                <div className="mi-loyalty-balance">
                  <span>
                    <small>PUNTOS DISPONIBLES</small>
                    <strong>
                      {loyalty.available_points.toLocaleString("es-MX")}
                    </strong>
                  </span>
                  <span>
                    <small>VALOR</small>
                    <b>
                      {ticketMoney.format(
                        (loyalty.available_points * loyalty.point_value_cents) /
                          100,
                      )}
                    </b>
                  </span>
                </div>
                <p>
                  Cada punto vale{" "}
                  {ticketMoney.format(loyalty.point_value_cents / 100)} y vence{" "}
                  {loyalty.expiry_months} meses después de ganarse.
                </p>
                {loyalty.points_debt > 0 ? (
                  <p className="mi-loyalty-warning">
                    Los próximos {loyalty.points_debt} puntos cubrirán un ajuste
                    por cambio o devolución.
                  </p>
                ) : null}
                <form className="mi-redemption" onSubmit={createRedemptionCode}>
                  <label htmlFor="redemption-points">Usar puntos</label>
                  <div>
                    <input
                      id="redemption-points"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={loyalty.available_points}
                      step={1}
                      value={redemptionPoints}
                      onChange={(event) =>
                        setRedemptionPoints(event.target.value)
                      }
                      placeholder="Cantidad"
                    />
                    <button
                      type="submit"
                      disabled={busy || !loyalty.available_points}
                    >
                      Generar código
                    </button>
                  </div>
                </form>
                {redemptionCode ? (
                  <div className="mi-redemption-code" role="status">
                    <small>CÓDIGO TEMPORAL</small>
                    <strong>{redemptionCode.code}</strong>
                    <span>
                      {redemptionCode.points} puntos ·{" "}
                      {ticketMoney.format(redemptionCode.value_cents / 100)}
                    </span>
                  </div>
                ) : null}
                {loyalty.history.length ? (
                  <div className="mi-points-history">
                    <strong>Movimientos recientes</strong>
                    {loyalty.history.slice(0, 8).map((movement) => (
                      <div key={movement.id}>
                        <span>
                          {movement.type === "EARN"
                            ? "Compra"
                            : movement.type === "EXPIRE"
                              ? "Vencimiento"
                              : movement.type === "RETURN_REVERSAL"
                                ? "Cambio o devolución"
                                : movement.type === "REDEEM"
                                  ? "Canje"
                                  : "Ajuste"}
                          <small>
                            {ticketDate.format(new Date(movement.created_at))}
                          </small>
                        </span>
                        <b className={movement.points > 0 ? "positive" : ""}>
                          {movement.points > 0 ? "+" : ""}
                          {movement.points}
                        </b>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : (
              <div className="mi-program-status">
                <CheckCircle2 aria-hidden="true" />
                <span>
                  <strong>Identidad lista</strong>
                  <small>
                    Tus compras vinculadas aparecen aquí. El saldo de puntos se
                    activará desde la fecha oficial de lanzamiento.
                  </small>
                </span>
              </div>
            )}
            {authenticated ? (
              <section className="mi-ticket-history">
                <div className="mi-section-title">
                  <FileText aria-hidden="true" />
                  <span>
                    <strong>Mis tickets</strong>
                    <small>Compras registradas con tu cuenta</small>
                  </span>
                </div>
                {tickets.length ? (
                  tickets.map((ticket) => (
                    <article key={ticket.id}>
                      <div>
                        <strong>{ticket.folio}</strong>
                        <small>
                          {ticketDate.format(new Date(ticket.sold_at))} ·{" "}
                          {ticket.location.name}
                        </small>
                      </div>
                      <div>
                        <b>
                          {ticketMoney.format(Number(ticket.total_cents) / 100)}
                        </b>
                        {ticket.status === "CANCELLED" ? (
                          <small>Cancelada</small>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        disabled={ticketBusy === ticket.id}
                        onClick={() => void downloadCustomerTicket(ticket)}
                      >
                        <Download aria-hidden="true" />
                        {ticketBusy === ticket.id ? "Preparando…" : "PDF"}
                      </button>
                    </article>
                  ))
                ) : (
                  <p className="mi-empty-tickets">
                    Todavía no hay compras vinculadas a esta cuenta.
                  </p>
                )}
              </section>
            ) : null}
            <div className="mi-actions">
              {authenticated ? (
                <button
                  type="button"
                  onClick={() =>
                    loadOnlineCard().catch(() =>
                      setError("No fue posible actualizar la tarjeta."),
                    )
                  }
                >
                  <RefreshCw aria-hidden="true" />
                  Actualizar
                </button>
              ) : null}
              {authenticated ? (
                <button type="button" onClick={signOut}>
                  <LogOut aria-hidden="true" />
                  Cerrar sesión
                </button>
              ) : null}
              <button className="danger" type="button" onClick={removeCard}>
                <Trash2 aria-hidden="true" />
                Quitar del dispositivo
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mi-title">
              <p>Vaquero SM</p>
              <h1>Tu tarjeta siempre contigo</h1>
              <span>
                Identifícate en caja con QR, código de barras o número de socio.
              </span>
            </div>
            <div className="mi-access-card">
              <div className="mi-access-icon">
                {mode === "register" ? (
                  <UserPlus aria-hidden="true" />
                ) : (
                  <Smartphone aria-hidden="true" />
                )}
              </div>
              <h2>
                {needsProfile
                  ? "Termina de crear tu cuenta"
                  : mode === "register"
                    ? "Crear mi cuenta"
                    : "Activar mi tarjeta"}
              </h2>
              <p>
                {needsProfile
                  ? "Tu correo ya está verificado. Completa tus datos para recibir tu número de socio."
                  : mode === "register"
                    ? "Regístrate desde aquí y recibe tu tarjeta digital. No necesitas contraseña."
                    : "Usa el teléfono o correo que registraste en tienda. Nunca te pediremos una contraseña."}
              </p>
              {!needsProfile && step === "identify" ? (
                <div className="mi-access-modes" aria-label="Tipo de acceso">
                  <button
                    className={mode === "access" ? "active" : ""}
                    type="button"
                    onClick={() => {
                      setMode("access");
                      setError("");
                      setNotice("");
                    }}
                  >
                    Ya tengo cuenta
                  </button>
                  <button
                    className={mode === "register" ? "active" : ""}
                    type="button"
                    onClick={() => {
                      setMode("register");
                      setError("");
                      setNotice("");
                    }}
                  >
                    Crear cuenta
                  </button>
                </div>
              ) : null}
              {!configured ? (
                <div className="mi-message error">
                  El acceso se habilitará al conectar Supabase.
                </div>
              ) : needsProfile ? (
                <form onSubmit={finishVerifiedRegistration}>
                  {registrationFields(true)}
                  <button className="mi-primary" disabled={busy} type="submit">
                    {busy ? "Creando cuenta…" : "Crear mi tarjeta"}
                  </button>
                  <button
                    className="mi-link-button"
                    type="button"
                    onClick={() => void signOut()}
                  >
                    Usar otro correo
                  </button>
                </form>
              ) : mode === "register" && step === "identify" ? (
                <form onSubmit={requestRegistration}>
                  {registrationFields()}
                  <button
                    className="mi-primary"
                    disabled={
                      busy || !privacyNoticeVersion || !privacyNoticeUrl
                    }
                    type="submit"
                  >
                    {busy ? "Enviando código…" : "Verificar mi correo"}
                  </button>
                  {!privacyNoticeVersion || !privacyNoticeUrl ? (
                    <small className="mi-channel-note">
                      El formulario quedará habilitado al publicar el aviso de
                      privacidad aprobado.
                    </small>
                  ) : null}
                </form>
              ) : step === "identify" ? (
                <form onSubmit={requestAccess}>
                  <label htmlFor="customer-identifier">Teléfono o correo</label>
                  <div className="mi-input">
                    <Mail aria-hidden="true" />
                    <input
                      id="customer-identifier"
                      value={identifier}
                      onChange={(event) => setIdentifier(event.target.value)}
                      autoComplete="username"
                      inputMode="text"
                      placeholder="correo@ejemplo.com"
                    />
                  </div>
                  <button className="mi-primary" disabled={busy} type="submit">
                    {busy ? "Solicitando…" : "Continuar"}
                  </button>
                  {!phoneOtpEnabled ? (
                    <small className="mi-channel-note">
                      SMS pendiente de configuración. El acceso por correo ya
                      está preparado.
                    </small>
                  ) : null}
                </form>
              ) : (
                <form onSubmit={verifyAccess}>
                  <label htmlFor="customer-token">Código de seis dígitos</label>
                  <input
                    className="mi-code-input"
                    id="customer-token"
                    value={token}
                    onChange={(event) =>
                      setToken(
                        event.target.value.replace(/\D/g, "").slice(0, 6),
                      )
                    }
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    placeholder="000000"
                  />
                  <button className="mi-primary" disabled={busy} type="submit">
                    {busy
                      ? "Verificando…"
                      : mode === "register"
                        ? "Verificar y crear cuenta"
                        : "Activar tarjeta"}
                  </button>
                  <small className="mi-channel-note">
                    La sesión quedará guardada en este dispositivo. Puedes
                    repetir este acceso en otros equipos.
                  </small>
                  <button
                    className="mi-link-button"
                    type="button"
                    onClick={() => {
                      setStep("identify");
                      setToken("");
                      setNotice("");
                      setError("");
                    }}
                  >
                    {mode === "register"
                      ? "Corregir mis datos"
                      : "Usar otro teléfono o correo"}
                  </button>
                </form>
              )}
              <p className="mi-privacy">
                <ShieldCheck aria-hidden="true" />
                Las promociones son opcionales y se autorizan por separado.
              </p>
            </div>
          </>
        )}

        {notice ? (
          <div className="mi-message" role="status">
            {notice}
          </div>
        ) : null}
        {error ? (
          <div className="mi-message error" role="alert">
            {error}
          </div>
        ) : null}

        <details className="mi-install">
          <summary>
            <Download aria-hidden="true" />
            Guardar en mi pantalla de inicio
          </summary>
          <div>
            <strong>En iPhone</strong>
            <span>
              Abre esta página en Safari, toca Compartir y elige “Agregar a
              inicio”.
            </span>
            <strong>En Android</strong>
            <span>
              Abre el menú del navegador y selecciona “Instalar aplicación”.
            </span>
          </div>
        </details>
      </section>
      <footer>Mi Vaquero · Creado por ProcesaLab</footer>
    </main>
  );
}
