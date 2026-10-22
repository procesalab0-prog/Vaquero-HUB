import { readFile, readdir, writeFile } from "node:fs/promises";
import pg from "pg";
import { createHash } from "node:crypto";
const target = new URL(process.env.QA_DATABASE_URL ?? "postgresql://invalid");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
  !/^\/qa_[a-z0-9_]+$/i.test(target.pathname)
)
  throw Error("LOCAL_QA_DATABASE_REQUIRED");
const db = new pg.Client({ connectionString: target.href });
await db.connect();
try {
  const resume = process.env.QA_RESUME_FROM;
  if (resume && !/^[0-9]{14}_[a-z0-9_]+\.sql$/.test(resume))
    throw Error("INVALID_RESUME");
  if (resume) {
    if (
      (
        await db.query(
          "select configured_by from app.sicar_sync_control where singleton",
        )
      ).rows[0]?.configured_by !== "SYNTHETIC LOCAL QA ONLY"
    )
      throw Error("NOT_OWN_QA_DATABASE");
  }
  if (!resume) {
    if (
      (
        await db.query(
          "select 1 from pg_tables where schemaname in('public','app','auth','storage')limit 1",
        )
      ).rowCount
    )
      throw Error("EMPTY_QA_DATABASE_REQUIRED");
    await db.query(`do $$begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
    if not exists(select 1 from pg_roles where rolname='supabase_admin') then create role supabase_admin; end if;
  end$$;
  create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',created_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
  create function auth.role() returns text language sql stable as $$select coalesce(auth.jwt()->>'role',current_user)$$;
  grant usage on schema auth to anon,authenticated,service_role;
  create schema storage;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
  alter table storage.objects enable row level security;`);
  }
  const directory = new URL("../../supabase/migrations/", import.meta.url);
  const migrations = (await readdir(directory))
    .filter((n) => n.endsWith(".sql"))
    .sort();
  const hashes = [];
  for (const n of migrations) {
    const sql = await readFile(new URL(n, directory), "utf8");
    try {
      if (!resume || n >= resume) await db.query(sql);
    } catch (e) {
      await db.query("rollback");
      throw new Error("Migration " + n + ": " + e.message, { cause: e });
    }
    if (n === "20260907221244_m9_catalog_sync_staging.sql")
      await db.query(
        "update app.sicar_sync_control set environment_label='STAGING',catalog_writes_enabled=true,configured_by='SYNTHETIC LOCAL QA ONLY',configured_at=now()where singleton",
      );
    hashes.push({
      file: n,
      sha256: createHash("sha256").update(sql).digest("hex"),
    });
  }
  if (process.env.QA_OUTPUT_DIR)
    await writeFile(
      process.env.QA_OUTPUT_DIR + "/migrations.json",
      JSON.stringify(hashes, null, 2),
    );
  console.log(
    JSON.stringify({
      local: true,
      database: target.pathname.slice(1),
      migrations: hashes.length,
      status: "PASS",
    }),
  );
} finally {
  await db.end();
}
