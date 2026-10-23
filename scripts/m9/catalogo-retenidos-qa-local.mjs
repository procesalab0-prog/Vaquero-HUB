import pg from "pg";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const url = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  url.pathname !== "/qa_m9_retenidos_block5_20261022"
)
  throw Error("DEDICATED_LOCAL_HELD_QA_REQUIRED");
if (process.argv.length !== 5)
  throw Error("USAGE: PAYLOAD OLD_ARCHIVE_8515 NEW_RESULT");
const p = JSON.parse(await readFile(process.argv[2], "utf8")),
  archive = JSON.parse(await readFile(process.argv[3], "utf8")),
  db = new pg.Client({ connectionString: url.href });
let checks = 0;
await db.connect();
const one = async (q, a = []) => (await db.query(q, a)).rows[0];
try {
  const tables = (
    await db.query(
      "select schemaname||'.'||tablename name from pg_tables where schemaname in('app','public')order by 1",
    )
  ).rows.map((r) => r.name);
  const hashSQL =
      "select jsonb_object_agg(name,jsonb_build_object('rows',n,'hash',hash))h from(" +
      tables
        .map(
          (t) =>
            `select '${t}' name,count(*)n,md5(coalesce(string_agg(j,'|'order by j),''))hash from(select to_jsonb(t)::text j from ${t} t)x`,
        )
        .join(" union all ") +
      ")x",
    hashes = async () => (await one(hashSQL)).h,
    baseline = await hashes();
  await db.query(
    "begin;set local statement_timeout='30s';set local lock_timeout='5s';set local timezone='UTC'",
  );
  await db.query(
    await readFile(
      new URL("./catalogo-retenidos-index.sql", import.meta.url),
      "utf8",
    ),
  );
  const actor = (
    await one(
      "select u.id from public.app_users u join public.roles r on r.id=u.role_id where u.is_active and r.code='ADMIN'order by u.id limit 1",
    )
  ).id;
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
  const cut =
    "6194431341d80e14902bf6018c4cffedd712aea0d3af3a2cd1c9c9deec965858";
  assert.equal(archive.length, 8515);
  await db.query(
    "insert into app.m9_review_cuts(cut_sha,sicar_sha,woo_sha,source_count,managed_count,expected_count,ready)values($1,'171200f4b21f1a1f11bd977739d3e80a7f191b09977d2cdffcee1a6a4daab12a','6a4bf69ecf715010645d4d3974c7c01a80a3690df9efd1d3268f3d55f051d1e1',16224,7709,8515,true)",
    [cut],
  );
  await db.query(
    "insert into app.m9_pending_review(cut_sha,barcode,evidence)select $1,x->>'barcode',x from jsonb_array_elements($2::jsonb)x",
    [cut, JSON.stringify(archive)],
  );
  const initial = await hashes(),
    call = async (x) =>
      (await one("select app.m9_archive_held_references($1::jsonb)r", [x])).r,
    read = async (q = { q: "", exact: false, reason: "ALL", page: 1 }) =>
      (await one("select public.m9_held_reference_read($1::jsonb)r", [q])).r;
  assert.equal((await read()).ready, false);
  checks++;
  async function reject(mutate, expected, edit) {
    await db.query("savepoint bad_held");
    const x = structuredClone(p);
    mutate?.(x);
    if (edit) await edit();
    let error;
    try {
      await call(x);
    } catch (e) {
      error = e;
      if (!expected.test(e.message))
        console.error(e.where ?? e.detail ?? e.message);
    }
    await db.query("rollback to savepoint bad_held");
    assert.match(error?.message ?? "", expected);
    assert.deepEqual(await hashes(), initial);
    checks++;
  }
  await reject((x) => (x.project_id = "drubkjlmfbdeglucakmg"), /EXACT_INDEX/);
  await reject((x) => (x.source_sha256 = "a".repeat(64)), /EXACT_INDEX/);
  await reject((x) => (x.rows_json += " "), /EXACT_INDEX/);
  await reject((x) => (x.source_date = "2026-10-23"), /EXACT_INDEX/);
  await reject(null, /ORIGINAL_ARCHIVE_CHANGED/, async () => {
    await db.query(
      "update app.m9_pending_review set evidence=jsonb_set(evidence,'{description}','\"CHANGED\"')where cut_sha=$1 and barcode='000007779'",
      [cut],
    );
  });
  await reject(null, /CODE_NOW_IN_CATALOG/, async () => {
    const variant = (
      await one("select id from public.variants order by id limit 1")
    ).id;
    await db.query(
      "insert into public.barcodes(variant_id,code,source,symbology,is_primary)values($1,'000007779','MANUAL','CODE128',false)",
      [variant],
    );
  });
  await db.query(
    "create function pg_temp.fail_held_receipt()returns trigger language plpgsql as $$begin raise exception 'FAIL_AFTER_HELD_INSERT';end$$;create trigger fail_held_receipt after insert on app.m9_held_reference_indexes for each row execute function pg_temp.fail_held_receipt()",
  );
  await reject(null, /FAIL_AFTER_HELD_INSERT/);
  await db.query(
    "drop trigger fail_held_receipt on app.m9_held_reference_indexes",
  );
  assert.equal((await call(p)).reference_count, 435);
  checks++;
  const after = await hashes();
  for (const t of tables.filter((t) => t !== "public.audit_log"))
    assert.deepEqual(after[t], initial[t], t);
  checks++;
  assert.equal((await call(p)).replayed, true);
  assert.deepEqual(await hashes(), after);
  checks++;
  const first = await read();
  assert.equal(first.total, 435);
  assert.equal(first.reason_counts.DISPLAY_OR_SALES_RESTRICTION, 316);
  assert.equal(first.price_subgroups.extra_decimals, 38);
  assert.equal(first.price_subgroups.zero, 2);
  checks++;
  const all = [];
  for (let page = 1; page <= 22; page++) {
    const r = await read({ q: "", exact: false, reason: "ALL", page });
    all.push(...r.rows);
    for (const x of r.rows) {
      assert.equal(x.sell_allowed, false);
      assert.equal(x.stock_allowed, false);
      assert.equal(x.woo_allowed, false);
      assert.equal(x.catalog_now_present, false);
      assert.equal(x.origin_intact, true);
    }
  }
  assert.equal(all.length, 435);
  assert.equal(new Set(all.map((r) => r.barcode)).size, 435);
  checks++;
  for (const [reason, n] of Object.entries(first.reason_counts)) {
    const seen = [];
    for (let page = 1; page <= Math.ceil(n / 20); page++) {
      const r = await read({ q: "", exact: false, reason, page });
      assert.equal(r.total, n);
      assert.ok(r.rows.every((x) => x.reasons.includes(reason)));
      seen.push(...r.rows);
    }
    assert.equal(seen.length, n);
    checks++;
  }
  const exact = await read({
    q: "000007779",
    exact: true,
    reason: "ALL",
    page: 1,
  });
  assert.equal(exact.rows[0].barcode, "000007779");
  assert.equal(exact.rows[0].projection.retail_source, "6299.99944");
  assert.equal(
    (await read({ q: " 000007779", exact: true, reason: "ALL", page: 1 }))
      .total,
    0,
  );
  checks++;
  assert.equal(
    all.find((x) => x.barcode === "9184").projection.retail_source,
    "1990",
  );
  assert.ok(all.some((x) => x.barcode === "18329"));
  assert.equal(
    all.some((x) => ["4481", "9069", "9075"].includes(x.barcode)),
    false,
  );
  checks++;
  await db.query("savepoint original_changed");
  await db.query(
    "update app.m9_pending_review set evidence=jsonb_set(evidence,'{retail_source}','\"1\"')where cut_sha=$1 and barcode='000007779'",
    [cut],
  );
  const changed = await read({
    q: "000007779",
    exact: true,
    reason: "ALL",
    page: 1,
  });
  assert.equal(changed.origin_changed, 1);
  assert.equal(changed.rows[0].origin_intact, false);
  assert.equal(changed.rows[0].projection, null);
  await db.query("rollback to savepoint original_changed");
  checks++;
  for (const q of [
    { q: "", exact: false, reason: "ALL", page: 0 },
    { q: "", exact: "false", reason: "ALL", page: 1 },
    { q: "", exact: false, reason: "XXX", page: 1 },
  ]) {
    await db.query("savepoint invalid_filter");
    await assert.rejects(() => read(q), /FILTER_INVALID/);
    await db.query("rollback to savepoint invalid_filter");
    checks++;
  }
  for (const role of ["anon", "service_role"]) {
    await db.query("savepoint read_acl");
    await db.query("set local role " + role);
    await assert.rejects(() => read(), /permission denied/);
    await db.query("rollback to savepoint read_acl");
    checks++;
  }
  await db.query("savepoint admin_read");
  await db.query("set local role authenticated");
  assert.equal((await read()).total, 435);
  await db.query("rollback to savepoint admin_read");
  checks++;
  for (const role of ["anon", "authenticated", "service_role"]) {
    const acl = await one(
      "select has_function_privilege($1,'app.m9_archive_held_references(jsonb)','EXECUTE')w,has_function_privilege($1,'app.m9_retire_held_references(uuid,uuid,text)','EXECUTE')r,has_table_privilege($1,'app.m9_held_reference_indexes','SELECT')t",
      [role],
    );
    assert.deepEqual(acl, { w: false, r: false, t: false });
    checks++;
  }
  await db.query("savepoint disabled_stage");
  await db.query(
    "update app.sicar_sync_control set catalog_writes_enabled=false where singleton",
  );
  await assert.rejects(() => read(), /SICAR_CATALOG_SYNC_DISABLED/);
  await db.query("rollback to savepoint disabled_stage");
  checks++;
  for (const mode of ["noactor", "inactive", "nonadmin"]) {
    await db.query("savepoint invalid_actor");
    if (mode === "noactor")
      await db.query("select set_config('request.jwt.claim.sub','',true)");
    if (mode === "inactive")
      await db.query(
        "update public.app_users set is_active=false where id=$1",
        [actor],
      );
    if (mode === "nonadmin")
      await db.query(
        "update public.app_users set role_id=(select id from public.roles where code<>'ADMIN' order by code limit 1)where id=$1",
        [actor],
      );
    await assert.rejects(
      () => read(),
      (e) => e.code === "42501",
    );
    await db.query("rollback to savepoint invalid_actor");
    checks++;
  }
  const retirement = "f2000000-0000-4000-8000-000000000001",
    reason = "Local QA logical retirement preserving original source";
  assert.equal(
    (
      await one("select app.m9_retire_held_references($1,$2,$3)r", [
        retirement,
        p.request_id,
        reason,
      ])
    ).r.retired,
    true,
  );
  assert.equal(
    (
      await one("select app.m9_retire_held_references($1,$2,$3)r", [
        retirement,
        p.request_id,
        reason,
      ])
    ).r.replayed,
    true,
  );
  assert.equal((await read()).ready, false);
  checks++;
  await db.query("savepoint retired_replay");
  await assert.rejects(() => call(p), /RETIRED/);
  await db.query("rollback to savepoint retired_replay");
  checks++;
  for (const t of [
    "app.m9_held_reference_indexes",
    "app.m9_held_reference_retirements",
  ]) {
    await db.query("savepoint immutable");
    await assert.rejects(() => db.query("delete from " + t), /IMMUTABLE/);
    await db.query("rollback to savepoint immutable");
    checks++;
    await db.query("savepoint immutable_update");
    await assert.rejects(
      () => db.query("update " + t + " set request_id=request_id"),
      /IMMUTABLE/,
    );
    await db.query("rollback to savepoint immutable_update");
    checks++;
  }
  await db.query("rollback");
  assert.deepEqual(await hashes(), baseline);
  const result = {
    protocol: "m9-held-reference-local-qa-1",
    local_database: url.pathname.slice(1),
    checks,
    archive_count: 435,
    reused433: true,
    delta9184_and_new18329: true,
    display_restricted: 316,
    extra_decimal_prices: 38,
    zero_prices: 2,
    readonly_all_pages: 22,
    raw_archive_unchanged: true,
    rollback_tables: tables.length,
    rollback_exact: true,
    logical_retirement_pass: true,
    admin_authenticated_reader_pass: true,
    remote_writes: 0,
    operational_catalog_stock_woo_writes: 0,
  };
  await writeFile(process.argv[4], JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(result));
} catch (e) {
  await db.query("rollback");
  throw e;
} finally {
  await db.end();
}
