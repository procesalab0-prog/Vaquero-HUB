"use client";

import { useState } from "react";
import Link from "next/link";
import { Barcode, Check, ChevronRight, MonitorCog, Plus, ReceiptText, Save, Store, UserCog } from "lucide-react";
import { useWorkspace } from "@/components/workspace-context";
import { BUSINESS_PROFILE, LA_PIEDAD_STORE } from "@/lib/business-profile";

type Section = "business" | "stores" | "pos" | "tickets" | "labels" | "appearance";
type Branch = { id: number | string; name: string; address: string; register: string };

const tabs: Array<{ id: Section; label: string; description: string; icon: typeof Store }> = [
  { id: "business", label: "Negocio", description: "Nombre y datos comerciales", icon: Store },
  { id: "stores", label: "Sucursales", description: "Tiendas, cajas y ubicaciones", icon: Store },
  { id: "pos", label: "Punto de venta", description: "Venta y operación diaria", icon: MonitorCog },
  { id: "tickets", label: "Tickets", description: "Encabezado, pie y regalos", icon: ReceiptText },
  { id: "labels", label: "Códigos y etiquetas", description: "Formato e impresión", icon: Barcode },
  { id: "appearance", label: "Apariencia y usuarios", description: "Marca, tema y permisos", icon: UserCog },
];
const accentColors: Record<string, string> = { vino: "#8E2A1C", cuero: "#9A5D32", noche: "#241E1B" };

export function SettingsWorkspace() {
  const { activeLocation } = useWorkspace();
  const currentLocation = activeLocation ?? LA_PIEDAD_STORE;
  const [section, setSection] = useState<Section>("business");
  const [branches, setBranches] = useState<Branch[]>([{ id: currentLocation.id, name: currentLocation.name, address: currentLocation.address ?? "Dirección por configurar", register: "Caja 01" }]);
  const [addingBranch, setAddingBranch] = useState(false);
  const [editingBranchId, setEditingBranchId] = useState<number | string | null>(null);
  const [branchName, setBranchName] = useState("");
  const [saved, setSaved] = useState(false);
  const [accent, setAccent] = useState("vino");
  const [preferences, setPreferences] = useState<Record<string, string | boolean>>({});

  function saveSettings() {
    const payload = { version: 1, branches, accent, preferences, savedAt: new Date().toISOString() };
    window.localStorage.setItem("vaquero-hub:design-settings:v1", JSON.stringify(payload));
    setSaved(true);
  }

  function saveBranch() {
    if (!branchName.trim()) return;
    setBranches((current) => editingBranchId
      ? current.map((branch) => branch.id === editingBranchId ? { ...branch, name: branchName.trim() } : branch)
      : [...current, { id: Date.now(), name: branchName.trim(), address: "Dirección por configurar", register: "Sin cajas" }]);
    setBranchName("");
    setAddingBranch(false);
    setEditingBranchId(null);
  }

  function capturePreference(event: React.ChangeEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
    if (!target.name) return;
    setPreferences((current) => ({ ...current, [target.name]: target instanceof HTMLInputElement && target.type === "checkbox" ? target.checked : target.value }));
  }

  function chooseAccent(value: string) {
    setAccent(value);
    document.documentElement.style.setProperty("--accent", accentColors[value]);
  }

  return (
    <section className="module-page settings-page">
      <div className="section-heading"><div><p className="eyebrow">Administración</p><h1>Personaliza Vaquero HUB</h1><p className="heading-copy">Configura cómo se ve y opera el sistema para cada sucursal.</p></div><button className="primary-button" type="button" onClick={saveSettings}><Save aria-hidden="true" />Guardar cambios</button></div>
      <div className="design-mode-notice"><strong>Vista de configuración</strong><span>Los cambios se guardan sólo en este navegador. Cuando conectemos Supabase se aplicarán por negocio, sucursal y permisos del dueño.</span></div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Secciones de ajustes">
          {tabs.map(({ id, label, description, icon: Icon }) => <button className={section === id ? "active" : ""} type="button" key={id} onClick={() => setSection(id)}><Icon aria-hidden="true" /><span><strong>{label}</strong><small>{description}</small></span><ChevronRight aria-hidden="true" /></button>)}
        </nav>
        <div className="settings-panel" onChange={capturePreference}>
          <div hidden={section !== "business"}><BusinessSettings phone={currentLocation.phone ?? ""} address={currentLocation.address ?? ""} /></div>
          <div hidden={section !== "stores"}>
            <SettingsSection eyebrow="Estructura" title="Sucursales y cajas" description="Cada tienda tendrá inventario, cajas, usuarios y reportes independientes.">
              <div className="branch-list">{branches.map((branch) => <article key={branch.id}><span className="branch-mark"><Store aria-hidden="true" /></span><div><strong>{branch.name}</strong><small>{branch.address}</small></div><span><b>{branch.register}</b><small>{branch.id === currentLocation.id ? "Activa" : "Por configurar"}</small></span><button type="button" onClick={() => { setEditingBranchId(branch.id); setBranchName(branch.name); setAddingBranch(true); }}>Editar</button></article>)}</div>
              {addingBranch ? <div className="add-branch"><label><span>Nombre de la sucursal</span><input value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder="Ej. Zamora Centro" /></label><div><button className="secondary-button" type="button" onClick={() => { setAddingBranch(false); setEditingBranchId(null); setBranchName(""); }}>Cancelar</button><button className="primary-button" type="button" onClick={saveBranch}>{editingBranchId ? "Guardar sucursal" : "Agregar sucursal"}</button></div></div> : <button className="dashed-button" type="button" onClick={() => { setEditingBranchId(null); setBranchName(""); setAddingBranch(true); }}><Plus aria-hidden="true" />Agregar otra tienda</button>}
            </SettingsSection>
          </div>
          <div hidden={section !== "pos"}><PosSettings /></div>
          <div hidden={section !== "tickets"}><TicketSettings /></div>
          <div hidden={section !== "labels"}><LabelSettings /></div>
          <div hidden={section !== "appearance"}><AppearanceSettings accent={accent} setAccent={chooseAccent} /></div>
        </div>
      </div>
      {saved ? <div className="pos-toast" role="status"><span><Check aria-hidden="true" /></span>Preferencias guardadas en este navegador<button type="button" onClick={() => setSaved(false)}>Cerrar</button></div> : null}
    </section>
  );
}

