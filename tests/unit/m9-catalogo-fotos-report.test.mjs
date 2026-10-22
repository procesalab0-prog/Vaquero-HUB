import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { runCatalogPhotoReport } from "../../scripts/m9/catalogo-fotos-reporte.mjs";
async function fixture(dir) {
  const audit = {
    m9_rows: { rows: 7 },
    evidence: { rows: 4 },
    copies: { rows: 3 },
  };
  const files = {
    before: audit,
    after: audit,
    bindings: [],
    contexts: [],
    coverage: [
      {
        coverage: {
          linked_woo: 6,
          sicar_only: 1,
          linked_simple: 1,
          without_evidence: 1,
          nonempty_without_copy: 0,
          copies_wrong_hash: 0,
        },
      },
    ],
    gaps: [
      [
        "0007779",
        "de04cd57-d246-42e0-a61c-11a170ca3df4",
        "001f9757-61be-44e0-852c-8b0b38a486e9",
        42,
        101,
        "",
      ],
    ],
    metadata: [
      {
        nonempty_evidence: 3,
        copied: 3,
        exact_metadata_and_reader: 3,
        object_problems: 0,
        mapping_problems: 0,
        identity_problems: 0,
      },
    ],
    woo: {
      pagination_complete: true,
      products: [
        {
          id: 42,
          status: "publish",
          type: "variable",
          variations: [{ id: 101, status: "publish", images: "" }],
        },
      ],
    },
  };
  const inputs = {};
  for (const [name, obj] of Object.entries(files)) {
    const content = JSON.stringify(obj);
    await writeFile(join(dir, name + ".json"), content);
    inputs[name] = {
      path: name + ".json",
      sha256: createHash("sha256").update(content).digest("hex"),
    };
  }
  const path = join(dir, "config.json");
  await writeFile(
    path,
    JSON.stringify({
      project_id: "zsezjtswqeijboezvado",
      observed_at: "SYNTHETIC_TEST",
      woo_export_date: "SYNTHETIC_TEST",
      inputs,
    }),
  );
  return path;
}
describe("private immutable catalog report", () => {
  it("refuses to overwrite an old run and preserves its manifest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "m9-photo-report-"));
    try {
      const config = await fixture(dir),
        out = join(dir, "run");
      await runCatalogPhotoReport(config, out);
      const before = await readFile(join(out, "manifest.json"), "utf8");
      await expect(runCatalogPhotoReport(config, out)).rejects.toThrow(
        "EEXIST",
      );
      expect(await readFile(join(out, "manifest.json"), "utf8")).toBe(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("rejects a changed pinned input before creating a run directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "m9-photo-report-"));
    try {
      const config = await fixture(dir);
      await writeFile(join(dir, "gaps.json"), "[]");
      await expect(
        runCatalogPhotoReport(config, join(dir, "run")),
      ).rejects.toThrow("INPUT_SHA_CHANGED:gaps");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
