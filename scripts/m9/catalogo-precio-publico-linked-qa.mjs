import pg from "pg";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { seedLinkedPriceFixtures } from "./catalogo-precio-publico-linked-fixture.mjs";
const target = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
  target.pathname !== "/qa_m9_precio11777_20261023"
)
  throw Error("ASSIGNED_LINKED_PRICE_QA_ONLY");
if (process.argv.length !== 4) throw Error("USAGE: PAYLOAD NEW_RESULT");
const p = JSON.parse(await readFile(process.argv[2], "utf8")),
  db = new pg.Client({ connectionString: target.href });
await db.connect();
let checks = 0;
const one = async (q, a = []) => (await db.query(q, a)).rows[0];
const tables = (
  await db.query(
    "select schemaname||'.'||tablename name from pg_tables where schemaname in('app','public')order by 1",
  )
).rows.map((r) => r.name);
const hashSQL =
  "select jsonb_object_agg(name,jsonb_build_object('rows',n,'hash',h))h from(" +
  tables
    .map(
      (t) =>
        `select '${t}'name,count(*)n,md5(coalesce(string_agg(j,'|'order by j),''))h from(select to_jsonb(t)::text j from ${t} t)x`,
    )
    .join(" union all ") +
  ")x";
const hashes = async () => (await one(hashSQL)).h;
try {
  const before = await hashes();
  await db.query(
    "begin;set local timezone='UTC';set local statement_timeout='30s';set local lock_timeout='3s'",
  );
  await db.query(
    await readFile(
      new URL("./catalogo-precio-publico-linked-forward.sql", import.meta.url),
      "utf8",
    ),
  );
  const { ids, actor } = await seedLinkedPriceFixtures(db, p);
  assert.deepEqual(
    (await one("select app.m9_sicar_linked_price_state($1::uuid[])s", [ids])).s,
    p.expected_state,
  );
  checks++;
  const initial = await hashes();
  const call = async (x) =>
    (await one("select app.m9_apply_sicar_public_prices($1::jsonb)r", [x])).r;
  async function reject(mutate, re, edit) {
    await db.query("savepoint reject_linked");
    const x = structuredClone(p);
    mutate?.(x);
    if (edit) await edit(x);
    let error;
    try {
      await call(x);
    } catch (e) {
      error = e;
    }
    await db.query("rollback to savepoint reject_linked");
    assert.match(error?.message ?? "", re);
    assert.deepEqual(await hashes(), initial);
    checks++;
  }
  await reject((x) => (x.project_id = "drubkjlmfbdeglucakmg"), /EXACT_PACKET/);
  await reject(
    (x) => x.changes.push(structuredClone(x.changes[0])),
    /EXACT_PACKET/,
  );
  await reject((x) => (x.changes[0].barcode = "11777 "), /IDENTITY_OR_WEB/);
  await reject((x) => (x.changes[0].new_cents = 830001), /IDENTITY_OR_WEB/);
  await reject((x) => (x.source_rows_json += " "), /EXACT_PACKET/);
  await reject((x) => (x.source_after_sha256 = "a".repeat(64)), /EXACT_PACKET/);
  await reject((x) => (x.observed_at = "now"), /EXACT_PACKET/);
  await reject(
    (x) => (x.observed_at = "2000-01-01T00:00:00.000Z"),
    /CONTEXT_EXPIRED/,
  );
  await reject(
    (x) => (x.expected_state[0].variant.cost_cents = 0),
    /IDENTITY_OR_WEB/,
  );
  await reject(
    (x) => (x.expected_state[0].web.lab_enabled = { enabled: true }),
    /IDENTITY_OR_WEB/,
  );
  await reject(
    (x) => x.expected_state[0].linked_context.copies.pop(),
    /IDENTITY_OR_WEB/,
  );
  await reject(
    (x) => x.expected_state[0].linked_context.siblings[0].variant.price_cents++,
    /CONTEXT_CHANGED/,
  );
  for (const q of [
    "update public.variants set price_cents=price_cents+1 where id=$1",
    "update public.variants set cost_cents=0 where id=$1",
    "update public.m9_variant_details set source_description='MANUAL'where variant_id=$1",
    "update app.m9_rows set source_sha256=repeat('a',64)where variant_id=$1",
  ])
    await reject(null, /CONTEXT_CHANGED/, () => db.query(q, [ids[0]]));
  await reject(null, /CONTEXT_CHANGED/, () =>
    db.query(
      "update public.variants set price_cents=price_cents+1 where id=$1",
      [p.expected_state[0].linked_context.siblings[0].variant.id],
    ),
  );
  await reject(null, /CONTEXT_CHANGED/, () =>
    db.query(
      "update app.web_product_drafts set revision=revision+1 where product_id=$1",
      [p.expected_state[0].product.id],
    ),
  );
  await reject(null, /CONTEXT_CHANGED/, () =>
    db.query(
      "update app.web_variant_photo_evidence set revision=revision+1 where variant_id=$1",
      [ids[0]],
    ),
  );
  await reject(null, /CONTEXT_CHANGED/, () =>
    db.query(
      "update app.web_variant_photo_storage set photos='[]'where variant_id=$1",
      [ids[0]],
    ),
  );
  await reject(null, /insufficient_privilege|NOT_AUTHORIZED/, () =>
    db.query("select set_config('request.jwt.claim.sub','',true)"),
  );
  await reject(null, /NOT_AUTHORIZED/, () =>
    db.query("update public.app_users set is_active=false where id=$1", [
      actor,
    ]),
  );
  await db.query(
    "create function pg_temp.price_linked_fail()returns trigger language plpgsql as $$begin raise exception 'LINKED_FAIL_AFTER_UPDATES';end$$;create trigger price_linked_fail before insert on app.m9_sicar_price_events for each row execute function pg_temp.price_linked_fail()",
  );
  await reject(null, /LINKED_FAIL_AFTER_UPDATES/);
  await db.query("drop trigger price_linked_fail on app.m9_sicar_price_events");
  const first = await call(p);
  assert.equal(first.changed, 1);
  assert.equal(first.woo_written, false);
  checks++;
  const after = await hashes();
  for (const t of tables.filter(
    (t) =>
      ![
        "public.variants",
        "app.m9_rows",
        "app.m9_sicar_price_events",
        "public.audit_log",
      ].includes(t),
  ))
    assert.deepEqual(after[t], initial[t], t);
  assert.equal(
    after["app.m9_sicar_price_events"].rows,
    initial["app.m9_sicar_price_events"].rows + 1,
  );
  checks++;
  assert.equal((await call(p)).replayed, true);
  assert.deepEqual(await hashes(), after);
  checks++;
  const actual = (
    await one("select app.m9_sicar_linked_price_state($1::uuid[])s", [ids])
  ).s;
  assert.equal(actual[0].current.price_cents, 830000);
  assert.deepEqual(actual[0].web, p.expected_state[0].web);
  assert.deepEqual(
    actual[0].linked_context,
    p.expected_state[0].linked_context,
  );
  checks++;
  for (const role of ["anon", "authenticated", "service_role"]) {
    const acl = await one(
      "select has_function_privilege($1,'app.m9_apply_sicar_public_prices(jsonb)','EXECUTE')w,has_function_privilege($1,'app.m9_reverse_sicar_public_prices(uuid,uuid)','EXECUTE')r,has_function_privilege($1,'app.m9_validate_linked_price_packet(jsonb)','EXECUTE')v,has_function_privilege($1,'app.m9_sicar_linked_price_locks()','EXECUTE')l,has_function_privilege($1,'app.m9_sicar_linked_price_state(uuid[])','EXECUTE')s,has_table_privilege($1,'app.m9_sicar_price_events','SELECT,INSERT,UPDATE,DELETE')t",
      [role],
    );
    assert.deepEqual(acl, {
      w: false,
      r: false,
      v: false,
      l: false,
      s: false,
      t: false,
    });
    checks++;
  }
  const reverse = "f3000000-0000-4000-8000-000000000001";
  await db.query("savepoint manual_reverse");
  await db.query(
    "update app.web_product_drafts set revision=revision+1 where product_id=$1",
    [p.expected_state[0].product.id],
  );
  await assert.rejects(
    () =>
      db.query("select app.m9_reverse_sicar_public_prices($1,$2)", [
        reverse,
        p.request_id,
      ]),
    /REVERSE_CONTEXT_CHANGED/,
  );
  await db.query("rollback to savepoint manual_reverse");
  checks++;
  assert.equal(
    (
      await one("select app.m9_reverse_sicar_public_prices($1,$2)r", [
        reverse,
        p.request_id,
      ])
    ).r.restored_prices,
    1,
  );
  checks++;
  const restored = (
    await one("select app.m9_sicar_linked_price_state($1::uuid[])s", [ids])
  ).s;
  assert.equal(restored[0].current.price_cents, 810000);
  assert.deepEqual(restored[0].web, p.expected_state[0].web);
  assert.deepEqual(
    restored[0].linked_context,
    p.expected_state[0].linked_context,
  );
  checks++;
  const reversed = await hashes();
  assert.equal(
    (
      await one("select app.m9_reverse_sicar_public_prices($1,$2)r", [
        reverse,
        p.request_id,
      ])
    ).r.replayed,
    true,
  );
  assert.deepEqual(await hashes(), reversed);
  checks++;
  await db.query("savepoint replay_reversed");
  await assert.rejects(() => call(p), /REPLAY_CHANGED/);
  await db.query("rollback to savepoint replay_reversed");
  checks++;
  await db.query("rollback");
  assert.deepEqual(await hashes(), before);
  checks++;
  const result = {
    protocol: "m9-linked-price-local-qa-1",
    database: target.pathname.slice(1),
    checks,
    updated: 1,
    compensated: 1,
    rollback_tables: tables.length,
    rollback_exact: true,
    original_price_journal_reused: true,
    web_source_draft_category_photos_siblings_exact: true,
    original_SHA_and_raw_preserved: true,
    unmapped_secondary_prices_preserved: true,
    stock_cost_woo_finance_writes: 0,
    remote_writes: 0,
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
