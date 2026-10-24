import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  buildPilotCountWorksheet,
  renderPilotCountWorksheet,
} from "../../lib/pilot-count-worksheet.mjs";
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
export function preparePilotCountWorksheet(configPath, output) {
  const config = JSON.parse(readFileSync(configPath));
  if (
    config.project_id !== "zsezjtswqeijboezvado" ||
    config.mode !== "READ_ONLY_BLANK_COUNT_WORKSHEET" ||
    typeof config.input?.path !== "string" ||
    !/^[a-f0-9]{64}$/.test(config.input?.sha256 ?? "")
  )
    throw Error("PILOT_WORKSHEET_PIN_REQUIRED");
  const raw = readFileSync(resolve(dirname(configPath), config.input.path));
  if (sha(raw) !== config.input.sha256)
    throw Error("PILOT_WORKSHEET_INPUT_CHANGED");
  const sheet = buildPilotCountWorksheet(JSON.parse(raw), config.metadata);
  const files = {
    "hoja.json": JSON.stringify(sheet, null, 2) + "\n",
    "hoja.html": renderPilotCountWorksheet(sheet),
    "resumen.json":
      JSON.stringify(
        {
          ...sheet.progress,
          source_kind: sheet.source_kind,
          generated_at: sheet.generated_at,
          blank_capture_fields: sheet.rows.length * 3,
          client_PII_included: false,
          source_quantity_semantics_confirmed: false,
          remote_writes: 0,
        },
        null,
        2,
      ) + "\n",
  };
  mkdirSync(output, { mode: 0o700 });
  for (const [name, content] of Object.entries(files))
    writeFileSync(join(output, name), content, { mode: 0o600, flag: "wx" });
  writeFileSync(
    join(output, "manifest.json"),
    JSON.stringify(
      {
        protocol: "m9-pilot-count-worksheet-manifest-1",
        input_sha256: config.input.sha256,
        files: Object.fromEntries(
          Object.entries(files).map(([name, bytes]) => [name, sha(bytes)]),
        ),
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  return JSON.parse(files["resumen.json"]);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length !== 4) throw Error("Usage: PINNED_CONFIG NEW_OUTPUT");
  console.log(
    JSON.stringify(
      preparePilotCountWorksheet(
        resolve(process.argv[2]),
        resolve(process.argv[3]),
      ),
    ),
  );
}
