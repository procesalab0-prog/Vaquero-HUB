"use client";
import { useActionState } from "react";
export function ContentionProbe({
  trialId,
  runProbeAction,
}: {
  trialId: string;
  runProbeAction: (previous: string, form: FormData) => Promise<string>;
}) {
  const [holder, hold, holding] = useActionState(runProbeAction, "");
  const [contender, contend, contending] = useActionState(runProbeAction, "");
  return (
    <section aria-label="Comprobación técnica simultánea">
      <h2>Ensayo técnico entre dos conexiones</h2>
      <p>
        Sólo funciona durante una ventana privada de dos minutos. Todas las
        piezas son sintéticas y los movimientos se revierten.
      </p>
      <form action={hold}>
        <input type="hidden" name="trial_id" value={trialId} />
        <input type="hidden" name="phase" value="HOLDER" />
        <button className="button secondary" disabled={holding}>
          {holding
            ? "Reserva en curso…"
            : "Reservar pieza sintética durante seis segundos"}
        </button>
        <output
          aria-live="polite"
          style={{ display: "block", overflowWrap: "anywhere" }}
        >
          {holder}
        </output>
      </form>
      <form action={contend}>
        <input type="hidden" name="trial_id" value={trialId} />
        <input type="hidden" name="phase" value="CONTENDER" />
        <button className="button secondary" disabled={contending}>
          {contending
            ? "Comprobando bloqueo…"
            : "Intentar salida de caja simultánea"}
        </button>
        <output
          aria-live="polite"
          style={{ display: "block", overflowWrap: "anywhere" }}
        >
          {contender}
        </output>
      </form>
    </section>
  );
}
