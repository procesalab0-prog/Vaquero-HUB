import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "./acceleration.mjs";
import {
  prepareLinesDelivery,
  byteHash,
  STAGE,
} from "./clientes-lines-delivery.mjs";
import { quoteDoText } from "./sql-literal.mjs";
const UUID = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,
  SHA = /^[a-f0-9]{64}$/;
const need = (ok, error) => {
  if (!ok) throw Error(error);
};
export function prepareArchiveLineLink({
  archive,
  sourceRows,
  snapshot,
  catalogPlan,
  assessed_at,
  barcode,
  request_id,
  revoke_request_id,
  expected_revision = 0,
}) {
  need(
    UUID.test(request_id ?? "") &&
      UUID.test(revoke_request_id ?? "") &&
      request_id !== revoke_request_id &&
      Number.isSafeInteger(expected_revision) &&
      expected_revision >= 0,
    "LINK_REQUEST_METADATA_INVALID",
  );
  const plan = prepareLinesDelivery({
    archive,
    sourceRows,
    snapshot,
    catalogPlan,
    assessed_at,
  });
  const candidates = plan.pending.filter(
    (l) =>
      l.barcode === barcode &&
      l.reason === "EXACT_LITERAL_BINDING_PLAN_CANDIDATE",
  );
  need(candidates.length === 1, "EXACT_SINGLE_LINE_CANDIDATE_REQUIRED");
  const candidate = candidates[0],
    code = snapshot.codes.find((c) => c.barcode === barcode),
    match = code.matches[0];
  const account = archive.accounts.find((a) =>
      a.documents.some((d) => d.key === candidate.document_key),
    ),
    doc = account.documents.find((d) => d.key === candidate.document_key),
    line = doc.lines.find((l) => l.index === candidate.line_index);
  need(
    line.variant_id === null &&
      line.delivery_status === "UNKNOWN" &&
      line.reserved_qty === null &&
      line.stock_deduction === null,
    "IMMUTABLE_UNMAPPED_UNKNOWN_LINE_REQUIRED",
  );
  const registered = code.registered_lines.filter(
    (l) => l.document_key === doc.key && l.line_index === line.index,
  );
  const identity =
    code.registered_documents?.filter((d) => d.document_key === doc.key) ?? [];
  need(
    identity.length === 1 &&
      identity[0].customer_key === account.key &&
      identity[0].client_ref === account.ref &&
      identity[0].source_document_id === doc.source_id &&
      identity[0].source_folio === doc.folio,
    "REGISTERED_DOCUMENT_ORIGIN_DIFFERS",
  );
  need(
    registered.length === 1 &&
      registered[0].barcode === barcode &&
      registered[0].variant_id === null &&
      String(registered[0].quantity) === line.quantity &&
      registered[0].payload.delivery_status === "UNKNOWN" &&
      registered[0].payload.reserved_qty === null &&
      registered[0].payload.additional_stock_deduction === null,
    "REGISTERED_LINE_DIFFERS",
  );
  need(
    SHA.test(snapshot.archive_payload_hash ?? ""),
    "SQL_ARCHIVE_HASH_REQUIRED",
  );
  const evidence = {
    archive_sha256: archive.source_plan_sha256,
    archive_payload_hash: snapshot.archive_payload_hash,
    customer_key: account.key,
    document: doc,
    source_line: line,
    source_sicar_row: sourceRows.find((r) => r.barcode === barcode),
    registered_line: registered[0],
    registered_document_identity: identity[0],
    catalog_match: match,
    managed_row: code.managed_rows[0],
    captured_at: snapshot.captured_at,
  };
  const payload = {
    protocol: "m9-archived-line-link-1",
    project_id: STAGE,
    request_id,
    archive_sha256: archive.source_plan_sha256,
    document_key: doc.key,
    line_index: line.index,
    expected_archive_payload_hash: snapshot.archive_payload_hash,
    expected_document: doc,
    expected_registered_line: registered[0],
    expected_managed_row: code.managed_rows[0],
    expected_current_row: match.current_row,
    expected_revision,
    action: "BIND",
    revokes_request_id: null,
    variant_id: match.variant_id,
    evidence_sha256: digest(evidence),
    reason: "EXACT_LITERAL_SICAR_CODE_DOCUMENTARY_ONLY",
  };
  const revoke = {
    ...payload,
    request_id: revoke_request_id,
    expected_revision: expected_revision + 1,
    action: "REVOKE",
    revokes_request_id: request_id,
    variant_id: null,
    expected_managed_row: null,
    expected_current_row: null,
    reason: "REVOKE_DOCUMENTARY_LINK_PRESERVE_HISTORY",
  };
  return {
    protocol: "m9-archived-line-link-plan-1",
    assessed_at,
    source_cut_renewed: false,
    operational_import_allowed: false,
    inventory_import_allowed: false,
    raw_mapped_lines: plan.summary.lines - plan.summary.pending_lines,
    raw_pending_lines: plan.summary.pending_lines,
    planned_overlay_bindings: 1,
    effective_identity_candidates_after_review:
      plan.summary.lines - plan.summary.pending_lines + 1,
    raw_archive_modified: false,
    delivery_status: "UNKNOWN",
    payload,
    revoke,
    evidence,
    summary: plan.summary,
  };
}
export function archiveLineLinkTrialSQL(plan, actor) {
  need(UUID.test(actor ?? ""), "STAGING_ACTOR_REQUIRED");
  const tag = "$m9_line_trial$",
    p = quoteDoText(JSON.stringify(plan.payload), tag),
    r = quoteDoText(JSON.stringify(plan.revoke), tag);
  return `begin;\nset local standard_conforming_strings=on;\nselect set_config('request.jwt.claim.sub','${actor}',true);\ndo ${tag}\ndeclare p jsonb:=${p}::jsonb;r jsonb:=${r}::jsonb;a jsonb;b jsonb;v jsonb;\nbegin\n a:=app.m9_record_archived_line_link(p);\n b:=app.m9_record_archived_line_link(p);\n if a->>'action'<>'BIND' or b->'replayed'<>'true'::jsonb then raise exception 'LINK_REPLAY_FAILED';end if;\n v:=app.m9_read_archived_line_link(p->>'archive_sha256',p->>'document_key',(p->>'line_index')::int);\n if v->>'status'<>'LIVE_EXACT' or v->'stock_delivery_allowed'<>'false'::jsonb then raise exception 'LINK_VIEW_FAILED';end if;\n a:=app.m9_record_archived_line_link(r);b:=app.m9_record_archived_line_link(r);\n if a->>'action'<>'REVOKE' or b->'replayed'<>'true'::jsonb then raise exception 'LINK_REVERSAL_FAILED';end if;\n v:=app.m9_read_archived_line_link(p->>'archive_sha256',p->>'document_key',(p->>'line_index')::int);\n if v->>'status'<>'REVOKED' then raise exception 'LINK_REVERSE_VIEW_FAILED';end if;\nend ${tag};\nrollback;\n`;
}
export function runArchiveLineLink(configPath, outDir) {
  const config = JSON.parse(readFileSync(configPath, "utf8")),
    input = {};
  for (const [k, pin] of Object.entries(config.inputs)) {
    const bytes = readFileSync(pin.path);
    need(byteHash(bytes) === pin.sha256, "INPUT_SHA_CHANGED:" + k);
    input[k] = JSON.parse(bytes);
  }
  const plan = prepareArchiveLineLink({ ...input, ...config.metadata });
  // Existing dossiers are immutable evidence, including partial failed runs.
  // Parents must already exist; a retry needs a new output directory.
  mkdirSync(outDir, { recursive: false, mode: 0o700 });
  for (const [name, value] of Object.entries({
    "plan-vinculo-privado.json": plan,
    "payload-vinculo-inerte.json": plan.payload,
    "payload-compensacion-inerte.json": plan.revoke,
  }))
    writeFileSync(join(outDir, name), JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
  writeFileSync(
    join(outDir, "ensayo-vinculo-compensacion-rollback.sql"),
    archiveLineLinkTrialSQL(plan, config.actor_id),
    { mode: 0o600, flag: "wx" },
  );
  return {
    raw_mapped_lines: plan.raw_mapped_lines,
    raw_pending_lines: plan.raw_pending_lines,
    planned_overlay_bindings: 1,
    effective_identity_candidates_after_review:
      plan.effective_identity_candidates_after_review,
    raw_archive_modified: false,
    delivery_status: "UNKNOWN",
    operational_import_allowed: false,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log(
    JSON.stringify(runArchiveLineLink(process.argv[2], process.argv[3])),
  );