function SettingsSection({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: React.ReactNode }) {
  return <section><div className="settings-heading"><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p>{description}</p></div>{children}</section>;
}

function BusinessSettings({ phone, address }: { phone: string; address: string }) {
  return <SettingsSection eyebrow="Datos generales" title="Información del negocio" description="Se utiliza en el sistema, tickets y documentos."><div className="settings-form"><label><span>Nombre comercial</span><input name="businessName" defaultValue={BUSINESS_PROFILE.name} /></label><label><span>Nombre del sistema</span><input name="systemName" defaultValue={BUSINESS_PROFILE.systemName} /></label><label className="wide-field"><span>Razón social</span><input name="legalName" placeholder="Por definir" /></label><label><span>Teléfono</span><input name="phone" defaultValue={phone} /></label><label><span>Moneda</span><select name="currency" defaultValue="MXN"><option value="MXN">MXN · Peso mexicano</option></select></label><label className="wide-field"><span>Dirección</span><input name="address" defaultValue={address} /></label><label><span>Instagram</span><input name="instagram" defaultValue={BUSINESS_PROFILE.instagram} /></label><label><span>Sitio web</span><input name="website" defaultValue={BUSINESS_PROFILE.website} /></label><label className="wide-field"><span>Correo de contacto</span><input name="email" type="email" placeholder="Por definir" /></label></div></SettingsSection>;
}

function PosSettings() {
  return <SettingsSection eyebrow="Operación" title="Preferencias del punto de venta" description="Controles para reducir errores durante una venta."><div className="toggle-list"><Toggle title="Confirmar antes de cobrar" description="Evita dobles toques y cobros accidentales." checked /><Toggle title="Solicitar vendedor" description="Asocia cada venta con el empleado que atendió." /><Toggle title="Permitir descuentos" description="Sólo usuarios con permiso podrán aplicarlos." checked /><Toggle title="Venta sin existencia" description="Recomendamos mantener esta opción desactivada." /><Toggle title="Mostrar carrito siempre" description="Optimizado para iPad en orientación horizontal." checked /></div></SettingsSection>;
}

