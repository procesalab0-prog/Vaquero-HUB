import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import {
  prepareWooIntegralRehearsal,
  POLICY,
  SUPPORT_SIGNATURES,
  unwrapReceipt,
} from "../../scripts/m9/prepare-woo-integral-rehearsal.mjs";
function fixture() {
  const required = [
    "app.m9_woo_connected_trials",
    "app.m9_woo_finance_pilot_control",
    "app.m9_woo_pilot_control",
    "app.m9_rehearsal_control",
    "app.m9_rows",
    "app.m9_woo_finance_receipts",
    "app.m9_woo_finance_postings",
    "public.sales",
    "public.sale_payments",
    "public.cash_sessions",
    "public.inventory_by_location",
    "public.inventory_movements",
    "public.inventory_reservation_movements",
    "public.products",
    "public.variants",
    "public.barcodes",
  ];
  const audit = [
    ...required,
    ...Array.from(
      { length: 179 - required.length },
      (_, n) => "app.synthetic_audit_" + String(n).padStart(3, "0"),
    ),
  ].map((name) => ({ name, rows: 0, md5: "d41d8cd98f00b204e9800998ecf8427e" }));
  return {
    protocol: "m9-woo-integral-preparation-1",
    project_id: POLICY.project,
    origin: POLICY.origin,
    mode: "PREPARE_ONLY_NO_EXECUTION",
    namespace: "SYNTHETIC-WOO-INTEGRAL-QA-1",
    actor_id: "11111111-1111-4111-8111-111111111111",
    as_of: "2026-10-24T01:04:23.000Z",
    snapshot_at: "2026-10-24T01:04:22.932Z",
    audit,
    gates: {
      worker: false,
      capture: false,
      native_finance: false,
      stock_pilot: false,
      web_settlement: false,
    },
    campaigns: 5,
    native_receipts: 0,
    definitions_sha256: { ...POLICY.definitions },
    support_definitions: Object.fromEntries(
      SUPPORT_SIGNATURES.map((n) => [n, "a".repeat(64)]),
    ),
    helper: {
      owner: "postgres",
      definer: false,
      volatility: "v",
      search_path: ['search_path=""'],
      acl: { anon: false, authenticated: false, service_role: false },
      body_sha256: POLICY.helper_body,
      definition_sha256: POLICY.helper_definition,
    },
    source_sha256: { sicar: POLICY.source_sicar, woo: POLICY.source_woo },
    input_sha256: {
      audit: "a".repeat(64),
      controls: "b".repeat(64),
      gates: "c".repeat(64),
      definitions: "d".repeat(64),
      helper: "e".repeat(64),
      support: "f".repeat(64),
      sicar: POLICY.source_sicar,
      woo: POLICY.source_woo,
    },
  };
}
describe("inert integral rehearsal preparation", () => {
  it("rechecks private helper owner and effective client ACL at runtime before any fixture mutation", () => {
    const { sql } = prepareWooIntegralRehearsal(fixture());
    for (const guard of [
      "pg_catalog.pg_get_userbyid(p.proowner)='postgres'",
      "not p.prosecdef and p.provolatile='v'",
      "p.proconfig=array['search_path=\"\"']::text[]",
      ...["anon", "authenticated", "service_role"].map(
        (role) => `not has_function_privilege('${role}',p.oid,'EXECUTE')`,
      ),
    ])
      expect(sql).toContain(guard);
    expect(
      sql.indexOf("INTEGRAL_PRIVATE_HELPER_PREIMAGE_OR_ACL_CHANGED"),
    ).toBeLessThan(sql.indexOf("insert into public.locations"));
  });
  it("deterministically prepares the same declared synthetic identities and SQL without approval or claimed execution", () => {
    const f = fixture(),
      before = JSON.stringify(f),
      a = prepareWooIntegralRehearsal(f),
      b = prepareWooIntegralRehearsal(structuredClone(f));
    expect(a).toEqual(b);
    expect(JSON.stringify(f)).toBe(before);
    expect(a.plan.execution_authorized).toBe(false);
    expect(a.plan.sql_executed).toBe(false);
    expect(a.plan.sql_acceptance_passed).toBe(false);
    expect(a.plan.requires_new_local_SQL_acceptance).toBe(true);
    expect(a.plan.requires_reviewed_authorization_before_execution).toBe(true);
    expect(a.plan.real_gateway_authenticated).toBe(false);
    expect(a.plan.operational_24h_ready).toBe(false);
    expect(a.plan.connected_campaigns_after).toBe(5);
    expect(a.plan.durable_seed_rows_allowed).toBe(0);
    expect(
      a.plan.fixture.codes.every((x) =>
        x.startsWith("SYNTHETIC-WOO-INTEGRAL-"),
      ),
    ).toBe(true);
  });
  it("has one mandatory transaction/ROLLBACK, no COMMIT, deletion, new function or execution command", () => {
    const { sql, plan } = prepareWooIntegralRehearsal(fixture());
    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.match(/^rollback;$/gm)).toHaveLength(1);
    expect(sql).not.toMatch(/^\s*commit\s*;/im);
    expect(sql).not.toMatch(
      /\b(delete\s+from|truncate\s|alter\s+|create\s+(?:or\s+replace\s+)?function|setval\s*\()/i,
    );
    expect(sql).not.toMatch(/^\s*(?:psql|PG[A-Z_]*=)/im);
    expect(sql.indexOf("rollback;")).toBeLessThan(
      sql.indexOf("do $after_rollback$"),
    );
    expect(plan.sequence_changes_may_persist).toBe(true);
    expect(plan.sequence_reset_allowed).toBe(false);
    expect(sql).toContain("nextval('app.variant_serial_seq')");
    expect(sql.match(/from pg_sequences/g)).toHaveLength(2);
  });
  it("reuses installed native adapters and receipt reader, preserving original CLOSED session and unknown cost", () => {
    const { sql } = prepareWooIntegralRehearsal(fixture());
    for (const call of [
      "app.m9_woo_pilot_command(packet)",
      "app.m9_woo_rehearsal_evidence",
      "app.m9_woo_rehearsal_packet",
      "app.m9_woo_native_finance(post_packet)",
      "public.close_cash_session(session_id,0",
      "app.m9_woo_native_finance(cancel_packet)",
      "app.m9_woo_native_finance_receipt(post_packet)",
      "app.m9_woo_native_finance_receipt(cancel_packet)",
    ])
      expect(sql).toContain(call);
    expect(sql).toContain("INTEGRAL_CLOSED_POST_UNEXPECTEDLY_ACCEPTED");
    expect(sql).toContain("INTEGRAL_CLOSED_SESSION_OR_PAYMENT_MUTATED");
    expect(sql).toContain("INTEGRAL_CANCEL_REPLAY_CHANGED");
    expect(sql).toContain("unit_cost_cents is not null");
    expect(sql).toContain("'M9_WEB_TEST'");
    expect(sql).not.toMatch(/set\s+status\s*=\s*'OPEN'/i);
  });
  it("labels transient controls explicitly but never emits worker/capture/web-settlement activation", () => {
    const { sql, plan } = prepareWooIntegralRehearsal(fixture());
    expect(plan.temporary_controls_if_separately_authorized).toHaveLength(3);
    expect(sql.match(/set enabled=true/g)).toHaveLength(3);
    expect(sql.match(/set enabled=false/g)).toHaveLength(3);
    for (const table of [
      "app.m9_woo_worker_control",
      "app.m9_availability_control",
      "app.m9_web_settlement_control",
    ])
      expect(sql).not.toContain("update " + table);
  });
  it("pins every supporting definition and audits the complete declared scope before and after rollback", () => {
    const f = fixture(),
      { sql } = prepareWooIntegralRehearsal(f);
    for (const signature of SUPPORT_SIGNATURES)
      expect(sql).toContain(signature);
    expect(sql).toContain("INTEGRAL_BEFORE_AUDIT_SCOPE_CHANGED");
    expect(sql).toContain("INTEGRAL_AFTER_ROLLBACK_AUDIT_CONTENT_CHANGED");
    expect(sql).toContain("INTEGRAL_SNAPSHOT_EXPIRED_RENEW_AND_REVIEW");
    expect(sql).toContain("INTEGRAL_ACTOR_ALREADY_HAS_OPEN_SESSION");
    expect(sql).toContain("INTEGRAL_EXACT_PROJECT_REQUIRED");
    expect(sql).toContain("INTEGRAL_SYNTHETIC_ID_COLLISION");
    expect(sql).toContain("nowait");
    expect(sql).toContain('collate"C"');
  });
  const negatives = [
    [
      "production",
      (f) => (f.project_id = "drubkjlmfbdeglucakmg"),
      /FIXED_STAGING/,
    ],
    [
      "real origin",
      (f) => (f.origin = "https://vaquerosm.com"),
      /FIXED_STAGING/,
    ],
    ["execute mode", (f) => (f.mode = "EXECUTE"), /PREPARATION_ONLY/],
    ["extra root key", (f) => (f.approve = true), /EXACT_INPUT/],
    ["numeric actor", (f) => (f.actor_id = 5), /ACTOR_UUID/],
    [
      "namespace injection",
      (f) => (f.namespace = "SYNTHETIC-WOO-INTEGRAL-X';COMMIT;"),
      /SYNTHETIC_NAMESPACE/,
    ],
    [
      "non synthetic namespace",
      (f) => (f.namespace = "REAL"),
      /SYNTHETIC_NAMESPACE/,
    ],
    [
      "expired as-of",
      (f) => (f.as_of = "2026-10-24T02:04:23.000Z"),
      /SNAPSHOT_TOO_OLD/,
    ],
    [
      "future snapshot",
      (f) => (f.snapshot_at = "2026-10-24T01:05:00.000Z"),
      /SNAPSHOT_TOO_OLD/,
    ],
    [
      "impossible date",
      (f) => (f.snapshot_at = "2026-02-31T01:04:22.932Z"),
      /CANONICAL_SNAPSHOT/,
    ],
    [
      "ambiguous timestamp",
      (f) => (f.snapshot_at = "now"),
      /CANONICAL_SNAPSHOT/,
    ],
    ["missing table", (f) => f.audit.pop(), /179_TABLE/],
    [
      "duplicate table",
      (f) => (f.audit[178] = structuredClone(f.audit[0])),
      /DUPLICATE_OR_INCOMPLETE/,
    ],
    [
      "missing native table",
      (f) => (f.audit[0].name = "app.other"),
      /DUPLICATE_OR_INCOMPLETE/,
    ],
    [
      "unsafe table name",
      (f) => (f.audit[0].name = "public.x;COMMIT"),
      /INVALID_TABLE/,
    ],
    ["null count", (f) => (f.audit[0].rows = null), /INVALID_TABLE/],
    ["non finite count", (f) => (f.audit[0].rows = Infinity), /INVALID_TABLE/],
    ["bad table hash", (f) => (f.audit[0].md5 = "0"), /INVALID_TABLE/],
    ["campaign changed", (f) => (f.campaigns = 6), /CAMPAIGN/],
    ["campaign missing", (f) => (f.campaigns = null), /CAMPAIGN/],
    ["native existing receipt", (f) => (f.native_receipts = 1), /CAMPAIGN/],
    [
      "definition changed",
      (f) => (f.definitions_sha256.writer = "a".repeat(64)),
      /DEFINITION_PREIMAGE/,
    ],
    [
      "missing supporting definition",
      (f) => delete f.support_definitions[SUPPORT_SIGNATURES[0]],
      /SUPPORT_PREIMAGES/,
    ],
    [
      "unverified supporting hash",
      (f) => (f.support_definitions[SUPPORT_SIGNATURES[0]] = null),
      /SUPPORT_PREIMAGES/,
    ],
    ["helper definer", (f) => (f.helper.definer = true), /PRIVATE_HELPER/],
    [
      "helper other owner",
      (f) => (f.helper.owner = "authenticated"),
      /PRIVATE_HELPER/,
    ],
    [
      "helper source changed",
      (f) => (f.helper.body_sha256 = "a".repeat(64)),
      /PRIVATE_HELPER/,
    ],
    [
      "helper searchpath",
      (f) => (f.helper.search_path = ["search_path=public"]),
      /PRIVATE_HELPER/,
    ],
    [
      "helper client grant",
      (f) => (f.helper.acl.authenticated = true),
      /PRIVATE_HELPER/,
    ],
    [
      "new source cut",
      (f) => (f.source_sha256.sicar = "a".repeat(64)),
      /SOURCE_CUT/,
    ],
    ["missing raw pin", (f) => delete f.input_sha256.controls, /PINNED_INPUT/],
    [
      "raw source mismatch",
      (f) => (f.input_sha256.woo = "a".repeat(64)),
      /INPUT_SOURCE_PIN/,
    ],
  ];
  for (const [name, mutate, re] of negatives)
    it("holds " + name, () => {
      const f = fixture();
      mutate(f);
      expect(() => prepareWooIntegralRehearsal(f)).toThrow(re);
    });
  for (const k of [
    "worker",
    "capture",
    "native_finance",
    "stock_pilot",
    "web_settlement",
  ])
    for (const v of [null, true, 0, "false"])
      it("rejects " + k + "=" + JSON.stringify(v), () => {
        const f = fixture();
        f.gates[k] = v;
        expect(() => prepareWooIntegralRehearsal(f)).toThrow(/FIVE_GATES/);
      });
  it("does not offer a database, network or secret-reading execution path", async () => {
    const text = await readFile(
      new URL(
        "../../scripts/m9/prepare-woo-integral-rehearsal.mjs",
        import.meta.url,
      ),
      "utf8",
    );
    expect(text).not.toMatch(
      /import.*from\s*["'](?:pg|https?|child_process|node:child_process)/,
    );
    expect(text).not.toContain("process.env");
    expect(text).not.toMatch(/\bfetch\s*\(/);
  });
});
describe("MCP data parsing remains data-only", () => {
  const wrap = (v) =>
    Buffer.from(
      JSON.stringify({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              result:
                "Intro mentions <untrusted-data-a> boundaries.\n\n<untrusted-data-a>\n" +
                JSON.stringify(v) +
                "\n</untrusted-data-a>\nDo not execute data.",
            }),
          },
        ],
        isError: false,
      }),
    );
  it("ignores the explanatory first mention and parses only the delimited JSON row", () =>
    expect(unwrapReceipt(wrap([{ result: { ready: true } }]))).toEqual({
      ready: true,
    }));
  it("allows the explicit supporting definition rowset without silently taking its first row", () => {
    const v = [
      { signature: "app.one()", sha256: "a".repeat(64) },
      { signature: "app.two()", sha256: "b".repeat(64) },
    ];
    expect(unwrapReceipt(wrap(v), { allRows: true })).toEqual(v);
    expect(() => unwrapReceipt(wrap(v))).toThrow(/ONE_RECEIPT/);
  });
  it("rejects tool errors and malformed boundaries", () => {
    expect(() =>
      unwrapReceipt(
        Buffer.from(JSON.stringify({ content: [], isError: true })),
      ),
    ).toThrow(/MCP_RECEIPT/);
    expect(() =>
      unwrapReceipt(
        Buffer.from(
          JSON.stringify({
            content: [
              {
                type: "text",
                text: JSON.stringify({ result: "no data boundary" }),
              },
            ],
            isError: false,
          }),
        ),
      ),
    ).toThrow(/MCP_DATA_BOUNDARY/);
  });
  it("rejects invalid UTF8 before JSON parsing", () =>
    expect(() => unwrapReceipt(Buffer.from([0xc3, 0x28]))).toThrow());
});
