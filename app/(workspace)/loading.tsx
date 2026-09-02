export default function WorkspaceLoading() {
  return (
    <section className="workspace-loading" aria-live="polite" aria-busy="true">
      <span className="workspace-loading-mark" aria-hidden="true" />
      <div>
        <strong>Abriendo sección</strong>
        <small>Preparando la información de la tienda…</small>
      </div>
    </section>
  );
}
