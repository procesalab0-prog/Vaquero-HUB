// Isolated incremental rehearsal. Never accepts a remote or shared database.
import pg from "pg";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const target = process.env.QA_DATABASE_URL;
if (target !== "postgresql://postgres:postgres@127.0.0.1:59322/postgres")
  throw Error("ISOLATED_OCTOBER_QA_REQUIRED");
const db = new pg.Client({ connectionString: target });
await db.connect();
try {
  const output = process.argv[2];
  if (!output) throw Error("OUTPUT_REQUIRED");
  const defs = JSON.parse(
    await readFile(output + "/main-function-definitions.json"),
  );
  const comparison = [];
  for (const d of defs) {
    const local = (
      await db.query("select pg_get_functiondef($1::regprocedure) definition", [
        d.signature,
      ])
    ).rows[0].definition;
    comparison.push({ signature: d.signature, exact: local === d.definition });
    // Rehearse the exact hosted definition even if formatting differs.
    if (local !== d.definition) await db.query(d.definition);
  }
  await db.query(`insert into app.main_m9_review_cuts(cut_sha,ready) values(repeat('f',64),false);
 insert into app.main_m9_owner_questions(cut_sha,question_id,evidence,evidence_hash,batch,released_at)
 values(repeat('f',64),repeat('e',64),'{"fixture":"isolated-upgrade-only"}',md5('{"fixture":"isolated-upgrade-only"}'),1,now());
 insert into app.main_m9_owner_answers(request_id,cut_sha,question_id,revision,actor,choice,note,commercial_name)
 select gen_random_uuid(),repeat('f',64),repeat('e',64),1,id,'UNSURE','Synthetic preservation fixture; never an owner answer','' from public.app_users order by id limit 1;`);
  const tables = (
    await db.query(
      `select schemaname,tablename from pg_tables where schemaname in ('public','app') order by 1,2`,
    )
  ).rows;
  async function fingerprint() {
    const result = {};
    for (const t of tables) {
      const name = '"' + t.schemaname + '"."' + t.tablename + '"';
      const value =
        t.tablename === "sale_payments"
          ? "to_jsonb(t)-'card_kind'"
          : "to_jsonb(t)";
      result[name] = (
        await db.query(
          `select count(*)::int rows,md5(coalesce(string_agg((${value})::text,',' order by (${value})::text),'')) hash from ${name} t`,
        )
      ).rows[0];
    }
    return result;
  }
  const before = await fingerprint();
  assert(before['"public"."variants"'].rows > 0);
  assert(before['"public"."inventory_movements"'].rows > 0);
  await db.query(
    await readFile(
      "supabase/migrations/20261009200155_operational_october.sql",
      "utf8",
    ),
  );
  const after = await fingerprint();
  assert.deepEqual(after, before);
  await db.query("notify pgrst,'reload schema'");
  await writeFile(
    output + "/upgrade-preservation.json",
    JSON.stringify(
      {
        status: "PASS",
        scope: "LOCAL_AUTH_POSTGREST_INCREMENTAL",
        definitions: comparison,
        tables_preserved: tables.length,
        before,
        after,
        production_writes: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Incremental migration PASS: " +
      tables.length +
      " existing tables preserved, including identities, money, inventory and synthetic owner answer.",
  );
} finally {
  await db.end();
}
