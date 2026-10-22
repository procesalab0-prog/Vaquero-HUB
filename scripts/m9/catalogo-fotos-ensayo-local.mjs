// Destructive fixtures are allowed ONLY in this dedicated loopback QA database.
import pg from "pg";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const target = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
  target.pathname !== "/qa_m9_fotos_block2_20261022"
)
  throw Error("DEDICATED_LOCAL_PHOTO_QA_REQUIRED");
if (process.argv.length !== 5)
  throw Error("USAGE: PAYLOAD SOURCE_FAMILIES NEW_RESULT_FILE");
const packet = JSON.parse(await readFile(process.argv[2], "utf8")),
  families = JSON.parse(await readFile(process.argv[3], "utf8"));
const db = new pg.Client({
  connectionString: target.href,
  application_name: "m9-photo-refresh-rollback-only",
});
const competitor = new pg.Client({
  connectionString: target.href,
  application_name: "m9-photo-refresh-competing-editor",
});
const observer = new pg.Client({
  connectionString: target.href,
  application_name: "m9-photo-refresh-lock-observer",
});
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const tables = [
  "public.products",
  "public.variants",
  "public.barcodes",
  "public.m9_variant_details",
  "public.attribute_values",
  "public.variant_attributes",
  "app.m9_rows",
  "app.m9_products",
  "app.web_content_sources",
  "app.web_product_drafts",
  "app.web_variant_photo_evidence",
  "app.web_variant_photo_storage",
  "app.web_category_bindings",
  "public.inventory_by_location",
  "public.inventory_movements",
  "storage.objects",
  "public.audit_log",
];
const hashes = async () => {
  let r = {};
  for (const t of tables)
    r[t] = await one(
      `select count(*)::integer rows,md5(coalesce(string_agg(j,'|' order by j),'')) hash from(select to_jsonb(t)::text j from ${t} t)t`,
    );
  return r;
};
let checks = 0;
const results = {
  local: true,
  synthetic_fixture: true,
  staging_write_performed: false,
};
await db.connect();
await competitor.connect();
await observer.connect();
let competingWrite;
try {
  const original = await hashes();
  await db.query("begin");
  await db.query(
    "set local statement_timeout='30s';set local lock_timeout='5s'",
  );
  await db.query(
    await readFile(
      new URL("./catalogo-fotos-refresh-apply.sql", import.meta.url),
      "utf8",
    ),
  );
  const actors = [
    ...new Set(
      families.flatMap((f) => [
        f.draft.updated_by,
        ...f.copies.map((c) => c.created_by),
      ]),
    ),
  ];
  for (const id of actors) {
    await db.query(
      "insert into auth.users(id) values($1) on conflict(id)do nothing",
      [id],
    );
    await db.query(
      "insert into public.app_users(id,employee_code,full_name,role_id) select $1::uuid,'PHOTOQA-'||upper(substr($1::text,1,8)),'SYNTHETIC PHOTO QA',id from public.roles where code='ADMIN' on conflict(id)do nothing",
      [id],
    );
  }
  await db.query(
    "alter table storage.objects add column if not exists metadata jsonb",
  );
  for (const f of families) {
    const section = f.catalog.variants[0].section;
    await db.query(
      "insert into public.categories(id,name) values($1,$2) on conflict(id) do nothing",
      [f.product.category_id, section],
    );
    await db.query(
      "insert into public.products(id,name,brand_id,category_id,description,is_active,created_by,updated_by,created_at,updated_at,image_path,department_name,measure_unit_code) select id,name,brand_id,category_id,description,is_active,created_by,updated_by,created_at,updated_at,image_path,department_name,measure_unit_code from jsonb_populate_record(null::public.products,$1::jsonb)",
      [f.product],
    );
    for (const v of f.catalog.variants) {
      await db.query(
        "insert into public.variants(id,product_id,sku,cost_cents,price_cents,woocommerce_product_id,woocommerce_variation_id,is_active) values($1,$2,$3,null,$4,$5,$6,$7)",
        [
          v.id,
          f.product_id,
          v.sku,
          v.price_cents,
          v.woo_product_id,
          v.woo_variation_id,
          v.active,
        ],
      );
      await db.query(
        "insert into public.m9_variant_details(variant_id,department,section,source_description) values($1,$2,$3,'SYNTHETIC LOCAL QA DESCRIPTION')",
        [v.id, v.department, v.section],
      );
      await db.query(
        "insert into public.barcodes(variant_id,code,symbology,source,is_primary)values($1,$2,'LEGACY','SICAR',true)",
        [v.id, v.barcode],
      );
      for (const [type, value] of Object.entries(v.attributes)) {
        await db.query(
          "insert into public.attribute_types(code,name)values($1,$2)on conflict(code)do nothing",
          [type, "SYNTHETIC PHOTO QA " + type],
        );
        const a = await one(
          "select id from public.attribute_values where type_code=$1 and value=$2 and scale_code is null",
          [type, value],
        );
        const id =
          a?.id ??
          (
            await one(
              "insert into public.attribute_values(type_code,value)values($1,$2)returning id",
              [type, value],
            )
          ).id;
        await db.query(
          "insert into public.variant_attributes(variant_id,type_code,value_id)values($1,$2,$3)",
          [v.id, type, id],
        );
      }
      await db.query(
        "insert into app.m9_rows(barcode,variant_id,source_row,source_sha256)values($1,$2,app.m9_current_row($2),$3)",
        [v.barcode, v.id, "a".repeat(64)],
      );
    }
    await db.query(
      "insert into app.m9_products(woo_id,product_id,section,source_name)values($1,$2,$3,$4)",
      [f.woo_product_id, f.product_id, section, f.product.name],
    );
    await db.query(
      "insert into app.web_content_sources select * from jsonb_populate_record(null::app.web_content_sources,$1::jsonb)",
      [f.source],
    );
    await db.query(
      "insert into app.web_product_drafts select * from jsonb_populate_record(null::app.web_product_drafts,$1::jsonb)",
      [f.draft],
    );
    for (const row of f.evidence) {
      const e = { ...row };
      delete e.row_hash;
      await db.query(
        "insert into app.web_variant_photo_evidence select * from jsonb_populate_record(null::app.web_variant_photo_evidence,$1::jsonb)",
        [e],
      );
    }
    for (const row of f.copies) {
      const c = { ...row };
      delete c.row_hash;
      await db.query(
        "insert into app.web_variant_photo_storage select * from jsonb_populate_record(null::app.web_variant_photo_storage,$1::jsonb)",
        [c],
      );
    }
    for (const e of f.evidence)
      for (const p of e.photos) {
        const suffix = {
            "image/jpeg": "jpg",
            "image/png": "png",
            "image/webp": "webp",
          }[p.mime],
          name = `${f.product_id}/${p.sha256}.${suffix}`;
        if (
          !(await one(
            "select 1 from storage.objects where bucket_id='product-images' and name=$1",
            [name],
          ))
        )
          await db.query(
            "insert into storage.objects(bucket_id,name,metadata)values('product-images',$1,$2)",
            [name, { size: p.bytes, mimetype: p.mime }],
          );
      }
    const category = packet.families.find(
      (p) => p.product_id === f.product_id,
    ).category_before;
    if (category)
      await db.query(
        "insert into app.web_category_bindings select * from jsonb_populate_record(null::app.web_category_bindings,$1::jsonb)",
        [category],
      );
  }
  // DB timestamps/defaults/row hashes are authoritative for the synthetic fixture.
  // Source data, IDs, attributes, expected gallery and byte proofs stay unmodified.
  const p = structuredClone(packet);
  for (const f of p.families) {
    f.product_before = (
      await one("select to_jsonb(p)row from public.products p where id=$1", [
        f.product_id,
      ])
    ).row;
    assert.equal(
      (
        await one("select md5(app.web_catalog_snapshot($1)::text)hash", [
          f.product_id,
        ])
      ).hash,
      f.catalog_hash,
    );
  }
  const call = async (x) =>
    (
      await one("select app.m9_apply_variant_photo_refresh($1::jsonb)result", [
        x,
      ])
    ).result;
  const initial = await hashes();
  async function reject(mutate, expected, edit) {
    await db.query("savepoint photo_reject");
    const x = structuredClone(p);
    mutate?.(x);
    if (edit) await edit(x);
    let message;
    try {
      await call(x);
    } catch (e) {
      message = e.message;
    }
    await db.query("rollback to savepoint photo_reject");
    assert.ok(
      message?.includes(expected),
      `expected ${expected}, got ${message}`,
    );
    assert.deepEqual(await hashes(), initial);
    checks++;
  }
  await reject(
    (x) => (x.families[0].source_before.snapshot.source_status = "draft"),
    "LIVE_CONTEXT_CHANGED",
  );
  await reject(
    (x) => (x.families[0].new_items[0].barcode = "wrong"),
    "NEW_IDENTITY_CHANGED",
  );
  await reject(
    (x) => (x.families[0].new_items[0].source_variant.status = "draft"),
    "NEW_IDENTITY_CHANGED",
  );
  await reject(
    (x) => (x.families[0].woo_variants[0].attributes = []),
    "PREVIOUS_EVIDENCE_NOT_REVALIDATED",
  );
  await reject(
    (x) => (x.file_proofs[0].url = "https://evil.example/a.jpg"),
    "INVALID_BYTE_PROOF",
  );
  await reject((x) => (x.file_proofs[0].bytes = 4194305), "INVALID_BYTE_PROOF");
  await reject(
    (x) => (x.file_proofs[0].sha256 = "c".repeat(64)),
    "BYTES_NOT_VERIFIED",
  );
  await reject(
    (x) => (x.families[0].catalog_hash = "c".repeat(32)),
    "LIVE_CONTEXT_CHANGED",
  );
  // Update the fixture and its packet expectations together: the new guard
  // must still reject an old catalog fingerprint, not merely a stale packet.
  await reject(null, "PREVIOUS_CATALOG_CHANGED", async (x) => {
    const f = x.families.find((f) => f.evidence_before.length),
      e = f.evidence_before[0];
    await db.query(
      "update app.web_variant_photo_evidence set catalog_fingerprint=$2 where variant_id=$1",
      [e.variant_id, "b".repeat(32)],
    );
    e.catalog_fingerprint = "b".repeat(32);
    const h = (
      await one(
        "select md5(to_jsonb(e)::text)h from app.web_variant_photo_evidence e where variant_id=$1",
        [e.variant_id],
      )
    ).h;
    await db.query(
      "update app.web_variant_photo_storage set evidence_hash=$2 where variant_id=$1",
      [e.variant_id, h],
    );
    f.copies_before.find((c) => c.variant_id === e.variant_id).evidence_hash =
      h;
  });
  await reject(null, "PREVIOUS_CATALOG_CHANGED", async (x) => {
    const f = x.families.find((f) =>
        f.evidence_before.some((e) => e.supplemental),
      ),
      e = f.evidence_before.find((e) => e.supplemental);
    const snapshot = structuredClone(f.source_before.snapshot);
    snapshot.variants.push({
      barcode: e.barcode,
      woo_variation_id: e.woo_variation_id + 900000,
      attributes_sicar: {},
    });
    await db.query(
      "update app.web_content_sources set snapshot=$2 where product_id=$1",
      [f.product_id, snapshot],
    );
    f.source_before = (
      await one(
        "select to_jsonb(s)row from app.web_content_sources s where product_id=$1",
        [f.product_id],
      )
    ).row;
    const h = (
      await one(
        "select md5(to_jsonb(s)::text)h from app.web_content_sources s where product_id=$1",
        [f.product_id],
      )
    ).h;
    await db.query(
      "update app.web_variant_photo_evidence set source_fingerprint=$2 where product_id=$1",
      [f.product_id, h],
    );
    await db.query(
      "update app.web_variant_photo_storage c set evidence_hash=md5(to_jsonb(e)::text)from app.web_variant_photo_evidence e where c.variant_id=e.variant_id and e.product_id=$1",
      [f.product_id],
    );
    f.evidence_before = (
      await one(
        "select jsonb_agg(to_jsonb(e)order by e.variant_id)rows from app.web_variant_photo_evidence e where product_id=$1",
        [f.product_id],
      )
    ).rows;
    f.copies_before = (
      await one(
        "select jsonb_agg(to_jsonb(c)order by c.variant_id)rows from app.web_variant_photo_storage c join app.web_variant_photo_evidence e on e.variant_id=c.variant_id where e.product_id=$1",
        [f.product_id],
      )
    ).rows;
    f.category_before = (
      await one(
        "select to_jsonb(b)row from app.web_category_bindings b where product_id=$1",
        [f.product_id],
      )
    ).row;
  });
  await reject(null, "PREVIOUS_CATALOG_CHANGED", async (x) => {
    const f = x.families.find((f) => f.evidence_before.length),
      e = f.evidence_before[0];
    await db.query(
      "update public.attribute_values set value=value||' QA edit' where id=(select value_id from public.variant_attributes where variant_id=$1 limit 1)",
      [e.variant_id],
    );
    await db.query(
      "update app.m9_rows set source_row=app.m9_rehearsal_current_row(variant_id)",
    );
    for (const family of x.families)
      family.catalog_hash = (
        await one("select md5(app.web_catalog_snapshot($1)::text)h", [
          family.product_id,
        ])
      ).h;
  });
  await reject(null, "PREVIOUS_CATALOG_CHANGED", async (x) => {
    const f = x.families.find((f) =>
        f.evidence_before.some((e) => e.supplemental),
      ),
      e = f.evidence_before.find((e) => e.supplemental);
    await db.query(
      "update app.web_variant_photo_evidence set supplemental=false where variant_id=$1",
      [e.variant_id],
    );
    e.supplemental = false;
    const h = (
      await one(
        "select md5(to_jsonb(e)::text)h from app.web_variant_photo_evidence e where variant_id=$1",
        [e.variant_id],
      )
    ).h;
    await db.query(
      "update app.web_variant_photo_storage set evidence_hash=$2 where variant_id=$1",
      [e.variant_id, h],
    );
    f.copies_before.find((c) => c.variant_id === e.variant_id).evidence_hash =
      h;
  });
  const pid = p.families[0].product_id;
  await reject(null, "LIVE_CONTEXT_CHANGED", () =>
    db.query(
      "update public.products set image_path=id::text||'/00000000-0000-4000-8000-000000000001.jpg' where id=$1",
      [pid],
    ),
  );
  await reject(null, "LIVE_CONTEXT_CHANGED", () =>
    db.query(
      "update app.web_product_drafts set content=jsonb_set(content,'{images}','[]')where product_id=$1",
      [pid],
    ),
  );
  await reject(null, "EVIDENCE_OR_COPY_CHANGED", () =>
    db.query(
      "update app.web_variant_photo_storage set photos=jsonb_set(photos,'{0,alt}','\"Manual edit\"')where variant_id=(select variant_id from app.web_variant_photo_evidence where product_id=$1 limit 1)",
      [pid],
    ),
  );
  await reject(null, "PREVIOUS_OBJECT_CHANGED", () =>
    db.query(
      "update storage.objects set metadata=jsonb_set(metadata,'{size}','1')where name like $1",
      [pid + "/%"],
    ),
  );
  await db.query(`create function pg_temp.fail_photo_receipt() returns trigger language plpgsql as $$begin raise exception 'PHOTO_FAIL_AFTER_ALL_WRITES';end$$;
  create trigger photo_fail_receipt before insert on app.m9_variant_photo_refreshes for each row execute function pg_temp.fail_photo_receipt()`);
  await reject(null, "PHOTO_FAIL_AFTER_ALL_WRITES");
  await db.query(
    "drop trigger photo_fail_receipt on app.m9_variant_photo_refreshes",
  );
  // Writer first: FOR UPDATE takes ROW SHARE on products. Maintenance must wait
  // there, before locking copies; this writer's later INSERT can then complete.
  await competitor.query(
    "begin;set local statement_timeout='10s';set local lock_timeout='8s';select id from public.products where false for update",
  );
  const writerPid = (await competitor.query("select pg_backend_pid()pid"))
    .rows[0].pid;
  const refreshPid = (await one("select pg_backend_pid()pid")).pid;
  const pendingFirst = call(p).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  let writerFirstObserved = false;
  for (let n = 0; n < 100; n++) {
    const blockers = (
      await observer.query("select pg_blocking_pids($1)b", [refreshPid])
    ).rows[0].b;
    if (blockers.includes(writerPid)) {
      writerFirstObserved = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(
    writerFirstObserved,
    true,
    "PHOTO_ROW_SHARE_WRITER_FIRST_CONTENTION_NOT_OBSERVED",
  );
  await competitor.query(
    "insert into app.web_variant_photo_storage select * from app.web_variant_photo_storage where false",
  );
  await competitor.query("commit");
  const firstOutcome = await pendingFirst;
  if (firstOutcome.error) throw firstOutcome.error;
  const first = firstOutcome.value;
  checks++;
  assert.equal(first.created, 24);
  assert.equal(first.previous_evidence_revalidated, 25);
  const after = await hashes(),
    auditCount = (await one("select count(*)::int n from public.audit_log")).n;
  const replay = await call(p);
  assert.equal(replay.replayed, true);
  assert.deepEqual(await hashes(), after);
  assert.equal(
    (await one("select count(*)::int n from public.audit_log")).n,
    auditCount,
  );
  checks++;
  await db.query("savepoint replay_change");
  await db.query(
    "update public.products set name=name||' edited' where id=$1",
    [pid],
  );
  await assert.rejects(() => call(p), /REPLAY_CHANGED/);
  await db.query("rollback to savepoint replay_change");
  checks++;
  await db.query("savepoint immutable_receipt");
  await assert.rejects(
    () =>
      db.query(
        "update app.m9_variant_photo_refreshes set packet='{}' where request_id=$1",
        [p.request_id],
      ),
    /RECEIPT_IMMUTABLE/,
  );
  await db.query("rollback to savepoint immutable_receipt");
  checks++;
  await db.query("savepoint copied_new_photo");
  const newVariant = p.families[0].new_items[0].variant_id;
  await db.query(
    "insert into app.web_variant_photo_storage(variant_id,evidence_hash,photos,created_by)select variant_id,md5(to_jsonb(e)::text),'[]'::jsonb,$2 from app.web_variant_photo_evidence e where variant_id=$1",
    [newVariant, actors[0]],
  );
  await assert.rejects(
    () =>
      db.query("select app.m9_reverse_variant_photo_refresh($1)", [
        p.request_id,
      ]),
    /REVERSAL_CONTEXT_CHANGED/,
  );
  await db.query("rollback to savepoint copied_new_photo");
  checks++;
  await db.query("savepoint changed_object_after_apply");
  await db.query(
    "update storage.objects set metadata=jsonb_set(metadata,'{size}','1')where name like $1",
    [pid + "/%"],
  );
  await assert.rejects(
    () =>
      db.query("select app.m9_reverse_variant_photo_refresh($1)", [
        p.request_id,
      ]),
    /REVERSAL_CONTEXT_CHANGED/,
  );
  await db.query("rollback to savepoint changed_object_after_apply");
  checks++;
  assert.equal(
    (
      await one(
        "select count(*)::int n from app.web_category_bindings where product_id=any($1::uuid[])and invalidated_at is not null",
        [p.families.map((f) => f.product_id)],
      )
    ).n,
    7,
  );
  for (const t of [
    "public.products",
    "public.variants",
    "public.barcodes",
    "app.m9_rows",
    "app.web_product_drafts",
    "public.inventory_by_location",
    "public.inventory_movements",
  ])
    assert.deepEqual(after[t], initial[t]);
  checks++;
  // Observe an actual second connection waiting on the maintenance table lock.
  await competitor.query("set statement_timeout='10s';set lock_timeout='8s'");
  const otherPid = (await competitor.query("select pg_backend_pid()pid"))
    .rows[0].pid;
  competingWrite = competitor.query(
    "select id from public.products where id=$1 for update",
    [pid],
  );
  let observed = false;
  for (let n = 0; n < 100; n++) {
    if (
      (await one("select pg_blocking_pids($1) blockers", [otherPid])).blockers
        .length
    ) {
      observed = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(observed, true, "PHOTO_EDITOR_CONTENTION_NOT_OBSERVED");
  checks++;
  const reversed = (
    await one("select app.m9_reverse_variant_photo_refresh($1::uuid)result", [
      p.request_id,
    ])
  ).result;
  assert.equal(reversed.removed, 24);
  const reverted = await hashes();
  for (const t of tables.filter(
    (t) => !["app.web_category_bindings", "public.audit_log"].includes(t),
  ))
    assert.deepEqual(reverted[t], initial[t]);
  checks++;
  for (const role of ["anon", "authenticated", "service_role"]) {
    const acl = await one(
      "select has_function_privilege($1,'app.m9_apply_variant_photo_refresh(jsonb)','EXECUTE')apply,has_function_privilege($1,'app.m9_reverse_variant_photo_refresh(uuid)','EXECUTE')reverse,has_table_privilege($1,'app.m9_variant_photo_refreshes','SELECT')read",
      [role],
    );
    assert.deepEqual(acl, { apply: false, reverse: false, read: false });
    checks++;
  }
  await db.query("rollback");
  assert.equal((await competingWrite).rowCount, 0);
  assert.deepEqual(await hashes(), original);
  Object.assign(results, {
    checks,
    created: 24,
    revalidated: 25,
    byte_files: 7,
    category_holds: 7,
    rollback_verified: true,
    idempotency_verified: true,
    failure_after_all_writes_rolled_back: true,
    compensation_verified: true,
    final_database_tables_unchanged: true,
    storage_bytes_uploaded: 0,
    manual_writer_contention_observed: true,
    row_share_writer_first_observed: true,
    row_share_refresh_first_observed: true,
    reverse_changed_object_held: true,
  });
  await writeFile(process.argv[4], JSON.stringify(results, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(results));
} catch (e) {
  await db.query("rollback");
  if (competingWrite) await competingWrite.catch(() => {});
  throw e;
} finally {
  await db.end();
  await competitor.end();
  await observer.end();
}
