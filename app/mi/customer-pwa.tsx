"use client";

import { CheckCircle2, CloudOff, Download, LogOut, Mail, RefreshCw, ShieldCheck, Smartphone, Trash2, Wifi } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { parseCustomerIdentifier } from "@/lib/customer-access";
import { CUSTOMER_CARD_STORAGE_KEY, parseOfflineCustomerCard, serializeOfflineCustomerCard } from "@/lib/customer-card-storage";
import { createCustomerClient } from "@/lib/supabase/customer-client";

type CardData = { memberNumber: string; fullName: string | null };
type CustomerPwaProps = { configured: boolean; phoneOtpEnabled: boolean };

export function CustomerPwa({ configured, phoneOtpEnabled }: CustomerPwaProps) {
  const clientRef = useRef<ReturnType<typeof createCustomerClient> | null>(null);
  const barcodeRef = useRef<SVGSVGElement>(null);
  const [card, setCard] = useState<CardData | null>(null);
  const [qr, setQr] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [token, setToken] = useState("");
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
    if (!record?.member_number) throw new Error("CUSTOMER_CARD_NOT_LINKED");
    const nextCard = { memberNumber: record.member_number as string, fullName: record.full_name as string };
    localStorage.setItem(CUSTOMER_CARD_STORAGE_KEY, serializeOfflineCustomerCard(nextCard.memberNumber));
    setCard(nextCard);
  }, []);

  useEffect(() => {
    const hydrateTimer = window.setTimeout(() => {
      setOnline(navigator.onLine);
      const cached = parseOfflineCustomerCard(localStorage.getItem(CUSTOMER_CARD_STORAGE_KEY));
      if (cached) {
        localStorage.setItem(CUSTOMER_CARD_STORAGE_KEY, serializeOfflineCustomerCard(cached.memberNumber));
        setCard({ memberNumber: cached.memberNumber, fullName: null });
      }
    }, 0);

    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      const scope = window.location.pathname.startsWith("/mi") ? "/mi" : "/";
      navigator.serviceWorker.register("/mi/sw.js", { scope }).catch(() => undefined);
    }

    if (!configured) return () => {
      window.clearTimeout(hydrateTimer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };

    const client = createCustomerClient();
    clientRef.current = client;
    loadOnlineCard().catch(() => setError("No pudimos actualizar tu tarjeta. La copia guardada sigue disponible."));
    const { data: listener } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") window.setTimeout(() => loadOnlineCard().catch(() => setError("Tu acceso se confirmó, pero falta vincular la tarjeta.")), 0);
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
    Promise.all([import("qrcode"), import("jsbarcode")]).then(async ([qrModule, barcodeModule]) => {
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
    }).catch(() => setQr(""));
    return () => { cancelled = true; };
  }, [card?.memberNumber]);

  async function requestAccess(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const parsed = parseCustomerIdentifier(identifier);
    if (!parsed) return setError("Escribe un teléfono mexicano o correo válido.");
    if (parsed.channel === "phone" && !phoneOtpEnabled) return setError("El acceso por SMS aún no está activado. Usa el correo registrado en tienda.");
    setBusy(true);
    try {
      const response = await fetch("/api/mi/acceso", {
        body: JSON.stringify({ identifier }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json() as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "INVALID_IDENTIFIER");
      setStep("verify");
      setNotice(parsed.channel === "email"
        ? "Revisa tu correo y escribe aquí el código de seis dígitos. El enlace también puede abrir Mi Vaquero en el dispositivo donde lo pulses."
        : "Escribe el código de seis dígitos que enviamos por SMS.");
    } catch (requestError) {
      setError(requestError instanceof Error && requestError.message !== "INVALID_IDENTIFIER" ? requestError.message : "No fue posible solicitar el acceso.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyAccess(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const client = clientRef.current;
    const parsed = parseCustomerIdentifier(identifier);
    if (!client || !parsed || !/^\d{6}$/.test(token)) return setError("Escribe el código completo de seis dígitos.");
    setBusy(true);
    try {
      const result = parsed.channel === "phone"
        ? await client.auth.verifyOtp({ phone: parsed.value, token, type: "sms" })
        : await client.auth.verifyOtp({ email: parsed.value, token, type: "email" });
      if (result.error) throw result.error;
      await loadOnlineCard();
      setNotice("Tarjeta activada en este dispositivo.");
      setToken("");
    } catch {
      setError("El código no es válido o ya venció. Solicita uno nuevo.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await clientRef.current?.auth.signOut();
    setAuthenticated(false);
    setNotice("Cerraste sesión. Tu número de socio sigue disponible sin conexión.");
  }

  async function removeCard() {
    if (!window.confirm("¿Quitar esta tarjeta del dispositivo? Después necesitarás volver a verificar tu acceso.")) return;
    await clientRef.current?.auth.signOut();
    localStorage.removeItem(CUSTOMER_CARD_STORAGE_KEY);
    setCard(null);
    setAuthenticated(false);
    setStep("identify");
    setNotice("La tarjeta se quitó únicamente de este dispositivo.");
  }

  return <main className="mi-app">
    <header className="mi-header">
      <Image src="/brand/logo-vaquerosm-blanco.png" alt="Vaquero SM" width={188} height={68} priority />
      <span className={online ? "mi-connectivity online" : "mi-connectivity"}>{online ? <Wifi aria-hidden="true" /> : <CloudOff aria-hidden="true" />}{online ? "En línea" : "Sin conexión"}</span>
    </header>

    <section className="mi-content">
      {card ? <>
        <div className="mi-title"><p>Tarjeta digital</p><h1>{card.fullName ? `Hola, ${card.fullName.split(" ")[0]}` : "Mi tarjeta Vaquero"}</h1><span>{authenticated ? "Información actualizada" : "Disponible sin iniciar sesión"}</span></div>
        <article className="member-card">
          <div className="member-card-brand"><Image src="/brand/emblema-blanco.png" alt="" width={52} height={52} /><span>VAQUERO SM</span></div>
          <div className="member-qr">{qr ? <Image src={qr} alt={`Código QR del socio ${card.memberNumber}`} width={280} height={280} unoptimized /> : <span>Generando QR…</span>}</div>
          <div className="member-number"><small>NÚMERO DE SOCIO</small><strong>{card.memberNumber.slice(0, 4)} {card.memberNumber.slice(4)}</strong></div>
          <div className="member-barcode"><svg ref={barcodeRef} role="img" aria-label={`Código de barras del socio ${card.memberNumber}`} /></div>
        </article>

        <div className="mi-safe-note"><ShieldCheck aria-hidden="true" /><span><strong>Funciona sin internet</strong><small>Este dispositivo conserva únicamente tu número de socio. Tus datos personales no se guardan aquí.</small></span></div>
        <div className="mi-program-status"><CheckCircle2 aria-hidden="true" /><span><strong>Identidad lista</strong><small>Los puntos, recompensas e historial se activarán cuando Vaquero SM confirme sus reglas.</small></span></div>
        <div className="mi-actions">
          {authenticated ? <button type="button" onClick={() => loadOnlineCard().catch(() => setError("No fue posible actualizar la tarjeta."))}><RefreshCw aria-hidden="true" />Actualizar</button> : null}
          {authenticated ? <button type="button" onClick={signOut}><LogOut aria-hidden="true" />Cerrar sesión</button> : null}
          <button className="danger" type="button" onClick={removeCard}><Trash2 aria-hidden="true" />Quitar del dispositivo</button>
        </div>
      </> : <>
        <div className="mi-title"><p>Vaquero SM</p><h1>Tu tarjeta siempre contigo</h1><span>Identifícate en caja con QR, código de barras o número de socio.</span></div>
        <div className="mi-access-card">
          <div className="mi-access-icon"><Smartphone aria-hidden="true" /></div>
          <h2>Activar mi tarjeta</h2>
          <p>Usa el teléfono o correo que registraste en tienda. Nunca te pediremos una contraseña.</p>
          {!configured ? <div className="mi-message error">El acceso se habilitará al conectar Supabase.</div> : step === "identify" ? <form onSubmit={requestAccess}>
            <label htmlFor="customer-identifier">Teléfono o correo</label>
            <div className="mi-input"><Mail aria-hidden="true" /><input id="customer-identifier" value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" inputMode="text" placeholder="correo@ejemplo.com" /></div>
            <button className="mi-primary" disabled={busy} type="submit">{busy ? "Solicitando…" : "Continuar"}</button>
            {!phoneOtpEnabled ? <small className="mi-channel-note">SMS pendiente de configuración. El acceso por correo ya está preparado.</small> : null}
          </form> : <form onSubmit={verifyAccess}>
            <label htmlFor="customer-token">Código de seis dígitos</label>
            <input className="mi-code-input" id="customer-token" value={token} onChange={(event) => setToken(event.target.value.replace(/\D/g, "").slice(0, 6))} autoComplete="one-time-code" inputMode="numeric" placeholder="000000" />
            <button className="mi-primary" disabled={busy} type="submit">{busy ? "Verificando…" : "Activar tarjeta"}</button>
            <small className="mi-channel-note">La sesión quedará guardada en este dispositivo. Puedes repetir este acceso en otros equipos.</small>
            <button className="mi-link-button" type="button" onClick={() => { setStep("identify"); setToken(""); setNotice(""); }}>Usar otro teléfono o correo</button>
          </form>}
          <p className="mi-privacy"><ShieldCheck aria-hidden="true" />El acceso no te registra para recibir promociones.</p>
        </div>
      </>}

      {notice ? <div className="mi-message" role="status">{notice}</div> : null}
      {error ? <div className="mi-message error" role="alert">{error}</div> : null}

      <details className="mi-install">
        <summary><Download aria-hidden="true" />Guardar en mi pantalla de inicio</summary>
        <div><strong>En iPhone</strong><span>Abre esta página en Safari, toca Compartir y elige “Agregar a inicio”.</span><strong>En Android</strong><span>Abre el menú del navegador y selecciona “Instalar aplicación”.</span></div>
      </details>
    </section>
    <footer>Mi Vaquero · Creado por ProcesaLab</footer>
  </main>;
}
