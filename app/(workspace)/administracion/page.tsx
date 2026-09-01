import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, MapPin, Plus, ShieldCheck, Store, UserRoundCog, Users } from "lucide-react";

import { requirePermission } from "@/lib/auth/authorization";
import { isSupabaseAdminConfigured, isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { createEmployee, saveLocation, updateEmployee } from "./actions";

export const metadata: Metadata = { title: "Administración" };

type Tab = "empleados" | "sucursales" | "roles" | "bitacora";
type Role = { id: string; code: string; name: string; role_permissions?: Array<{ permissions: { code: string; category: string; description: string } | null }> };
type Location = { id: string; code: string; name: string; type: string; address: string | null; phone: string | null; is_active: boolean };
type Employee = { id: string; employee_code: string; full_name: string; email: string | null; is_active: boolean; roles: { id: string; code: string; name: string } | null; user_locations: Array<{ locations: { id: string; name: string } | null }> };
type Audit = { id: number; occurred_at: string; action: string; entity_type: string; entity_id: string | null; app_users: { full_name: string } | null; locations: { name: string } | null };

const tabs: Array<{ id: Tab; label: string; icon: typeof Users }> = [
  { id: "empleados", label: "Empleados", icon: Users },
  { id: "sucursales", label: "Sucursales", icon: Store },
  { id: "roles", label: "Roles y permisos", icon: ShieldCheck },
  { id: "bitacora", label: "Bitácora", icon: ClipboardList },
];

const statusMessages: Record<string, string> = {
  "empleado-creado": "Empleado creado y listo para iniciar sesión.",
  "empleado-actualizado": "Empleado actualizado correctamente.",
  "empleado-error": "No fue posible guardar el empleado. Revisa datos, permisos y configuración.",
  "sucursal-creada": "Sucursal creada correctamente.",
  "sucursal-actualizada": "Sucursal actualizada correctamente.",
  "sucursal-error": "No fue posible guardar la sucursal.",
};

export default async function AdministrationPage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string }> }) {
  const params = await searchParams;
  const tab: Tab = tabs.some((item) => item.id === params.tab) ? params.tab as Tab : "empleados";
  if (!isSupabaseConfigured()) return <AdministrationPreview tab={tab} />;
  await requirePermission(tab === "bitacora" ? "audit.read" : tab === "sucursales" ? "locations.manage" : tab === "roles" ? "roles.manage" : "users.manage");
  const supabase = await createClient();

  const [employeesResult, rolesResult, locationsResult, auditResult] = await Promise.all([
    supabase.from("app_users").select("id, employee_code, full_name, email, is_active, roles(id, code, name), user_locations(locations(id, name))").order("full_name"),
    supabase.from("roles").select("id, code, name, role_permissions(permissions(code, category, description))").order("name"),
    supabase.from("locations").select("id, code, name, type, address, phone, is_active").order("name"),
    supabase.from("audit_log").select("id, occurred_at, action, entity_type, entity_id, app_users!audit_log_actor_user_id_fkey(full_name), locations(name)").order("occurred_at", { ascending: false }).limit(60),
  ]);

  const employees = (employeesResult.data ?? []) as unknown as Employee[];
  const roles = (rolesResult.data ?? []) as unknown as Role[];
  const locations = (locationsResult.data ?? []) as unknown as Location[];
  const audit = (auditResult.data ?? []) as unknown as Audit[];
  const activeLocations = locations.filter((location) => location.is_active && location.type !== "TRANSIT");

  return (
    <section className="module-page admin-page">
      <div className="section-heading"><div><p className="eyebrow">Control seguro</p><h1>Personas, tiendas y permisos</h1><p className="heading-copy">Administra quién puede hacer qué y conserva evidencia de los cambios.</p></div><span className="security-badge"><ShieldCheck aria-hidden="true" />Protegido por RLS</span></div>
      {params.status ? <div className={params.status.endsWith("error") ? "admin-status error" : "admin-status"} role="status">{statusMessages[params.status] ?? "Operación terminada."}</div> : null}
      <nav className="admin-tabs" aria-label="Administración">
        {tabs.map(({ id, label, icon: Icon }) => <Link className={tab === id ? "active" : ""} href={`/administracion?tab=${id}`} key={id}><Icon aria-hidden="true" />{label}</Link>)}
      </nav>

      {tab === "empleados" ? <EmployeesPanel employees={employees} roles={roles} locations={activeLocations} canCreate={isSupabaseAdminConfigured()} /> : null}
      {tab === "sucursales" ? <LocationsPanel locations={locations} /> : null}
      {tab === "roles" ? <RolesPanel roles={roles} /> : null}
      {tab === "bitacora" ? <AuditPanel rows={audit} /> : null}
    </section>
  );
}

