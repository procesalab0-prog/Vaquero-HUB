// Compensate synthetic seed only, preserving the local QA audit/history.
import pg from "pg";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const u = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) ||
  !/^\/qa_[a-z0-9_]+$/i.test(u.pathname)
)
  throw Error("LOCAL_QA_DATABASE_REQUIRED");
const db = new pg.Client({ connectionString: u.href });
await db.connect();
try {
  await db.query("begin");
  assert.equal(
    (
      await db.query(
        "select configured_by from app.sicar_sync_control where singleton",
      )
    ).rows[0]?.configured_by,
    "SYNTHETIC LOCAL QA ONLY",
  );
  const before = (
    await db.query("select count(*)::int n from public.inventory_movements")
  ).rows[0].n;
  const residual = (
    await db.query(
      `select i.*,b.code from public.inventory_by_location i join public.barcodes b on b.variant_id=i.variant_id and b.is_primary where i.qty<>0 or i.reserved_qty<>0 order by i.location_id,i.variant_id`,
    )
  ).rows;
  for (const r of residual) {
    assert.match(r.code, /^QA-RACE-[0-9]+-[0-9]+$/);
    assert.equal(Number(r.reserved_qty), 0);
    assert.equal(Number(r.qty), 1);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.inventory_movements where variant_id=$1 and location_id=$2 and reference_type='SYNTHETIC_LOCAL_RACE' and movement_type='INITIAL_IMPORT'",
          [r.variant_id, r.location_id],
        )
      ).rows[0].n,
      1,
    );
    const actor = (
      await db.query(
        "select u.id from public.app_users u join public.user_locations l on l.user_id=u.id join public.roles ro on ro.id=u.role_id where l.location_id=$1 and u.full_name like 'SYNTHETIC %' and ro.code='ADMIN' order by u.created_at desc limit 1",
        [r.location_id],
      )
    ).rows[0]?.id;
    assert.ok(actor);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      actor,
    ]);
    await db.query(
      "select app.apply_movement($1,$2,'ADJUSTMENT',-1,'SYNTHETIC_LOCAL_RACE_CLEANUP',$3,'{\"synthetic\":true,\"reason\":\"Retire fictitious QA seed after compensated tests\"}')",
      [r.variant_id, r.location_id, r.variant_id],
    );
  }
  const counts = (
    await db.query(
      "select count(*)::int n from public.inventory_by_location where qty<>0 or reserved_qty<>0",
    )
  ).rows[0].n;
  assert.equal(counts, 0);
  const enabled = (
    await db.query(
      "select (select enabled from app.m9_woo_pilot_control where singleton)or(select enabled from app.m9_woo_finance_pilot_control where singleton)or(select enabled from app.m9_rehearsal_control where singleton) as enabled",
    )
  ).rows[0].enabled;
  assert.equal(enabled, false);
  const after = (
    await db.query("select count(*)::int n from public.inventory_movements")
  ).rows[0].n;
  assert.equal(after - before, residual.length);
  await db.query("commit");
  const report = {
    synthetic_only: true,
    retired_seed_units: residual.length,
    compensating_movements: after - before,
    remaining_stock_and_reservations: 0,
    all_controls_disabled: true,
    audit_deleted: false,
    staging_written: false,
    production_written: false,
  };
  if (process.env.QA_OUTPUT_DIR)
    await writeFile(
      process.env.QA_OUTPUT_DIR + "/cleanup.json",
      JSON.stringify(report, null, 2),
    );
  console.log(JSON.stringify(report));
} catch (e) {
  await db.query("rollback");
  throw e;
} finally {
  await db.end();
}
