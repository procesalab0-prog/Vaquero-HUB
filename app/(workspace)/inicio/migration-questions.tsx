import Link from "next/link";
import styles from "./migration-questions.module.css";
import { getWorkspaceSession } from "@/lib/auth/workspace-session";

export async function MigrationQuestions() {
  const session = await getWorkspaceSession();
  if (!session?.profile?.is_active) return null;
  const { data, error } = await session.supabase.rpc("main_m9_owner_inbox", {
    p_query: "",
    p_department: "",
    p_state: "pending",
    p_priority: false,
    p_page: 1,
  });
  // Missing migration/permissions must never break the daily dashboard.
  if (error || !data?.summary?.questions) return null;
  const pending = data.summary.questions - data.summary.answered;
  return (
    <section
      className={`content-card ${styles.card}`}
      aria-labelledby="migration-questions-title"
    >
      <div className="card-heading">
        <div>
          <p className="eyebrow">
            Ayúdanos con la migración · Tanda {data.summary.batch}
          </p>
          <h2 id="migration-questions-title">
            {pending
              ? `${pending} preguntas por responder`
              : "Gracias, esta tanda ya tiene respuesta"}
          </h2>
        </div>
      </div>
      <p>
        {pending
          ? "Son preguntas cortas por modelo, con ejemplos. Se irán descontando al responder; las demás se enviarán después."
          : "Revisaremos las aclaraciones antes de enviar otra tanda."}
      </p>
      <div className={styles.actions}>
        <Link
          className="primary-button"
          href={
            pending
              ? "/productos/migracion-dudas"
              : "/productos/migracion-dudas?estado=answered"
          }
        >
          {pending
            ? "Responder preguntas ahora →"
            : "Ver respuestas guardadas →"}
        </Link>
        {pending > 0 && (
          <Link
            className="secondary-button"
            href="/productos/migracion-dudas?estado=answered"
          >
            Ver respuestas guardadas
          </Link>
        )}
      </div>
      <p>
        {data.summary.answered} de {data.summary.questions} respuestas
        recibidas. Responder no cambia productos ni existencias.
      </p>
    </section>
  );
}
