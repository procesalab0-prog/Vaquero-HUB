"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Upload,
  X,
} from "lucide-react";

import type { CatalogImportState } from "@/lib/catalog-import-shared";

type Props = {
  onClose: () => void;
  previewAction: (
    state: CatalogImportState,
    formData: FormData,
  ) => Promise<CatalogImportState>;
  commitAction: (
    state: CatalogImportState,
    formData: FormData,
  ) => Promise<CatalogImportState>;
  initialState: CatalogImportState;
};

export function CatalogImportDialog({
  onClose,
  previewAction,
  commitAction,
  initialState,
}: Props) {
  const router = useRouter();
  const [preview, runPreview, previewPending] = useActionState(
    previewAction,
    initialState,
  );
  const [commit, runCommit, commitPending] = useActionState(
    commitAction,
    initialState,
  );

  useEffect(() => {
    if (commit.phase === "committed") router.refresh();
  }, [commit.phase, router]);

  const ready =
    preview.phase === "preview" &&
    preview.errorCount === 0 &&
    Boolean(preview.payload);

  return (
    <div className="modal-backdrop">
      <section
        className="checkout-modal product-modal import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalog-import-title"
      >
        <header className="modal-heading">
          <div>
            <p className="eyebrow">M2.4 · Carga masiva</p>
            <h2 id="catalog-import-title">Importar productos</h2>
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>

        {commit.phase === "committed" ? (
          <div className="import-complete" role="status">
            <CheckCircle2 aria-hidden="true" />
            <strong>{commit.message}</strong>
            <span>
              {commit.productCount} productos · {commit.variantCount} variantes
            </span>
            <button className="primary-button" type="button" onClick={onClose}>
              Ver catálogo
            </button>
          </div>
        ) : (
          <>
            <div className="import-steps" aria-label="Proceso de importación">
              <span>
                <b>1</b> Descarga
              </span>
              <span>
                <b>2</b> Revisa
              </span>
              <span>
                <b>3</b> Confirma
              </span>
            </div>

            <div className="import-template-card">
              <FileSpreadsheet aria-hidden="true" />
              <div>
                <strong>Usa la plantilla de Mi Tienda SM</strong>
                <span>
                  Un renglón por talla y color. El código debe conservarse como
                  texto.
                </span>
              </div>
              <div className="import-template-actions">
                <a href="/api/productos/plantilla?format=xlsx">
                  Descargar XLSX
                </a>
                <a href="/api/productos/plantilla?format=csv">Descargar CSV</a>
              </div>
            </div>

            <form action={runPreview} className="import-upload-form">
              <label>
                <span>Archivo completado</span>
                <input name="file" type="file" accept=".csv,.xlsx" required />
                <small>CSV o XLSX · máximo 1,000 variantes y 1 MB.</small>
              </label>
              <button
                className="secondary-button"
                type="submit"
                disabled={previewPending}
              >
                <Upload aria-hidden="true" />
                {previewPending ? "Revisando todo…" : "Revisar sin guardar"}
              </button>
            </form>

            {preview.phase !== "idle" ? (
              <div
                className={`import-report ${ready ? "ready" : "has-errors"}`}
                role={ready ? "status" : "alert"}
              >
                <div className="import-report-heading">
                  {ready ? (
                    <CheckCircle2 aria-hidden="true" />
                  ) : (
                    <AlertTriangle aria-hidden="true" />
                  )}
                  <div>
                    <strong>{preview.message}</strong>
                    {preview.totalRows !== undefined ? (
                      <span>
                        {preview.totalRows} filas revisadas ·{" "}
                        {preview.errorCount ?? 0} errores
                      </span>
                    ) : null}
                  </div>
                </div>
                {preview.errors?.length ? (
                  <div className="import-errors">
                    {preview.errors.map((issue, index) => (
                      <div key={`${issue.row}-${issue.code}-${index}`}>
                        <b>Fila {issue.row}</b>
                        <span>{issue.field}</span>
                        <p>{issue.message}</p>
                      </div>
                    ))}
                    {(preview.errorCount ?? 0) > preview.errors.length ? (
                      <p>
                        Se muestran los primeros {preview.errors.length}{" "}
                        errores. Corrígelos y vuelve a revisar.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {ready ? (
              <form action={runCommit} className="import-confirm">
                <input type="hidden" name="payload" value={preview.payload} />
                <p>
                  Esta confirmación creará todo el archivo. Si una fila cambia o
                  entra en conflicto, la operación completa se cancela.
                </p>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={commitPending}
                >
                  {commitPending
                    ? "Importando todo…"
                    : `Importar ${preview.totalRows ?? 0} variantes`}
                </button>
              </form>
            ) : null}

            {commit.phase === "error" ? (
              <div className="admin-status error" role="alert">
                {commit.message}
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
