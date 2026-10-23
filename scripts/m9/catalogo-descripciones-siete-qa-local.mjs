import pg from "pg";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { seedPriceFixtures } from "./catalogo-precio-publico-fixture.mjs";
const target = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
  target.pathname !== "/qa_m9_retenidos_block5_20261022"
)
  throw Error("DEDICATED_LOCAL_DESCRIPTION_QA_REQUIRED");
if (process.argv.length !== 4) throw Error("USAGE: PAYLOAD NEW_RESULT");
const p = JSON.parse(await readFile(process.argv[2], "utf8")),
  db = new pg.Client({ connectionString: target.href });
await db.connect();
let checks = 0;
const one = async (q, a = []) => (await db.query(q, a)).rows[0];
const tables = async () =>
  (
    await db.query(
      "select schemaname||'.'||tablename name from pg_tables where schemaname in('app','public')order by 1",
    )
  ).rows.map((x) => x.name);
const hashes = async () => {
  const ts = await tables();
  return (
    await one(
      "select jsonb_object_agg(name,jsonb_build_object('rows',n,'hash',hash))h from(" +
        ts
          .map(
            (t) =>
              `select '${t}' name,count(*)n,md5(coalesce(string_agg(j,'|'order by j),''))hash from(select to_jsonb(t)::text j from ${t} t)x`,
          )
          .join(" union all ") +
        ")x",
    )
  ).h;
};
try {
  const baseline = await hashes();
  await db.query(
    "begin;set local statement_timeout='30s';set local lock_timeout='3s';set local timezone='UTC'",
  );
  // Install only the existing read-only helper inside this rollback transaction.
  if (
    !(await one("select to_regprocedure('app.m9_sicar_price_state(uuid[])')r"))
      .r
  ) {
    const priceSQL = await readFile(
      new URL("./catalogo-precio-publico-apply.sql", import.meta.url),
      "utf8",
    );
    const reader = priceSQL.match(
      /create function app\.m9_sicar_price_state\(ids uuid\[\]\)[\s\S]+?\$\$;/,
    )[0];
    await db.query(
      reader +
        "revoke all on function app.m9_sicar_price_state(uuid[])from public,anon,authenticated,service_role",
    );
  }
  const sql = await readFile(
    new URL("./catalogo-descripciones-siete-apply.sql", import.meta.url),
    "utf8",
  );
  await db.query(sql.replace(/^begin;\s*/, "").replace(/commit;\s*$/, ""));
  const { ids, actor } = await seedPriceFixtures(db, p);
  assert.deepEqual(
    (await one("select app.m9_sicar_price_state($1::uuid[])s", [ids])).s,
    p.expected_state,
  );
  checks++;
  const initial = await hashes();
  const call = async (x) =>
    (await one("select app.m9_apply_sicar_descriptions($1::jsonb)r", [x])).r;
  async function reject(mutate, re, edit) {
    await db.query("savepoint bad_description");
    const x = structuredClone(p);
    mutate?.(x);
    if (edit) await edit(x);
    let error;
    try {
      await call(x);
    } catch (e) {
      error = e;
    }
    await db.query("rollback to savepoint bad_description");
    assert.match(error?.message ?? "", re);
    assert.deepEqual(await hashes(), initial);
    checks++;
  }
  await reject((x) => (x.project_id = "drubkjlmfbdeglucakmg"), /EXACT_PACKET/);
  await reject((x) => (x.source_after_sha256 = "a".repeat(64)), /EXACT_PACKET/);
  await reject((x) => x.changes.pop(), /EXACT_PACKET/);
  await reject((x) => (x.changes[0].barcode = "18221 "), /FIXED_SEVEN/);
  await reject((x) => (x.source_rows_json += " "), /EXACT_PACKET/);
  await reject(
    (x) => (x.changes[0].new_description += " ALTERED"),
    /IDENTITY_SOURCE_OR_WEB/,
  );
  await reject(
    (x) => (x.observed_at = "2000-01-01T00:00:00.000Z"),
    /CONTEXT_EXPIRED/,
  );
  await reject((x) => (x.observed_at = "now"), /EXACT_PACKET/);
  await reject((x) => (x.observed_at = "today"), /EXACT_PACKET/);
  await reject((x) => (x.observed_at = "2026-10-23T02:53:36Z"), /EXACT_PACKET/);
  await reject(
    (x) => x.expected_state[0].variant.price_cents++,
    /CONTEXT_CHANGED/,
  );
  await reject(null, /CONTEXT_CHANGED/, () =>
    db.query(
      "update public.variants set price_cents=price_cents+1 where id=$1",
      [ids[0]],
    ),
  );
  await reject(null, /CONTEXT_CHANGED/, () =>
    db.query("update public.variants set cost_cents=0 where id=$1", [ids[0]]),
  );
  await reject(null, /CONTEXT_CHANGED/, () =>
    db.query(
      "update public.m9_variant_details set source_description='MANUAL'where variant_id=$1",
      [ids[0]],
    ),
  );
  await reject(null, /CONTEXT_CHANGED/, () =>
    db.query("update public.products set name=name||' MANUAL'where id=$1", [
      p.expected_state[0].product.id,
    ]),
  );
  await reject(null, /CONTEXT_CHANGED/, () =>
    db.query(
      "update app.m9_provisional_variants set web_release=true where variant_id=$1",
      [ids[0]],
    ),
  );
  await reject(null, /CONTEXT_CHANGED/, () =>
    db.query(
      "update app.m9_rows set source_sha256=repeat('a',64)where variant_id=$1",
      [ids[0]],
    ),
  );
  await reject(null, /CONTEXT_CHANGED/, () =>
    db.query("update public.categories set is_active=false where id=$1", [
      p.expected_state[0].category.id,
    ]),
  );
  await reject(null, /IDENTITY_SOURCE_OR_WEB/, async (x) => {
    await db.query("update public.categories set is_active=false where id=$1", [
      p.expected_state[0].category.id,
    ]);
    x.expected_state = (
      await one("select app.m9_sicar_price_state($1::uuid[])s", [ids])
    ).s;
  });
  await reject(null, /IDENTITY_SOURCE_OR_WEB/, async (x) => {
    await db.query(
      "update app.m9_provisional_variants set source_evidence=jsonb_set(source_evidence,'{web_release}','true')where variant_id=$1",
      [ids[0]],
    );
    x.expected_state = (
      await one("select app.m9_sicar_price_state($1::uuid[])s", [ids])
    ).s;
  });
  await reject(null, /insufficient_privilege|permission denied/i, () =>
    db.query("select set_config('request.jwt.claim.sub','',true)"),
  );
  await reject(null, /insufficient_privilege|permission denied/i, () =>
    db.query("update public.app_users set is_active=false where id=$1", [
      actor,
    ]),
  );
  await db.query(
    "create function pg_temp.description_fail_receipt()returns trigger language plpgsql as $$begin raise exception 'DESCRIPTION_FAIL_AFTER_UPDATES';end$$;create trigger description_fail_receipt before insert on app.m9_sicar_description_events for each row execute function pg_temp.description_fail_receipt()",
  );
  await reject(null, /DESCRIPTION_FAIL_AFTER_UPDATES/);
  await db.query(
    "drop trigger description_fail_receipt on app.m9_sicar_description_events",
  );
  const first = await call(p);
  assert.equal(first.changed_descriptions, 7);
  checks++;
  const after = await hashes();
  for (const t of Object.keys(initial).filter(
    (t) =>
      ![
        "public.m9_variant_details",
        "app.m9_rows",
        "app.m9_sicar_description_events",
        "public.audit_log",
      ].includes(t),
  ))
    assert.deepEqual(after[t], initial[t], t);
  assert.equal(
    after["public.audit_log"].rows,
    initial["public.audit_log"].rows + 1,
  );
  checks++;
  assert.equal((await call(p)).replayed, true);
  assert.deepEqual(await hashes(), after);
  checks++;
  await db.query("savepoint wrong_replay");
  const altered = structuredClone(p);
  altered.observed_at = new Date().toISOString();
  await assert.rejects(() => call(altered), /REPLAY_CHANGED/);
  await db.query("rollback to savepoint wrong_replay");
  checks++;
  for (const q of [
    "update app.m9_sicar_description_events set packet='{}'where request_id=$1",
    "delete from app.m9_sicar_description_events where request_id=$1",
  ]) {
    await db.query("savepoint immutable");
    await assert.rejects(() => db.query(q, [p.request_id]), /IMMUTABLE/);
    await db.query("rollback to savepoint immutable");
    checks++;
  }
  const reverse = "f2000000-0000-4000-8000-000000000001";
  for (const q of [
    "update public.m9_variant_details set source_description='MANUAL'where variant_id=$1",
    "update public.variants set price_cents=price_cents+1 where id=$1",
  ]) {
    await db.query("savepoint reverse_held");
    await db.query(q, [ids[0]]);
    await assert.rejects(
      () =>
        db.query("select app.m9_reverse_sicar_descriptions($1,$2)", [
          reverse,
          p.request_id,
        ]),
      /REVERSE_CONTEXT_CHANGED/,
    );
    await db.query("rollback to savepoint reverse_held");
    checks++;
  }
  for (const role of ["anon", "authenticated", "service_role"]) {
    const acl = await one(
      "select has_function_privilege($1,'app.m9_apply_sicar_descriptions(jsonb)','EXECUTE')a,has_function_privilege($1,'app.m9_reverse_sicar_descriptions(uuid,uuid)','EXECUTE')r,has_function_privilege($1,'app.m9_sicar_description_locks()','EXECUTE')l,has_function_privilege($1,'app.m9_sicar_description_actor()','EXECUTE')u,has_table_privilege($1,'app.m9_sicar_description_events','SELECT,INSERT,UPDATE,DELETE')t",
      [role],
    );
    assert.deepEqual(acl, { a: false, r: false, l: false, u: false, t: false });
    checks++;
  }
  const reversed = (
    await one("select app.m9_reverse_sicar_descriptions($1,$2)r", [
      reverse,
      p.request_id,
    ])
  ).r;
  assert.equal(reversed.restored_descriptions, 7);
  assert.deepEqual(
    (await one("select app.m9_sicar_price_state($1::uuid[])s", [ids])).s,
    p.expected_state,
  );
  checks++;
  const reversedHashes = await hashes();
  assert.equal(
    (
      await one("select app.m9_reverse_sicar_descriptions($1,$2)r", [
        reverse,
        p.request_id,
      ])
    ).r.replayed,
    true,
  );
  assert.deepEqual(await hashes(), reversedHashes);
  checks++;
  await db.query("savepoint reapplied");
  await assert.rejects(() => call(p), /REPLAY_CHANGED/);
  await db.query("rollback to savepoint reapplied");
  checks++;
  await db.query("rollback");
  assert.deepEqual(await hashes(), baseline);
  checks++;
  const result = {
    protocol: "m9-description-seven-local-qa-1",
    database: target.pathname.slice(1),
    checks,
    descriptions_updated: 7,
    compensated: 7,
    replay_exact: true,
    original_product_names_variant_UUIDs_barcodes_source_evidence_preserved: true,
    only_two_literal_fields_changed: true,
    rollback_tables: Object.keys(baseline).length,
    rollback_exact: true,
    remote_writes: 0,
    stock_cost_price_woo_finance_writes: 0,
  };
  await writeFile(process.argv[3], JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(result));
} finally {
  await db.query("rollback");
  await db.end();
}