function AdministrationPreview({ tab }: { tab: Tab }) {
  return <section className="module-page admin-page"><div className="section-heading"><div><p className="eyebrow">Control seguro</p><h1>Personas, tiendas y permisos</h1><p className="heading-copy">Administra quién puede hacer qué y conserva evidencia de los cambios.</p></div><span className="security-badge"><ShieldCheck aria-hidden="true" />Listo para staging</span></div><div className="admin-status">La interfaz está lista. Los datos reales aparecerán al conectar esta publicación con la base de staging.</div><nav className="admin-tabs" aria-label="Administración">{tabs.map(({ id, label, icon: Icon }) => <Link className={tab === id ? "active" : ""} href={`/administracion?tab=${id}`} key={id}><Icon aria-hidden="true" />{label}</Link>)}</nav><div className="admin-panel"><div className="admin-empty"><ShieldCheck aria-hidden="true" /><strong>Producción sigue protegida</strong><span>Esta vista pública no usa datos reales. La prueba de empleados y sucursales se hará contra staging.</span></div></div></section>;
}

function EmployeesPanel({ employees, roles, locations, canCreate }: { employees: Employee[]; roles: Role[]; locations: Location[]; canCreate: boolean }) {
  return <div className="admin-panel"><div className="admin-panel-heading"><div><h2>Empleados</h2><p>{employees.length} personas registradas · desactivar conserva su historial.</p></div></div>
    <details className="admin-create" open={employees.length === 0}><summary><Plus aria-hidden="true" />Agregar empleado</summary>{canCreate ? <form action={createEmployee} className="admin-form"><label><span>Nombre completo</span><input name="full_name" required /></label><label><span>Código de empleado</span><input name="employee_code" required placeholder="SALOMON01" /></label><label><span>Correo</span><input name="email" type="email" required /></label><label><span>Contraseña temporal</span><input name="password" type="password" minLength={12} required /></label><label><span>Rol</span><select name="role_id" required>{roles.map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}</select></label><label><span>Sucursal inicial</span><select name="location_id" required>{locations.map((location) => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label><button className="primary-button" type="submit">Crear acceso</button></form> : <div className="admin-inline-warning"><strong>Falta la clave secreta del servidor en esta vista previa.</strong><span>Podrás consultar y editar empleados; crear accesos se habilita al conectar la variable segura.</span></div>}</details>
    <div className="admin-list">{employees.map((employee) => <details className="employee-card" key={employee.id}><summary><span className={employee.is_active ? "employee-avatar" : "employee-avatar inactive"}>{employee.full_name.charAt(0)}</span><span><strong>{employee.full_name}</strong><small>{employee.employee_code} · {employee.roles?.name ?? "Sin rol"}</small></span><span className={employee.is_active ? "status-chip good" : "status-chip"}>{employee.is_active ? "Activo" : "Inactivo"}</span></summary><form action={updateEmployee} className="admin-form compact"><input name="id" type="hidden" value={employee.id} /><label><span>Nombre</span><input name="full_name" defaultValue={employee.full_name} required /></label><label><span>Rol</span><select name="role_id" defaultValue={employee.roles?.id}>{roles.map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}</select></label><label className="admin-switch"><span>Empleado activo</span><input name="is_active" type="checkbox" defaultChecked={employee.is_active} /></label><div className="employee-meta"><span><MapPin aria-hidden="true" />{employee.user_locations.map((item) => item.locations?.name).filter(Boolean).join(", ") || "Sin sucursal"}</span><span>{employee.email ?? "Sin correo"}</span></div><button className="primary-button" type="submit">Guardar empleado</button></form></details>)}</div>
  </div>;
}

function LocationsPanel({ locations }: { locations: Location[] }) {
  return <div className="admin-panel"><div className="admin-panel-heading"><div><h2>Sucursales y ubicaciones</h2><p>El inventario, empleados y reportes quedarán separados por ubicación.</p></div></div><details className="admin-create"><summary><Plus aria-hidden="true" />Agregar tienda o bodega</summary><LocationForm /></details><div className="admin-list">{locations.map((location) => <details className="location-card" key={location.id}><summary><span className="branch-mark"><Store aria-hidden="true" /></span><span><strong>{location.name}</strong><small>{location.code} · {location.type === "STORE" ? "Tienda" : location.type === "WAREHOUSE" ? "Bodega" : "Sistema"}</small></span><span className={location.is_active ? "status-chip good" : "status-chip"}>{location.is_active ? "Activa" : "Inactiva"}</span></summary>{location.type === "TRANSIT" ? <div className="admin-inline-warning"><strong>Ubicación protegida del sistema</strong><span>Se usa para traspasos y no se edita desde la interfaz.</span></div> : <LocationForm location={location} />}</details>)}</div></div>;
}

function LocationForm({ location }: { location?: Location }) {
  return <form action={saveLocation} className="admin-form compact">{location ? <input name="id" type="hidden" value={location.id} /> : null}<label><span>Código</span><input name="code" defaultValue={location?.code} required /></label><label><span>Nombre</span><input name="name" defaultValue={location?.name} required /></label><label><span>Tipo</span><select name="type" defaultValue={location?.type ?? "STORE"}><option value="STORE">Tienda</option><option value="WAREHOUSE">Bodega</option></select></label><label><span>Teléfono</span><input name="phone" defaultValue={location?.phone ?? ""} /></label><label className="wide-field"><span>Dirección</span><input name="address" defaultValue={location?.address ?? ""} /></label><label className="admin-switch"><span>Ubicación activa</span><input name="is_active" type="checkbox" defaultChecked={location?.is_active ?? true} /></label><button className="primary-button" type="submit">{location ? "Guardar sucursal" : "Crear sucursal"}</button></form>;
}

function RolesPanel({ roles }: { roles: Role[] }) {
  return <div className="admin-panel"><div className="admin-panel-heading"><div><h2>Roles y permisos</h2><p>La matriz muestra exactamente las acciones autorizadas en el backend.</p></div></div><div className="role-grid">{roles.map((role) => <article key={role.id}><header><span><UserRoundCog aria-hidden="true" /></span><div><strong>{role.name}</strong><code>{role.code}</code></div><b>{role.role_permissions?.length ?? 0}</b></header><div>{Object.entries(groupPermissions(role)).map(([category, permissions]) => <section key={category}><h3>{category}</h3>{permissions.map((permission) => <p key={permission.code}><ShieldCheck aria-hidden="true" /><span><strong>{permission.description}</strong><code>{permission.code}</code></span></p>)}</section>)}</div></article>)}</div><p className="admin-footnote">La edición masiva se habilitará con una operación atómica para evitar dejar un rol a medias.</p></div>;
}

function groupPermissions(role: Role) {
  const groups: Record<string, Array<{ code: string; category: string; description: string }>> = {};
  for (const item of role.role_permissions ?? []) {
    const permission = item.permissions;
    if (!permission) continue;
    (groups[permission.category] ??= []).push(permission);
  }
  return groups;
}

function AuditPanel({ rows }: { rows: Audit[] }) {
  return <div className="admin-panel"><div className="admin-panel-heading"><div><h2>Bitácora</h2><p>Últimos {rows.length} eventos. Estos registros no se pueden editar ni borrar.</p></div></div><div className="audit-list">{rows.map((row) => <article key={row.id}><span className="audit-mark"><ClipboardList aria-hidden="true" /></span><div><strong>{humanAction(row.action)}</strong><small>{row.entity_type}{row.entity_id ? ` · ${row.entity_id.slice(0, 8)}` : ""}</small></div><div><strong>{row.app_users?.full_name ?? "Sistema"}</strong><small>{new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" }).format(new Date(row.occurred_at))}</small></div></article>)}</div>{rows.length === 0 ? <div className="admin-empty"><ClipboardList aria-hidden="true" /><strong>Aún no hay eventos visibles</strong><span>Los cambios administrativos aparecerán aquí.</span></div> : null}</div>;
}

function humanAction(action: string) {
  const labels: Record<string, string> = { "app_users.insert": "Empleado creado", "app_users.update": "Empleado actualizado", "locations.insert": "Sucursal creada", "locations.update": "Sucursal actualizada", "roles.update": "Rol actualizado", "role_permissions.insert": "Permiso agregado", "role_permissions.delete": "Permiso retirado" };
  return labels[action] ?? action.replaceAll(".", " · ");
}
