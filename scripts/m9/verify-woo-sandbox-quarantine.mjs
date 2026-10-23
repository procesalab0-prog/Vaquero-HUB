// Offline QA/verification only. Does not read .env, credentials or any service.
import { generateKeyPairSync, sign, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, readdir, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import {
  canonicalQaJson,
  verifyLocalSandboxAttestation,
  quarantineLocalSandboxAttestation,
  lookupLocalQuarantineReceipt,
  SANDBOX_PROVIDER_RECEIVER,
} from "./woo-sandbox-auth-quarantine.mjs";
import {
  WOO_PILOT_ORIGIN,
  WOO_STAGING_PROJECT,
} from "./woo-order-protocol.mjs";
const hash = (v) => createHash("sha256").update(v).digest("hex");
const [mode, path, ...extra] = process.argv.slice(2);
if (!["--output", "--verify"].includes(mode) || !path || extra.length)
  throw Error(
    "Use --output <new-private-directory> or --verify <existing-directory>",
  );
const root = resolve(path);
if (mode === "--verify") {
  const manifest = JSON.parse(
    await readFile(join(root, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.protocol, "m9-local-signature-quarantine-proof-1");
  assert.ok(Object.keys(manifest.files).includes("proof.json"));
  for (const [name, wanted] of Object.entries(manifest.files)) {
    assert.match(
      name,
      /^(proof\.json|quarantine\/receipts\/[a-f0-9]{64}\.json)$/,
    );
    assert.equal(hash(await readFile(join(root, name))), wanted);
  }
  const proof = JSON.parse(await readFile(join(root, "proof.json"), "utf8"));
  for (const id of proof.receipt_ids) {
    const r = await lookupLocalQuarantineReceipt(join(root, "quarantine"), id);
    assert.equal(r.provider_authenticated, false);
    assert.equal(r.record.can_record_book_event, false);
  }
  assert.equal(proof.provider_authenticated, false);
  assert.equal(proof.remote_orders_created, 0);
  assert.equal(proof.native_writes, 0);
  let locked = false;
  try {
    await lstat(join(root, "quarantine", "write.lock"));
    locked = true;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  assert.equal(locked, false);
  console.log(
    JSON.stringify({
      status: "PASS",
      mode: "OFFLINE_ARCHIVE_SIGNATURE_AND_HASH_VERIFICATION",
      provider_authenticated: false,
      receipts: proof.receipt_ids.length,
    }),
  );
} else {
  await mkdir(root, { mode: 0o700 });
  const keys = generateKeyPairSync("ed25519"),
    time = Date.now();
  const trust = {
    mode: "LOCAL_QA_ONLY",
    issuer: "M9_LOCAL_QA_NOT_A_GATEWAY",
    key_id: "SYNTHETIC-QA-EPHEMERAL-KEY",
    public_key_pem: keys.publicKey.export({ format: "pem", type: "spki" }),
    account_id: "SYNTHETIC-QA-ACCOUNT",
    merchant_id: "SYNTHETIC-QA-MERCHANT",
    valid_from: new Date(time - 60000).toISOString(),
    valid_until: new Date(time + 600000).toISOString(),
    revoked: false,
  };
  const now = new Date(time).toISOString(),
    tx = "SYNTHETIC-QA-CAPTURE-" + randomUUID();
  const make = (
    kind,
    amount,
    transaction,
    related = null,
    settlement = null,
    order = 900000101,
  ) => ({
    protocol: "m9-local-sandbox-attestation-1",
    audience: "m9-local-quarantine-only",
    issuer: trust.issuer,
    key_id: trust.key_id,
    mode: "LOCAL_QA_ONLY",
    live_mode: false,
    project: WOO_STAGING_PROJECT,
    origin: WOO_PILOT_ORIGIN,
    account_id: trust.account_id,
    merchant_id: trust.merchant_id,
    nonce: randomUUID(),
    issued_at: now,
    expires_at: new Date(time + 120000).toISOString(),
    event: {
      kind,
      event_reference: "SYNTHETIC-QA-EVENT-" + randomUUID(),
      transaction_reference: transaction,
      related_transaction_reference: related,
      order_id: order,
      currency: "MXN",
      amount,
      order_components: {
        items_subtotal: "200.00",
        discount_total: "20.00",
        shipping_total: "10.00",
        shipping_tax: "1.60",
        cart_tax: "29.60",
        total_tax: "31.20",
        fees_total: "5.00",
        fee_tax: "0.80",
        total: "226.20",
      },
      provider_fee: kind === "PROVIDER_FEE" ? amount : "0.00",
      settlement,
    },
  });
  const signed = (body) => {
    const raw = Buffer.from(canonicalQaJson(body));
    return {
      raw,
      signature: sign(null, raw, keys.privateKey).toString("base64"),
      trust,
      now,
    };
  };
  const capture = signed(make("CAPTURE", "200.00", tx));
  const packets = [
    signed(make("AUTHORIZATION", "200.00", tx)),
    capture,
    signed(make("REFUND", "20.00", "SYNTHETIC-QA-REFUND-" + randomUUID(), tx)),
    signed(
      make("PROVIDER_FEE", "7.00", "SYNTHETIC-QA-FEE-" + randomUUID(), tx),
    ),
    signed(
      make(
        "SETTLEMENT",
        "173.00",
        "SYNTHETIC-QA-PAYOUT-" + randomUUID(),
        null,
        {
          gross_captured: "200.00",
          refunded: "20.00",
          provider_fees: "7.00",
          fee_reversals: "0.00",
          prior_settlements: "0.00",
          net: "173.00",
        },
      ),
    ),
    signed(make("CAPTURE", "200.00", tx, null, null, 900000102)),
    signed(
      make(
        "REFUND",
        "10.00",
        "SYNTHETIC-QA-ORPHAN-" + randomUUID(),
        "SYNTHETIC-QA-UNKNOWN-CAPTURE",
        null,
        900000103,
      ),
    ),
  ];
  const receipts = [];
  for (const p of packets)
    receipts.push(
      await quarantineLocalSandboxAttestation({
        directory: join(root, "quarantine"),
        ...p,
      }),
    );
  const replay = await quarantineLocalSandboxAttestation({
    directory: join(root, "quarantine"),
    ...capture,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.receipt_id, receipts[1].receipt_id);
  const altered = { ...capture, raw: Buffer.from(capture.raw) };
  altered.raw[altered.raw.length - 1] ^= 1;
  assert.throws(
    () => verifyLocalSandboxAttestation(altered),
    /QA_SIGNATURE_INVALID/,
  );
  assert.equal(receipts[5].record.status, "QUARANTINED_CONFLICT");
  assert.ok(
    receipts[6].record.reasons.includes(
      "CAUSAL_PARENT_NOT_CONFIRMED_IN_LOCAL_QUARANTINE",
    ),
  );
  const proof = {
    mode: "LOCAL_QA_SIGNATURE_ONLY_NOT_PROVIDER",
    provider_authenticated: false,
    provider_receiver_enabled: SANDBOX_PROVIDER_RECEIVER.enabled,
    public_route_installed: false,
    remote_orders_created: 0,
    native_writes: 0,
    private_keys_persisted: 0,
    signature_tampering_rejected: true,
    replay_receipt_stable: true,
    monetary_duplicate_quarantined: true,
    unknown_parent_held: true,
    fee_woo_cents: 500,
    provider_fee_cents: 700,
    settlement_declared_cents: 17300,
    bank_verified: false,
    receipt_ids: receipts.map((r) => r.receipt_id),
    module_sha256: hash(
      await readFile(
        new URL("./woo-sandbox-auth-quarantine.mjs", import.meta.url),
      ),
    ),
  };
  await writeFile(
    join(root, "proof.json"),
    JSON.stringify(proof, null, 2) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  const files = {
    "proof.json": hash(await readFile(join(root, "proof.json"))),
  };
  for (const name of (
    await readdir(join(root, "quarantine", "receipts"))
  ).sort())
    files["quarantine/receipts/" + name] = hash(
      await readFile(join(root, "quarantine", "receipts", name)),
    );
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify(
      { protocol: "m9-local-signature-quarantine-proof-1", files },
      null,
      2,
    ) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    JSON.stringify({
      status: "PASS",
      mode: proof.mode,
      provider_authenticated: false,
      receipts: receipts.length,
      output: root,
    }),
  );
}
