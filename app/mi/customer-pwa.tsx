"use client";

import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Barcode,
  Check,
  CheckCircle2,
  ChevronRight,
  CloudOff,
  Download,
  FileText,
  Home,
  LogOut,
  Mail,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Trash2,
  UserRound,
  X,
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
import { APP_VERSION } from "@/lib/release";
import { CampaignFilm } from "./campaign-film";
import { MemberCard } from "./member-card";
import { MemberCodes } from "./member-codes";
import { useScanWakeLock } from "./use-scan-wake-lock";

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
type View = "inicio" | "tarjeta" | "perfil";
type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
const views: View[] = ["inicio", "tarjeta", "perfil"];
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
  const dialog = useRef<HTMLDialogElement>(null);
  const [scanning, setScanning] = useState(false);
  useScanWakeLock(scanning);
  const [view, setView] = useState<View>("inicio");
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
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);

  const navigate = useCallback((next: View) => {
    setView(next);
    setError("");
    setNotice("");
    history.replaceState(
      null,
      "",
      `${location.pathname}${location.search}#${next}`,
    );
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

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
    try {
      localStorage.setItem(
        CUSTOMER_CARD_STORAGE_KEY,
        serializeOfflineCustomerCard(nextCard.memberNumber),
      );
      setSaved(true);
    } catch {
      setSaved(false);
      setNotice(
        "Tu navegador no permite guardar la tarjeta. Podrás consultarla con conexión.",
      );
    }
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
      const requested = location.hash.slice(1) as View;
      if (views.includes(requested)) setView(requested);
      setOnline(navigator.onLine);
      try {
        const cached = parseOfflineCustomerCard(
          localStorage.getItem(CUSTOMER_CARD_STORAGE_KEY),
        );
        if (cached) {
          setCard({ memberNumber: cached.memberNumber, fullName: null });
          setSaved(true);
          if (!views.includes(requested)) setView("tarjeta");
        }
      } catch {
        // The online card still works when persistent storage is unavailable.
      }
      setInstalled(
        matchMedia("(display-mode: standalone)").matches ||
          Boolean(
            (navigator as Navigator & { standalone?: boolean }).standalone,
          ),
      );
      setReady(true);
    }, 0);

    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const onHash = () => {
      const next = location.hash.slice(1) as View;
      if (views.includes(next)) setView(next);
    };
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallPrompt);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstall(null);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("hashchange", onHash);
    window.addEventListener("beforeinstallprompt", onInstall);
    window.addEventListener("appinstalled", onInstalled);

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
        window.removeEventListener("hashchange", onHash);
        window.removeEventListener("beforeinstallprompt", onInstall);
        window.removeEventListener("appinstalled", onInstalled);
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
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("beforeinstallprompt", onInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [configured, loadOnlineCard]);

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
      navigate("tarjeta");
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
    setSaved(false);
    navigate("perfil");
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

  const groupedNumber = card
    ? `${card.memberNumber.slice(0, 4)} ${card.memberNumber.slice(4)}`
    : "";

  return (
    <div className={`mi-app mi-view-${view}`}>
      <a className="mi-skip" href="#mi-main">
        Ir al contenido
      </a>
      <div className="mi-splash" aria-hidden="true">
        <Image
          src="/brand/logo-vaquerosm-blanco.png"
          alt=""
          width={360}
          height={160}
          unoptimized
          priority
        />
        <span>EL MISMO QUE VISTE Y CALZA.</span>
      </div>
      <header className="mi-header">
        <button
          className="mi-brand-button"
          onClick={() => navigate("inicio")}
          aria-label="Vaquero SM, ir a inicio"
        >
          <Image
            src="/brand/logo-vaquerosm-blanco.png"
            alt="Vaquero SM"
            width={180}
            height={88}
            priority
            unoptimized
          />
        </button>
        <div className="mi-header-right">
          <span>
            INDUMENTARIA
            <br />
            VAQUERA
          </span>
          <button
            className="mi-icon-button"
            onClick={() => navigate("perfil")}
            aria-label="Abrir perfil"
          >
            <UserRound />
          </button>
        </div>
      </header>

      {!online && (
        <div className="mi-offline" role="status">
          <CloudOff size={15} /> Sin conexión
          {saved ? " · Tu tarjeta sigue contigo" : ""}
        </div>
      )}

      <main id="mi-main">
        {view === "inicio" && (
          <>
            <section className="mi-hero" aria-label="Campaña Vaquero SM">
              <CampaignFilm />
              <div className="mi-hero-shade" />
              <div className="mi-hero-copy">
                <span className="mi-eyebrow">VAQUERO SM · LA PIEDAD</span>
                <h1>
                  LO QUE ERES.
                  <br />
                  <em>LO QUE LLEVAS.</em>
                </h1>
                <p>El mismo que viste y calza.</p>
                <button
                  className="mi-outline"
                  onClick={() => navigate("tarjeta")}
                >
                  {card ? "Mi tarjeta" : "Descubre tu tarjeta"} <ArrowUpRight />
                </button>
              </div>
              <span className="mi-hero-side">
                TRADICIÓN QUE SE LLEVA PUESTA
              </span>
            </section>
            <section className="mi-editorial">
              <div className="mi-editorial-heading">
                <span className="mi-eyebrow">ES PARTE DE TI</span>
                <h2>
                  Una forma
                  <br />
                  de <em>vivir.</em>
                </h2>
                <p>Los detalles cuentan tu historia.</p>
              </div>
              <div className="mi-editorial-images">
                <figure>
                  <Image
                    src="/mi-media/portrait-woman.webp"
                    alt="Estilo vaquero con sombrero y bolso negro"
                    width={1280}
                    height={1920}
                    sizes="(max-width: 700px) 72vw, 40vw"
                  />
                  <figcaption>01 / ESENCIA</figcaption>
                </figure>
                <figure>
                  <Image
                    src="/mi-media/boots-detail.webp"
                    alt="Detalle de botas vaqueras negras bordadas"
                    width={1280}
                    height={1920}
                    sizes="(max-width: 700px) 52vw, 30vw"
                  />
                  <figcaption>02 / CARÁCTER</figcaption>
                </figure>
              </div>
              <div className="mi-editorial-details">
                <Image
                  src="/mi-media/shirt-detail.webp"
                  alt="Textura y detalles de una camisa vaquera"
                  width={1280}
                  height={1920}
                  sizes="(max-width: 700px) 45vw, 24vw"
                />
                <p>
                  Más que compras,
                  <br />
                  es parte de
                  <br />
                  <em>tu historia.</em>
                </p>
                <Image
                  src="/mi-media/vest-detail.webp"
                  alt="Detalle de chaleco, camisa y cinturón"
                  width={1280}
                  height={1920}
                  sizes="(max-width: 700px) 45vw, 24vw"
                />
              </div>
              <button
                className="mi-primary"
                onClick={() => navigate("tarjeta")}
              >
                Siempre contigo <ArrowRight />
              </button>
            </section>
          </>
        )}

        {view === "tarjeta" && (
          <>
            <section className="mi-card-scene">
              <Image
                className="mi-card-photo"
                src="/mi-media/portrait-man.webp"
                alt=""
                fill
                sizes="(max-width: 900px) 100vw, 60vw"
                priority
                unoptimized
              />
              <div className="mi-card-shade" />
              <div className="mi-card-content">
                <div className="mi-card-kicker">
                  <span className="mi-eyebrow">
                    TARJETA
                    <br />
                    DE LEALTAD
                  </span>
                  <span className="mi-rule" />
                </div>
                <div className="mi-card-title">
                  <span className="mi-eyebrow">VAQUERO SM</span>
                  <h1>
                    SIEMPRE
                    <br />
                    CONTIGO
                  </h1>
                  <span className="mi-rule" />
                  <p>
                    Más que compras,
                    <br />
                    es parte de <em>tu historia.</em>
                  </p>
                </div>
                {!ready ? (
                  <div className="mi-member-panel" role="status">
                    Preparando tu tarjeta…
                  </div>
                ) : card ? (
                  <MemberCard
                    memberNumber={card.memberNumber}
                    fullName={card.fullName}
                    saved={saved}
                    onExpand={() => {
                      dialog.current?.showModal();
                      setScanning(true);
                    }}
                  />
                ) : (
                  <div className="mi-member-panel mi-member-empty">
                    <span className="mi-eyebrow">
                      TU PRÓXIMA VISITA EMPIEZA AQUÍ
                    </span>
                    <h2>Tu tarjeta, siempre a mano.</h2>
                    <p>
                      Crea tu cuenta con tu correo y recibe tu número de socio.
                    </p>
                    <button
                      className="mi-primary"
                      onClick={() => navigate("perfil")}
                    >
                      Crear o activar mi tarjeta <ArrowRight />
                    </button>
                  </div>
                )}
              </div>
            </section>

            {card && (
              <section className="mi-customer-dashboard">
                <div className="mi-safe-note">
                  <ShieldCheck aria-hidden="true" />
                  <span>
                    <strong>Funciona sin internet</strong>
                    <small>
                      Este dispositivo conserva únicamente tu número de socio.
                      Tus datos personales no se guardan aquí.
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
                            (loyalty.available_points *
                              loyalty.point_value_cents) /
                              100,
                          )}
                        </b>
                      </span>
                    </div>
                    <p>
                      Cada punto vale{" "}
                      {ticketMoney.format(loyalty.point_value_cents / 100)} y
                      vence {loyalty.expiry_months} meses después de ganarse.
                    </p>
                    {loyalty.points_debt > 0 && (
                      <p className="mi-loyalty-warning">
                        Los próximos {loyalty.points_debt} puntos cubrirán un
                        ajuste por cambio o devolución.
                      </p>
                    )}
                    <form
                      className="mi-redemption"
                      onSubmit={createRedemptionCode}
                    >
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
                    {redemptionCode && (
                      <div className="mi-redemption-code" role="status">
                        <small>CÓDIGO TEMPORAL</small>
                        <strong>{redemptionCode.code}</strong>
                        <span>
                          {redemptionCode.points} puntos ·{" "}
                          {ticketMoney.format(redemptionCode.value_cents / 100)}
                        </span>
                      </div>
                    )}
                    {loyalty.history.length > 0 && (
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
                                {ticketDate.format(
                                  new Date(movement.created_at),
                                )}
                              </small>
                            </span>
                            <b
                              className={movement.points > 0 ? "positive" : ""}
                            >
                              {movement.points > 0 ? "+" : ""}
                              {movement.points}
                            </b>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                ) : (
                  <div className="mi-program-status">
                    <CheckCircle2 aria-hidden="true" />
                    <span>
                      <strong>Identidad lista</strong>
                      <small>
                        Tus compras vinculadas aparecen aquí. El saldo de puntos
                        se activará desde la fecha oficial de lanzamiento.
                      </small>
                    </span>
                  </div>
                )}

                {authenticated && (
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
                              {ticketMoney.format(
                                Number(ticket.total_cents) / 100,
                              )}
                            </b>
                            {ticket.status === "CANCELLED" && (
                              <small>Cancelada</small>
                            )}
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
                )}
              </section>
            )}
          </>
        )}

        {view === "perfil" && (
          <section className="mi-profile">
            <div className="mi-profile-photo">
              <Image
                src="/mi-media/portrait-woman.webp"
                alt="Estilo Vaquero SM"
                fill
                sizes="45vw"
              />
            </div>
            <div className="mi-profile-content">
              <button
                className="mi-text-button mi-back"
                onClick={() => navigate("tarjeta")}
              >
                <ArrowLeft size={18} /> Mi tarjeta
              </button>

              {authenticated && card ? (
                <div className="mi-account">
                  <span className="mi-eyebrow">MI PERFIL</span>
                  <h1>
                    Hola,
                    <br />
                    <em>{card.fullName?.split(" ")[0] || "socio"}.</em>
                  </h1>
                  <p>
                    Número de socio <strong>{groupedNumber}</strong>
                  </p>
                  <div className="mi-settings">
                    <button
                      disabled={busy || !online || !configured}
                      onClick={async () => {
                        setBusy(true);
                        setError("");
                        try {
                          await loadOnlineCard();
                          setNotice("Tu tarjeta está actualizada.");
                        } catch {
                          setError("No pudimos actualizar tu tarjeta.");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <RefreshCw /> Actualizar tarjeta <ChevronRight />
                    </button>
                    <button disabled={busy} onClick={() => void signOut()}>
                      <LogOut /> Cerrar sesión <ChevronRight />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mi-access">
                  <span className="mi-eyebrow">MI VAQUERO</span>
                  <h1>
                    {needsProfile
                      ? "Termina tu cuenta."
                      : mode === "register"
                        ? "Crea tu cuenta."
                        : "Entra a tu cuenta."}
                  </h1>
                  <p>
                    {needsProfile
                      ? "Tu correo ya está verificado. Completa tus datos."
                      : "Accede con tu correo personal. No necesitas contraseña."}
                  </p>

                  {!needsProfile && step === "identify" && (
                    <div
                      className="mi-access-modes"
                      aria-label="Tipo de acceso"
                    >
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
                  )}

                  {!configured ? (
                    <div className="mi-message mi-error">
                      El acceso se habilitará al conectar Supabase.
                    </div>
                  ) : needsProfile ? (
                    <form onSubmit={finishVerifiedRegistration}>
                      {registrationFields(true)}
                      <button
                        className="mi-primary"
                        disabled={busy}
                        type="submit"
                      >
                        {busy ? "Creando cuenta…" : "Crear mi tarjeta"}
                      </button>
                      <button
                        className="mi-text-button"
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
                      {(!privacyNoticeVersion || !privacyNoticeUrl) && (
                        <small className="mi-channel-note">
                          El formulario quedará habilitado al publicar el aviso
                          de privacidad.
                        </small>
                      )}
                    </form>
                  ) : step === "identify" ? (
                    <form onSubmit={requestAccess}>
                      <label htmlFor="customer-identifier">
                        Correo personal
                      </label>
                      <div className="mi-input">
                        <Mail aria-hidden="true" />
                        <input
                          id="customer-identifier"
                          value={identifier}
                          onChange={(event) =>
                            setIdentifier(event.target.value)
                          }
                          autoComplete="username"
                          inputMode="email"
                          placeholder="correo@ejemplo.com"
                        />
                      </div>
                      <button
                        className="mi-primary"
                        disabled={busy}
                        type="submit"
                      >
                        {busy ? "Solicitando…" : "Continuar"}
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={verifyAccess}>
                      <label htmlFor="customer-token">
                        Código de seis dígitos
                      </label>
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
                      <button
                        className="mi-primary"
                        disabled={busy}
                        type="submit"
                      >
                        {busy
                          ? "Verificando…"
                          : mode === "register"
                            ? "Verificar y crear cuenta"
                            : "Activar tarjeta"}
                      </button>
                      <small className="mi-channel-note">
                        La sesión quedará guardada en este dispositivo y podrás
                        repetir el acceso en otros equipos.
                      </small>
                      <button
                        className="mi-text-button"
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
                          : "Usar otro correo"}
                      </button>
                    </form>
                  )}
                  <p className="mi-access-note">
                    <ShieldCheck size={16} /> Las promociones son opcionales.
                  </p>
                </div>
              )}

              {notice && (
                <div className="mi-message" role="status">
                  {notice}
                </div>
              )}
              {error && (
                <div className="mi-message mi-error" role="alert">
                  {error}
                </div>
              )}

              <div className="mi-install">
                {installed ? (
                  <p>
                    <Check size={18} /> Ya está en tu pantalla de inicio
                  </p>
                ) : (
                  <>
                    <span className="mi-eyebrow">LLÉVALA CONTIGO</span>
                    <h3>Un lugar en tu pantalla.</h3>
                    {install && (
                      <button
                        className="mi-primary"
                        onClick={async () => {
                          try {
                            await install.prompt();
                            await install.userChoice;
                            setInstall(null);
                          } catch {
                            setNotice(
                              "Abre el menú del navegador y elige instalar o agregar a inicio.",
                            );
                          }
                        }}
                      >
                        <Download /> Instalar Mi Vaquero
                      </button>
                    )}
                    <details>
                      <summary>
                        <Smartphone size={19} /> Cómo instalarla{" "}
                        <ChevronRight size={17} />
                      </summary>
                      <p>
                        <strong>iPhone</strong>
                        <br />
                        En Safari, toca Compartir y después “Agregar a pantalla
                        de inicio”.
                      </p>
                      <p>
                        <strong>Android</strong>
                        <br />
                        En el menú del navegador, toca “Instalar aplicación”.
                      </p>
                    </details>
                  </>
                )}
              </div>

              {card && (
                <button
                  className="mi-text-button mi-remove"
                  disabled={busy}
                  onClick={removeCard}
                >
                  <Trash2 size={16} /> Quitar tarjeta de este dispositivo
                </button>
              )}
              <p className="mi-profile-footer">
                MI VAQUERO · {APP_VERSION}
                <br />
                Creado por ProcesaLab
              </p>
            </div>
          </section>
        )}

        {view !== "perfil" && (notice || error) && (
          <div
            className="mi-floating-message"
            role={error ? "alert" : "status"}
          >
            {error || notice}
            <button
              className="mi-icon-button"
              aria-label="Cerrar aviso"
              onClick={() => {
                setError("");
                setNotice("");
              }}
            >
              <X />
            </button>
          </div>
        )}
      </main>

      <nav className="mi-nav" aria-label="Navegación de clientes">
        <button
          onClick={() => navigate("inicio")}
          aria-current={view === "inicio" ? "page" : undefined}
        >
          <Home />
          <span>Inicio</span>
        </button>
        <a
          href="https://www.vaquerosm.com"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Tienda en línea, abre en otra pestaña"
        >
          <ShoppingBag />
          <span>
            Tienda <ArrowUpRight className="mi-external-icon" />
          </span>
        </a>
        <button
          onClick={() => navigate("tarjeta")}
          aria-current={view === "tarjeta" ? "page" : undefined}
        >
          <Barcode />
          <span>Tarjeta</span>
        </button>
        <button
          onClick={() => navigate("perfil")}
          aria-current={view === "perfil" ? "page" : undefined}
        >
          <UserRound />
          <span>Perfil</span>
        </button>
      </nav>

      <dialog
        className="mi-code-dialog"
        ref={dialog}
        onClose={() => setScanning(false)}
        aria-labelledby="mi-code-title"
      >
        <button
          className="mi-icon-button mi-dialog-close"
          aria-label="Cerrar códigos"
          onClick={() => dialog.current?.close()}
        >
          <X />
        </button>
        <span className="mi-eyebrow">VAQUERO SM</span>
        <h2 id="mi-code-title">Tu tarjeta de socio</h2>
        {card && (
          <>
            <MemberCodes memberNumber={card.memberNumber} barcode />
            <p className="mi-member-number">{groupedNumber}</p>
          </>
        )}
        <p>
          Presenta este código en caja.
          <br />
          También puedes dictar tu número de socio.
        </p>
      </dialog>
    </div>
  );
}
