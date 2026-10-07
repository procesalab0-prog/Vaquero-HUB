import { describe, expect, it } from "vitest";
import { workspaceNoteError } from "../../lib/workspace-notes";

describe("mensajes de notas", () => {
  it("explica un conflicto y no oculta la edición de otra ventana", () => {
    expect(workspaceNoteError("NOTE_CHANGED")).toContain("otra ventana");
  });
  it("explica autoría, privacidad y alcance", () => {
    expect(workspaceNoteError("NOTE_NOT_EDITABLE")).toContain("quien escribió");
    expect(workspaceNoteError("NOTE_SCOPE_IMMUTABLE")).toContain("privacidad");
    expect(workspaceNoteError("LOCATION_NOT_ALLOWED")).toContain("sucursal");
  });
  it("no filtra errores internos al usuario", () => {
    expect(workspaceNoteError("secret_sql_details")).not.toContain(
      "secret_sql",
    );
    expect(workspaceNoteError("secret_sql_details")).toContain("se conserva");
  });
});