function TicketSettings() {
  return <SettingsSection eyebrow="Impresión" title="Tickets normales y de regalo" description="Personaliza el contenido que recibe el cliente."><div className="settings-form"><label className="wide-field"><span>Encabezado</span><input name="ticketHeader" defaultValue="VAQUERO SM · LA PIEDAD" /></label><label className="wide-field"><span>Mensaje de agradecimiento</span><textarea name="ticketThanks" defaultValue="Gracias por tu compra. ¡Vuelve pronto!" /></label><label className="wide-field"><span>Mensaje del ticket de regalo</span><textarea name="giftMessage" defaultValue="Este artículo fue elegido especialmente para ti." /></label></div><div className="toggle-list compact"><Toggle title="Mostrar logotipo" description="Incluye la marca al inicio del ticket." checked /><Toggle title="Mostrar política de cambios" description="Texto configurable al pie del comprobante." checked /><Toggle title="Ocultar precios en ticket de regalo" description="Siempre conserva folio y códigos de producto." checked /></div></SettingsSection>;
}

function LabelSettings() {
  return <SettingsSection eyebrow="Identificación" title="Códigos y etiquetas" description="Los códigos heredados de SICAR están protegidos y no se modifican."><div className="settings-form"><label><span>Simbología</span><select name="barcodeFormat" defaultValue="code128"><option value="code128">CODE 128</option><option value="ean13">EAN-13</option></select></label><label><span>Tamaño de etiqueta</span><select name="labelSize" defaultValue="50x30"><option value="50x30">50 × 30 mm</option><option value="40x25">40 × 25 mm</option></select></label><label><span>Impresora</span><select name="labelPrinter" defaultValue="pending"><option value="pending">Por configurar</option></select></label><label><span>Códigos nuevos</span><select name="newCodes" defaultValue="automatic"><option value="automatic">Generación automática</option><option value="manual">Captura manual</option></select></label></div><div className="toggle-list compact"><Toggle title="Incluir precio" description="Muestra el precio de venta vigente." checked /><Toggle title="Incluir talla y color" description="Facilita identificar variantes físicamente." checked /></div></SettingsSection>;
}

function AppearanceSettings({ accent, setAccent }: { accent: string; setAccent: (value: string) => void }) {
  return <SettingsSection eyebrow="Marca y acceso" title="Apariencia y usuarios" description="La marca puede adaptarse sin perder claridad operativa."><div className="theme-options"><button className={accent === "vino" ? "selected vino" : "vino"} type="button" onClick={() => setAccent("vino")}><span /><strong>Vino Vaquero</strong><small>Actual</small></button><button className={accent === "cuero" ? "selected cuero" : "cuero"} type="button" onClick={() => setAccent("cuero")}><span /><strong>Cuero</strong><small>Cálido</small></button><button className={accent === "noche" ? "selected noche" : "noche"} type="button" onClick={() => setAccent("noche")}><span /><strong>Noche</strong><small>Alto contraste</small></button></div><div className="toggle-list"><Toggle title="Mostrar “Powered by ProcesaLab”" description="Visible en acceso y documentos administrativos." checked /><Toggle title="Permitir tema por sucursal" description="Cada tienda puede elegir su acento visual." /></div><div className="permission-note"><UserCog aria-hidden="true" /><div><strong>Usuarios y permisos detallados</strong><p>Administra empleados, sucursales, roles y la bitácora con validación real del servidor.</p></div><Link href="/administracion">Abrir administración</Link></div></SettingsSection>;
}

function Toggle({ title, description, checked = false }: { title: string; description: string; checked?: boolean }) {
  return <label className="toggle-row"><span><strong>{title}</strong><small>{description}</small></span><input name={title} type="checkbox" aria-label={title} defaultChecked={checked} /><i aria-hidden="true" /></label>;
}
