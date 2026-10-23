import pg from "pg";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { provisionalPlan } from "./provisional-plan.mjs";
import { incrementalProvisionalSql } from "./prepare-incremental-provisional-sql.mjs";
const u = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  u.hostname !== "127.0.0.1" ||
  u.port !== "59432" ||
  u.pathname !== "/qa_m9_catalogo_block3_20261022"
)
  throw Error("OWN_LOCAL_INCREMENTAL_DATABASE_REQUIRED");
const c = new pg.Client({ connectionString: u.href });
await c.connect();
async function audit() {
  const tables = (
    await c.query(
      "select schemaname,tablename from pg_tables where schemaname in('app','public') order by schemaname,tablename",
    )
  ).rows;
  const rows = [];
  for (const t of tables) {
    assert.match(t.tablename, /^[a-z][a-z0-9_]*$/);
    rows.push({
      name: `${t.schemaname}.${t.tablename}`,
      ...(
        await c.query(
          `select count(*)::int rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),''))md5 from "${t.schemaname}"."${t.tablename}" t`,
        )
      ).rows[0],
    });
  }
  return rows;
}
try {
  const actor = (
    await c.query(
      "select a.id from public.app_users a join public.roles r on r.id=a.role_id where r.code='ADMIN' order by a.id limit 1",
    )
  ).rows[0].id;
  const category = (
    await c.query(
      "select name from public.categories where is_active order by name limit 1",
    )
  ).rows[0].name;
  const fields = {
    "clave1 *": "QA-INCREMENTAL-NOT-SICAR",
    "descripción *": "SYNTHETIC INCREMENTAL CATALOG QA",
    departamento: "QA",
    categoria: category,
    precio1: "7",
    unidad: "PIEZA",
    "(s/n) inventariable": "s",
    "(s/n) mostrar en ventas": "s",
    "(s/n) granel": "n",
    "(s/n) receta": "n",
    "(s/n) lotes": "n",
  };
  const plan = provisionalPlan({
    rows: [
      {
        barcode: fields["clave1 *"],
        description: fields["descripción *"],
        fields,
        classification: "SICAR_ONLY",
        issues: [],
      },
    ],
    snapshot: { codes: [], names: [], categories: [] },
    taxonomy: { paths: [] },
    sourceSha: "a".repeat(64),
    authorization: "Synthetic local acceptance, no commercial approval",
    date: "2026-10-22",
  });
  const before = await audit();
  assert.ok(
    before.find((x) => x.name === "public.sales").rows > 0,
    "History fixture must be nonempty",
  );
  const sql = incrementalProvisionalSql(plan, before, actor, "rollback");
  const results = await c.query(sql);
  const receipt = results.flatMap((x) => x.rows).find((x) => x.data)?.data;
  assert.equal(receipt.created, 1);
  assert.equal(receipt.replayed_without_change, true);
  assert.deepEqual(await audit(), before);
  let rejected = 0;
  async function reject(q, reason) {
    let error;
    try {
      await c.query(q);
    } catch (e) {
      error = e;
    }
    await c.query("rollback");
    assert.ok(error, reason);
    assert.match(error.message, new RegExp(reason));
    assert.deepEqual(await audit(), before);
    rejected++;
  }
  const stale = structuredClone(before);
  stale.find((x) => x.name === "public.sales").rows++;
  await reject(
    incrementalProvisionalSql(plan, stale, actor, "rollback"),
    "INCREMENTAL_BASELINE_CHANGED",
  );
  await reject(
    incrementalProvisionalSql(
      plan,
      before.filter((x) => x.name !== "public.roles"),
      actor,
      "rollback",
    ),
    "INCREMENTAL_AUDIT_SCOPE_CHANGED",
  );
  const oldProduct = (
    await c.query("select id from public.products order by id limit 1")
  ).rows[0].id;
  await reject(
    sql.replace(
      "set constraints all immediate;",
      `update public.products set name=name||' QA ALTERATION' where id='${oldProduct}';set constraints all immediate;`,
    ),
    "INCREMENTAL_(PREVIOUS_ROW_CHANGED|UNEXPECTED_INSERT)",
  );
  const report = {
    protocol: "m9-incremental-provisional-local-1",
    fixture: "SYNTHETIC_NOT_SICAR",
    tables: before.length,
    nonempty_sales: before.find((x) => x.name === "public.sales").rows,
    checks: 6,
    negative_rejections: rejected,
    receipt,
    outer_rollback: true,
    all_previous_tables_unchanged: true,
    sequence_gaps_not_rewound: true,
  };
  if (process.argv[2])
    await writeFile(process.argv[2], JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  console.log(JSON.stringify(report));
} finally {
  await c.query("rollback");
  await c.end();
}
