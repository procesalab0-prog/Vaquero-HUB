import type { Metadata } from "next";
import { Cake, CheckCircle2, ContactRound, Plus, Search, ShieldCheck, Smartphone } from "lucide-react";

import { requirePermission } from "@/lib/auth/authorization";
import { formatCustomerPhone } from "@/lib/customers";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createCustomer, updateCustomer } from "./actions";

export const metadata: Metadata = { title: "Clientes" };

type Customer = {
  id: string;
  member_number: string;
  full_name: string;
  phone_e164: string;
  email: string | null;
  birthdate: string | null;
  auth_user_id: string | null;
  privacy_notice_version: string | null;
  marketing_consent: boolean;
  created_at: string;
};

type Location = { id: string; name: string; code: string };

const statusMessages: Record<string, string> = {
  "cliente-creado": "Cliente registrado y listo para asociarse a una venta.",
  "cliente-actualizado": "Datos del cliente actualizados correctamente.",
  "cliente-duplicado": "Ese teléfono o correo ya pertenece a otro cliente.",
  "cliente-datos-invalidos": "Revisa el nombre y escribe un teléfono mexicano de 10 dígitos.",
  "cliente-aviso-requerido": "Registra la versión exacta del aviso de privacidad que recibió el cliente.",
  "cliente-sucursal-error": "No tienes acceso a la sucursal seleccionada.",
  "cliente-error": "No fue posible guardar el cliente. Revisa permisos y datos.",
};

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const params = await searchParams;
  if (!isSupabaseConfigured()) return <CustomersPreview />;

  const { supabase, userId } = await requirePermission("customers.manage");
  const query = (params.q ?? "").trim();
  const locationsRequest = supabase.from("user_locations").select("locations(id, name, code)").eq("user_id", userId);
  const customerFields = "id, member_number, full_name, phone_e164, email, birthdate, auth_user_id, privacy_notice_version, marketing_consent, created_at";
  let customersData: unknown[] = [];

  if (query.length >= 3) {
    const { data: matches, error: searchError } = await supabase.rpc("search_customers", { p_query: query, p_limit: 20 });
    if (searchError) throw searchError;
    const customerIds = ((matches ?? []) as Array<{ id: string }>).map((customer) => customer.id);
    if (customerIds.length > 0) {
      const { data, error } = await supabase.from("customers").select(customerFields).in("id", customerIds).eq("is_anonymized", false);
      if (error) throw error;
      const rank = new Map<string, number>(customerIds.map((id, index) => [id, index]));
      const detailedCustomers = (data ?? []) as unknown as Customer[];
      customersData = detailedCustomers.toSorted((left, right) => (rank.get(left.id) ?? 99) - (rank.get(right.id) ?? 99));
    }
  } else {
    const { data, error } = await supabase.from("customers").select(customerFields).eq("is_anonymized", false).order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    customersData = data ?? [];
  }

  const { data: locationsData, error: locationsError } = await locationsRequest;
  if (locationsError) throw locationsError;

  const customers = (customersData ?? []) as unknown as Customer[];
  const locations = ((locationsData ?? []) as unknown as Array<{ locations: Location | null }>).map((row) => row.locations).filter((location): location is Location => Boolean(location));
  const statusIsError = Boolean(params.status && !["cliente-creado", "cliente-actualizado"].includes(params.status));

  return (
    <section className="module-page customers-page">
      <div className="section-heading">
        <div><p className="eyebrow">M1B · Identidad del cliente</p><h1>Clientes</h1><p className="heading-copy">Encuentra por teléfono, nombre, correo o número de socio sin elegir primero un tipo de búsqueda.</p></div>
        <span className="security-badge"><ShieldCheck aria-hidden="true" />Datos protegidos por RLS</span>
      </div>

      {params.status ? <div className={statusIsError ? "admin-status error" : "admin-status"} role="status">{statusMessages[params.status] ?? "Operación terminada."}</div> : null}

      <div className="customer-metrics">
        <article><ContactRound aria-hidden="true" /><span><strong>{customers.length}</strong><small>{query ? "resultados" : "clientes recientes"}</small></span></article>
        <article><Smartphone aria-hidden="true" /><span><strong>{customers.filter((customer) => customer.auth_user_id).length}</strong><small>con cuenta activada</small></span></article>
        <article><Cake aria-hidden="true" /><span><strong>{customers.filter((customer) => customer.birthdate?.slice(5, 7) === String(new Date().getMonth() + 1).padStart(2, "0")).length}</strong><small>cumpleaños este mes</small></span></article>
      </div>

      <div className="customers-toolbar">
        <form className="customer-search" action="/clientes">
          <Search aria-hidden="true" /><input name="q" defaultValue={query} placeholder="Teléfono, socio, nombre o correo" aria-label="Buscar clientes" /><button className="secondary-button" type="submit">Buscar</button>
        </form>
        <details className="admin-create customer-create">
          <summary><Plus aria-hidden="true" />Nuevo cliente</summary>
          <form action={createCustomer} className="admin-form">
            <label><span>Nombre completo</span><input name="full_name" required /></label>
            <label><span>Teléfono</span><input name="phone" inputMode="tel" placeholder="352 123 4567" required /></label>
            <label><span>Correo (opcional)</span><input name="email" type="email" /></label>
            <label><span>Fecha de nacimiento (opcional)</span><input name="birthdate" type="date" /></label>
            <label><span>Sucursal de alta</span><select name="location_id" required>{locations.map((location) => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label>
            <label><span>Versión del aviso entregado</span><input name="privacy_notice_version" placeholder="Ej. AV-2026-01" required /></label>
            <div className="wide-field consent-check"><input aria-label="El cliente acepta promociones" name="marketing_consent" type="checkbox" /><span><strong>Acepta promociones</strong><small>Es independiente de participar en el programa de clientes.</small></span></div>
            <p className="privacy-note"><ShieldCheck aria-hidden="true" />Antes de guardar, entrega el aviso de privacidad vigente y registra aquí su versión. No captures clientes reales con un borrador.</p>
            <button className="primary-button" type="submit">Registrar cliente</button>
          </form>
        </details>
      </div>

      <div className="customer-list">
        {customers.map((customer) => (
          <details className="customer-card" key={customer.id}>
            <summary>
              <span className="customer-avatar">{customer.full_name.charAt(0)}</span>
              <span><strong>{customer.full_name}</strong><small>{formatCustomerPhone(customer.phone_e164)} · Socio {customer.member_number}</small></span>
              <span className={customer.auth_user_id ? "status-chip good" : "status-chip"}>{customer.auth_user_id ? "Cuenta activa" : "Sin cuenta"}</span>
            </summary>
            <form action={updateCustomer} className="admin-form compact">
              <input name="customer_id" type="hidden" value={customer.id} />
              <label><span>Nombre</span><input name="full_name" defaultValue={customer.full_name} required /></label>
              <label><span>Teléfono</span><input name="phone" defaultValue={customer.phone_e164} required /></label>
              <label><span>Correo</span><input name="email" type="email" defaultValue={customer.email ?? ""} /></label>
              <label><span>Nacimiento</span><input name="birthdate" type="date" defaultValue={customer.birthdate ?? ""} /></label>
              <div className="wide-field consent-check"><input aria-label={`Promociones para ${customer.full_name}`} name="marketing_consent" type="checkbox" defaultChecked={customer.marketing_consent} /><span><strong>Acepta promociones</strong><small>Puede retirarlo sin perder su número de socio.</small></span></div>
              <div className="customer-meta"><span><CheckCircle2 aria-hidden="true" />Aviso {customer.privacy_notice_version ?? "sin versión"}</span><code>{customer.member_number}</code></div>
              <button className="primary-button" type="submit">Guardar cliente</button>
            </form>
          </details>
        ))}
        {customers.length === 0 ? <div className="admin-empty"><ContactRound aria-hidden="true" /><strong>No encontramos clientes</strong><span>Prueba con al menos tres letras, el teléfono o el número de socio.</span></div> : null}
      </div>
    </section>
  );
}

function CustomersPreview() {
  return <section className="module-page customers-page"><div className="section-heading"><div><p className="eyebrow">M1B · Identidad del cliente</p><h1>Clientes</h1><p className="heading-copy">La interfaz se activa al conectar Supabase.</p></div><span className="security-badge"><ShieldCheck aria-hidden="true" />Listo para staging</span></div><div className="admin-panel"><div className="admin-empty"><ContactRound aria-hidden="true" /><strong>Base de clientes preparada</strong><span>La publicación sin variables no muestra ni almacena datos personales.</span></div></div></section>;
}
