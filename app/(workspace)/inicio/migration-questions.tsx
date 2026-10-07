import Link from "next/link";
import { getWorkspaceSession } from "@/lib/auth/workspace-session";
import { WEB_STAGING_URL } from "@/lib/web-draft";

export async function MigrationQuestions() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== WEB_STAGING_URL) return null;
  const session = await getWorkspaceSession();
  if (!session?.profile?.is_active) return null;
  const { data, error } = await session.supabase.rpc("m9_owner_inbox", {
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
      className="content-card"
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
        <Link
          href={
            pending
              ? "/productos/migracion-dudas"
              : "/productos/migracion-dudas?estado=answered"
          }
        >
          {pending ? "Responder preguntas" : "Ver respuestas"}
        </Link>
      </div>
      <p>
        {pending
          ? "Son preguntas cortas por modelo, con ejemplos. Se irán descontando al responder; las demás se enviarán después."
          : "Revisaremos las aclaraciones antes de enviar otra tanda."}
      </p>
      <p>
        {data.summary.answered} de {data.summary.questions} respuestas
        recibidas. Responder no cambia productos ni existencias.
      </p>
    </section>
  );
}
