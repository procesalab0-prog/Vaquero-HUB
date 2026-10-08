"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceNote, SaveWorkspaceNoteInput, SaveWorkspaceNoteResult } from "@/lib/workspace-notes";

export function WorkspaceNotes({ notes, userId, locationId, locationName, available, loadError, saveAction }: {
  notes: WorkspaceNote[]; userId: string | null; locationId: string | null;
  locationName: string; available: boolean; loadError?: string;
  saveAction: (input: SaveWorkspaceNoteInput) => Promise<SaveWorkspaceNoteResult>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<WorkspaceNote | null>(null);
  const [body, setBody] = useState("");
  const [scope, setScope] = useState("personal");
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);

  function reset() {
    setEditing(null); setBody(""); setScope("personal");
  }

  return <section className="content-card workspace-notes" aria-labelledby="workspace-notes-title">
    <div className="card-heading"><div><p className="eyebrow">Recordatorios</p><h2 id="workspace-notes-title">Notas rápidas</h2></div>
      <button className="secondary-button" type="button" disabled={pending || !available} onClick={() => router.refresh()}>Actualizar notas</button>
    </div>
    {!available ? <p className="empty-copy">Inicia sesión en una tienda conectada para guardar notas.</p> : null}
    {loadError ? <p className="inline-error" role="alert">{loadError}</p> : null}
    {feedback ? <p className={feedback.error ? "inline-error" : "notice-banner"} role={feedback.error ? "alert" : "status"}>{feedback.message}</p> : null}
    <form className="workspace-note-form" onSubmit={(event) => {
      event.preventDefault();
      if (submitting.current || !available) return;
      submitting.current = true;
      startTransition(async () => {
        try {
          const result = await saveAction({ body, locationId: scope === "shared" ? locationId : null, id: editing?.id, revision: editing?.revision });
          if (!result.ok) { setFeedback({ error: true, message: result.message }); return; }
          reset(); setFeedback({ error: false, message: "Nota guardada." }); router.refresh();
        } catch {
          setFeedback({ error: true, message: "No fue posible guardar la nota. Tu texto se conserva para intentarlo de nuevo." });
        } finally { submitting.current = false; }
      });
    }}>
      <label>Visibilidad<select value={scope} disabled={!available || pending || Boolean(editing)} onChange={(event) => setScope(event.target.value)}>
        <option value="personal">Personal · sólo yo</option>
        <option value="shared" disabled={!locationId}>Compartida · {locationName}</option>
      </select></label>
      <label className="workspace-note-body">{editing ? "Editar mi nota" : "Nueva nota"}<textarea value={body} required maxLength={2000} rows={3} disabled={!available || pending} onChange={(event) => setBody(event.target.value)} /></label>
      <div className="workspace-note-actions"><small>{body.length}/2,000 · Las notas personales no se comparten con administración.</small>
        {editing ? <button type="button" className="secondary-button" disabled={pending} onClick={reset}>Cancelar edición</button> : null}
        <button type="submit" className="primary-button" disabled={!available || pending || !body.trim()}>{pending ? "Guardando…" : editing ? "Guardar cambios" : "Guardar nota"}</button>
      </div>
    </form>
    <div className="workspace-note-list">
      {notes.map((note) => <article key={note.id} className="workspace-note">
        <div className="workspace-note-meta"><strong>{note.location_id ? `Compartida · ${locationName}` : "Personal · sólo yo"}</strong>
          {note.author_user_id === userId ? <button type="button" className="secondary-button" disabled={pending} onClick={() => { setEditing(note); setBody(note.body); setScope(note.location_id ? "shared" : "personal"); setFeedback(null); }}>Editar nota</button> : null}
        </div>
        <p>{note.body}</p>
        <small>{note.author_name} · {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" }).format(new Date(note.updated_at))}</small>
      </article>)}
      {available && !loadError && !notes.length ? <p className="empty-copy">No hay notas personales ni compartidas en esta sucursal.</p> : null}
      {notes.length === 100 ? <p className="empty-copy">Se muestran las 100 notas más recientes.</p> : null}
    </div>
  </section>;
}
