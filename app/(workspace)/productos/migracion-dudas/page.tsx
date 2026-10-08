import { redirect } from "next/navigation";
import { WEB_STAGING_URL } from "@/lib/web-draft";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/authorization";
const reviewMoney = (cents: number | null, fallback: string) =>
  cents === null
    ? fallback
    : new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: "MXN",
      }).format(cents / 100);
import { saveOwnerAnswer } from "./actions";
import styles from "./review.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Preguntas de la migración" };
type Inbox = {
  cut_sha: string;
  can_answer: boolean;
  total: number;
  page: number;
  page_size: number;
  summary: {
    questions: number;
    covered_rows: number;
    answered: number;
    unsure: number;
    priority_questions: number;
    batch: number;
  };
  departments: string[];
  rows: {
    question_id: string;
    title: string;
    question: string;
    help: string;
    department: string;
    section: string;
    priority: boolean;
    previously_consulted: boolean;
    current_evidence: boolean;
    revision: number;
    members: {
      barcode: string;
      size: string;
      source_evidence: { description: string; price_cents: number | null };
    }[];
    answer: null | {
      choice: string;
      note: string;
      commercial_name: string;
      created_at: string;
    };
  }[];
};
const choices: Record<string, string> = {
  SAME_MODEL: "Sí, es el mismo modelo y sólo cambia la talla",
  CORRECTION: "Hay algo que corregir",
  UNSURE: "No lo sé todavía",
};
export default async function OwnerQuestionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase } = await requirePermission("products.read");
  if (process.env.NEXT_PUBLIC_SUPABASE_URL === WEB_STAGING_URL)
    redirect("https://vaquero-hub.vercel.app/productos/migracion-dudas");
  const params = await searchParams;
  const value = (name: string, fallback = "") =>
    typeof params[name] === "string" ? (params[name] as string) : fallback;
  const q = value("q"),
    department = value("departamento"),
    state = value("estado", "pending"),
    priority = false,
    page = Number(value("page", "1"));
  if (
    q.length > 160 ||
    department.length > 100 ||
    !["all", "pending", "answered", "unsure"].includes(state) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 10000
  )
    return (
      <section>
        <h1>Revisa los filtros</h1>
        <Link href="/productos/migracion-dudas">Volver a las preguntas</Link>
      </section>
    );
  const { data, error } = await supabase.rpc("main_m9_owner_inbox", {
    p_query: q,
    p_department: department,
    p_state: state,
    p_priority: priority,
    p_page: page,
  });
  if (error || !data)
    return (
      <section>
        <h1>Preguntas de la migración</h1>
        <p>No se pudo cargar la revisión. Intenta de nuevo.</p>
      </section>
    );
  const inbox = data as Inbox,
    pages = Math.ceil(inbox.total / inbox.page_size);
  const href = (next: number) =>
    `/productos/migracion-dudas?${new URLSearchParams({ q, departamento: department, estado: state, alcance: priority ? "prioridad" : "todos", page: String(next) })}`;
  const messages: Record<string, string> = {
    guardado:
      "Respuesta guardada. Revisaremos la evidencia antes de incorporar el modelo; no se publicó ni se cambió ningún producto.",
    cambio:
      "Otra persona respondió o cambió la evidencia. Revisa la respuesta actual antes de volver a guardar.",
    incompleto:
      "Faltó completar la respuesta. Si hay una corrección, describe brevemente qué cambia.",
    error: "No se confirmó el guardado. Revisa tu permiso e intenta de nuevo.",
  };
  return (
    <section className={`${styles.review} ${styles.questions}`}>
      <header>
        <Link href="/inicio">← Volver al Inicio</Link>
        <h1>Preguntas de la migración</h1>
        <p>Sólo tres preguntas por tanda, con ejemplos y las tallas juntas.</p>
        <p>
          Tanda {inbox.summary.batch} ·{" "}
          {inbox.summary.questions - inbox.summary.answered} preguntas por
          responder · {inbox.summary.answered} respuestas recibidas
          {inbox.summary.unsure
            ? ` · ${inbox.summary.unsure} por consultar`
            : ""}
        </p>
        <p>
          Responde sólo estas tarjetas. Las demás preguntas se enviarán después.
          «No lo sé todavía» deja la pregunta pendiente para consultarla.
        </p>
      </header>
      {messages[value("resultado")] && (
        <p role="status">{messages[value("resultado")]}</p>
      )}
      <form
        key={href(page)}
        method="get"
        action="/productos/migracion-dudas"
        className={styles.filters}
      >
        <label>
          Buscar modelo o código
          <input name="q" defaultValue={q} maxLength={160} />
        </label>
        <label>
          Departamento
          <select name="departamento" defaultValue={department}>
            <option value="">Todos</option>
            {inbox.departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>

        <label>
          Estado
          <select name="estado" defaultValue={state}>
            <option value="pending">Sin responder</option>
            <option value="answered">Con respuesta</option>
            <option value="unsure">Por consultar</option>
            <option value="all">Todos</option>
          </select>
        </label>
        <button type="submit" className="primary-button">
          Ver preguntas
        </button>
        <Link href="/productos/migracion-dudas">Limpiar</Link>
      </form>
      <p role="status">
        {inbox.total} preguntas encontradas
        {inbox.total ? ` · Página ${page} de ${pages}` : ""}
      </p>
      {!inbox.rows.length && (
        <p>
          No hay preguntas con estos filtros. Puedes ver las respuestas
          guardadas.
        </p>
      )}
      <div className={styles.cards}>
        {inbox.rows.map((item) => (
          <article
            key={`${item.question_id}:${item.revision}`}
            className={styles.card}
          >
            <h2>
              {item.section} · Modelo {item.title}
            </h2>
            <p>
              {item.department} · {item.members.length} tallas/códigos
            </p>
            <h3>{item.question}</h3>
            <p>
              Si también cambia el color, la línea o el modelo, elige «Hay algo
              que corregir» y explica la diferencia.
            </p>
            <p>
              <strong>Ejemplos:</strong>{" "}
              {item.members
                .slice(0, 3)
                .map((m) => `talla ${m.size}`)
                .join(" · ")}
              . La pregunta incluye todas las tallas de esta tarjeta.
            </p>
            <p>
              <strong>Tallas propuestas:</strong>{" "}
              {item.members.map((m) => m.size).join(", ")}
            </p>
            <p>
              <strong>Precios públicos SICAR:</strong>{" "}
              {[
                ...new Set(
                  item.members.map((m) =>
                    reviewMoney(m.source_evidence.price_cents, "Por revisar"),
                  ),
                ),
              ].join(" · ")}
            </p>
            {item.previously_consulted && (
              <p>
                Esta consulta ya se había enviado y sigue pendiente. Aquí puede
                quedar la respuesta para todos.
              </p>
            )}
            <details>
              <summary>Ver códigos y tallas de este modelo</summary>
              <ul>
                {item.members.map((m) => (
                  <li key={m.barcode}>
                    Talla {m.size} · Código {m.barcode} ·{" "}
                    {m.source_evidence.description} ·{" "}
                    {reviewMoney(m.source_evidence.price_cents, "Por revisar")}
                  </li>
                ))}
              </ul>
            </details>
            {item.answer && (
              <div>
                <h3>Última respuesta guardada</h3>
                <p>
                  {choices[item.answer.choice]}
                  {item.answer.commercial_name
                    ? ` · Nombre: ${item.answer.commercial_name}`
                    : ""}
                </p>
                {item.answer.note && <p>{item.answer.note}</p>}
                <p>
                  Guardada el{" "}
                  {new Date(item.answer.created_at).toLocaleString("es-MX", {
                    timeZone: "America/Mexico_City",
                  })}
                  . Pendiente de revisión técnica.
                </p>
              </div>
            )}
            {!item.current_evidence ? (
              <p>
                Los datos cambiaron. Hay que preparar de nuevo esta pregunta
                antes de responder.
              </p>
            ) : !inbox.can_answer ? (
              <p>
                Tu usuario puede consultar. Para responder necesitas permiso de
                edición de productos.
              </p>
            ) : (
              <form action={saveOwnerAnswer} className={styles.answer}>
                <input type="hidden" name="cut_sha" value={inbox.cut_sha} />
                <input
                  type="hidden"
                  name="question_id"
                  value={item.question_id}
                />
                <input type="hidden" name="revision" value={item.revision} />
                <input
                  type="hidden"
                  name="request_id"
                  value={crypto.randomUUID()}
                />
                <fieldset>
                  <legend>
                    {item.answer ? "Actualizar aclaración" : "Tu respuesta"}
                  </legend>
                  {Object.entries(choices).map(([key, label]) => (
                    <label key={key}>
                      <input
                        type="radio"
                        name="choice"
                        value={key}
                        defaultChecked={item.answer?.choice === key}
                        required
                      />{" "}
                      {label}
                    </label>
                  ))}
                </fieldset>
                <label>
                  Nombre para mostrar en el programa (opcional)
                  <input
                    name="commercial_name"
                    maxLength={200}
                    defaultValue={item.answer?.commercial_name ?? ""}
                    placeholder="Por ejemplo: Pantalón Rodeo West de niño, modelo NX403"
                  />
                </label>
                <label>
                  Aclaración (obligatoria si hay algo que corregir)
                  <textarea
                    name="note"
                    maxLength={2000}
                    rows={3}
                    defaultValue={item.answer?.note ?? ""}
                    placeholder="Por ejemplo: son dos modelos; las tallas 4 y 6 pertenecen al azul."
                  />
                </label>
                <button type="submit" className="primary-button">
                  {item.answer
                    ? "Guardar aclaración actualizada"
                    : "Guardar respuesta"}
                </button>
              </form>
            )}
          </article>
        ))}
      </div>
      <nav aria-label="Páginas de preguntas" className={styles.pagination}>
        {page > 1 && <Link href={href(page - 1)}>← Anterior</Link>}
        {page < pages && <Link href={href(page + 1)}>Siguiente →</Link>}
      </nav>
    </section>
  );
}
