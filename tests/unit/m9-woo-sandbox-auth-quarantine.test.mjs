import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import {
  mkdtemp,
  readdir,
  readFile,
  writeFile,
  rm,
  open,
  unlink,
  chmod,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  SANDBOX_PROVIDER_RECEIVER,
  receiveSandboxProviderEvidence,
  canonicalQaJson,
  verifyLocalSandboxAttestation,
  quarantineLocalSandboxAttestation,
  lookupLocalQuarantineReceipt,
} from "../../scripts/m9/woo-sandbox-auth-quarantine.mjs";
import {
  WOO_PILOT_ORIGIN,
  WOO_STAGING_PROJECT,
} from "../../scripts/m9/woo-order-protocol.mjs";

const now = "2026-10-22T23:40:00.000Z";
const keys = generateKeyPairSync("ed25519");
const publicPem = keys.publicKey.export({ format: "pem", type: "spki" });
function make(kind = "CAPTURE") {
  const body = {
    protocol: "m9-local-sandbox-attestation-1",
    audience: "m9-local-quarantine-only",
    issuer: "M9_LOCAL_QA_NOT_A_GATEWAY",
    key_id: "SYNTHETIC-QA-KEY",
    mode: "LOCAL_QA_ONLY",
    live_mode: false,
    project: WOO_STAGING_PROJECT,
    origin: WOO_PILOT_ORIGIN,
    account_id: "SYNTHETIC-QA-ACCOUNT",
    merchant_id: "SYNTHETIC-QA-MERCHANT",
    nonce: randomUUID(),
    issued_at: "2026-10-22T23:39:50.000Z",
    expires_at: "2026-10-22T23:41:50.000Z",
    event: {
      kind,
      event_reference: "SYNTHETIC-" + randomUUID(),
      transaction_reference: "SYNTHETIC-" + randomUUID(),
      related_transaction_reference: [
        "REFUND",
        "PROVIDER_FEE",
        "FEE_REVERSAL",
      ].includes(kind)
        ? "SYNTHETIC-PARENT"
        : null,
      order_id: 900000101,
      currency: "MXN",
      amount: kind === "PROVIDER_FEE" ? "7.00" : "200.00",
      provider_fee: kind === "PROVIDER_FEE" ? "7.00" : "0.00",
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
      settlement:
        kind === "SETTLEMENT"
          ? {
              gross_captured: "226.20",
              refunded: "20.00",
              provider_fees: "7.00",
              fee_reversals: "0.80",
              prior_settlements: "0.00",
              net: "200.00",
            }
          : null,
    },
  };
  const trust = {
    mode: "LOCAL_QA_ONLY",
    issuer: body.issuer,
    key_id: body.key_id,
    public_key_pem: publicPem,
    account_id: body.account_id,
    merchant_id: body.merchant_id,
    valid_from: "2026-10-22T23:30:00.000Z",
    valid_until: "2026-10-23T00:30:00.000Z",
    revoked: false,
  };
  return { body, trust };
}
const signed = (x, raw = Buffer.from(canonicalQaJson(x.body))) => ({
  raw,
  signature: sign(null, raw, keys.privateKey).toString("base64"),
  trust: x.trust,
  now,
});
async function temporary(test) {
  const root = await mkdtemp(join(tmpdir(), "m9-local-quarantine-"));
  try {
    return await test(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
describe("inert provider receiver and cryptographic LOCAL QA quarantine", () => {
  it("cannot enable a provider through caller JSON or a valid local signature", () => {
    expect(SANDBOX_PROVIDER_RECEIVER.enabled).toBe(false);
    expect(SANDBOX_PROVIDER_RECEIVER.accredited_providers).toEqual([]);
    for (const claimed of [
      { enabled: true, provider: "stripe", paid: true },
      { mode: "SANDBOX", provider: "paypal" },
      signed(make()),
    ])
      expect(() => receiveSandboxProviderEvidence(claimed)).toThrow(
        "SANDBOX_PROVIDER_NOT_ACCREDITED_RECEIVER_DISABLED",
      );
  });
  for (const kind of [
    "AUTHORIZATION",
    "CAPTURE",
    "REFUND",
    "PROVIDER_FEE",
    "FEE_REVERSAL",
    "SETTLEMENT",
  ])
    it(`verifies genuine Ed25519 bytes but keeps ${kind} inert`, () => {
      const r = verifyLocalSandboxAttestation(signed(make(kind)));
      expect(r.local_signature_valid).toBe(true);
      expect(r.provider_authenticated).toBe(false);
      expect(r.can_record_sale).toBe(false);
      expect(r.can_record_book_event).toBe(false);
      expect(r.stock_write_allowed).toBe(false);
      expect(r.database_command).toBe(null);
      expect(r.event.kind).toBe(kind);
      expect(r.event.bank_verified).toBe(false);
      expect(r.event.commercial_components_cents.fees_total).toBe(500);
      expect(r.event.provider_fee_cents).toBe(
        kind === "PROVIDER_FEE" ? 700 : 0,
      );
    });
  for (const [mutate, reason] of [
    [(x) => (x.body.live_mode = true), "QA_STAGING_SANDBOX_REQUIRED"],
    [(x) => (x.body.mode = "SANDBOX"), "QA_STAGING_SANDBOX_REQUIRED"],
    [
      (x) => (x.body.origin = "https://vaquerosm.com"),
      "QA_STAGING_SANDBOX_REQUIRED",
    ],
    [
      (x) => (x.body.project = "drubkjlmfbdeglucakmg"),
      "QA_STAGING_SANDBOX_REQUIRED",
    ],
    [(x) => (x.body.issuer = "Stripe"), "QA_SIGNED_CONTEXT_INVALID"],
    [(x) => (x.body.audience = "native-sale"), "QA_SIGNED_CONTEXT_INVALID"],
    [
      (x) => (x.body.key_id = "SYNTHETIC-DIFFERENT-KEY"),
      "QA_SIGNED_CONTEXT_INVALID",
    ],
    [
      (x) => (x.body.account_id = "SYNTHETIC-OTHER"),
      "QA_SIGNED_ACCOUNT_CHANGED",
    ],
    [
      (x) => (x.body.merchant_id = "SYNTHETIC-OTHER"),
      "QA_SIGNED_ACCOUNT_CHANGED",
    ],
    [(x) => (x.body.nonce = null), "QA_NONCE_REQUIRED"],
    [
      (x) => (x.body.issued_at = "2026-02-30T23:39:50.000Z"),
      "QA_TIMESTAMP_INVALID",
    ],
    [
      (x) => (x.body.issued_at = "2026-10-22T23:20:50.000Z"),
      "QA_ATTESTATION_NOT_RECENT",
    ],
    [
      (x) => (x.body.issued_at = "2026-10-22T23:40:06.000Z"),
      "QA_ATTESTATION_NOT_RECENT",
    ],
    [
      (x) => (x.body.expires_at = "2026-10-22T23:39:59.000Z"),
      "QA_ATTESTATION_NOT_RECENT",
    ],
    [
      (x) => (x.body.expires_at = "2026-10-22T23:50:00.000Z"),
      "QA_ATTESTATION_NOT_RECENT",
    ],
    [(x) => (x.body.event.paid = true), "QA_EVENT_SHAPE_INVALID"],
    [(x) => (x.body.event.kind = "PAID"), "QA_EVENT_KIND_UNSUPPORTED"],
    [(x) => (x.body.event.currency = "USD"), "QA_ORDER_CURRENCY_INVALID"],
    [(x) => (x.body.event.order_id = NaN), "QA_ORDER_CURRENCY_INVALID"],
    [(x) => (x.body.event.order_id = 1.5), "QA_ORDER_CURRENCY_INVALID"],
    [(x) => (x.body.event.amount = "200"), "FINANCE_DECIMAL_INVALID"],
    [(x) => (x.body.event.amount = "1e2"), "FINANCE_DECIMAL_INVALID"],
    [(x) => (x.body.event.amount = "227.00"), "QA_ORDER_AMOUNT_EXCEEDED"],
    [
      (x) => (x.body.event.provider_fee = "5.00"),
      "QA_PROVIDER_FEE_NOT_ORDER_FEE",
    ],
    [
      (x) => (x.body.event.order_components.total_tax = "30.00"),
      "QA_MONEY_CONSERVATION_INVALID",
    ],
    [
      (x) => delete x.body.event.order_components.fee_tax,
      "QA_COMMERCIAL_COMPONENTS_REQUIRED",
    ],
    [
      (x) => (x.body.event.transaction_reference = "REAL-TRANSACTION"),
      "QA_MONETARY_REFERENCE_INVALID",
    ],
    [
      (x) => (x.body.email = "forbidden@example.invalid"),
      "QA_ATTESTATION_SHAPE_INVALID",
    ],
    [(x) => (x.body.public_key = publicPem), "QA_ATTESTATION_SHAPE_INVALID"],
  ])
    it(`rejects signed semantic change ${reason}`, () => {
      const x = make();
      mutate(x);
      expect(() => verifyLocalSandboxAttestation(signed(x))).toThrow(reason);
    });
  for (const [mutate, reason] of [
    [(x) => (x.trust.revoked = true), "QA_TRUST_SCOPE_INVALID"],
    [
      (x) => (x.trust.mode = "PROVIDER_AUTHENTICATED"),
      "QA_TRUST_SCOPE_INVALID",
    ],
    [
      (x) => (x.trust.valid_until = "2026-10-22T23:39:59.000Z"),
      "QA_KEY_OUTSIDE_VALIDITY",
    ],
    [
      (x) => (x.trust.valid_from = "2026-10-22T23:40:01.000Z"),
      "QA_KEY_OUTSIDE_VALIDITY",
    ],
    [
      (x) => (x.trust.public_key_pem = "https://example.invalid/key"),
      "QA_PUBLIC_KEY_REQUIRED",
    ],
  ])
    it(`rejects invalid pinned QA trust ${reason}`, () => {
      const x = make();
      mutate(x);
      expect(() => verifyLocalSandboxAttestation(signed(x))).toThrow(reason);
    });
  it("rejects altered bytes and a signature from another key", () => {
    const p = signed(make());
    p.raw[p.raw.length - 1] ^= 1;
    expect(() => verifyLocalSandboxAttestation(p)).toThrow(
      "QA_SIGNATURE_INVALID",
    );
    const q = signed(make());
    q.signature = sign(
      null,
      q.raw,
      generateKeyPairSync("ed25519").privateKey,
    ).toString("base64");
    expect(() => verifyLocalSandboxAttestation(q)).toThrow(
      "QA_SIGNATURE_INVALID",
    );
  });
  for (const signature of ["", null, "a".repeat(88), "=".repeat(88), "AA=="])
    it("rejects malformed signature", () => {
      const p = signed(make());
      p.signature = signature;
      expect(() => verifyLocalSandboxAttestation(p)).toThrow(
        "QA_SIGNATURE_INVALID",
      );
    });
  it("rejects algorithm confusion and private material in public-key position", () => {
    const x = make();
    x.trust.public_key_pem = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    }).publicKey.export({ type: "spki", format: "pem" });
    expect(() => verifyLocalSandboxAttestation(signed(x))).toThrow(
      "QA_ED25519_PIN_REQUIRED",
    );
    x.trust.public_key_pem = keys.privateKey.export({
      type: "pkcs8",
      format: "pem",
    });
    expect(() => verifyLocalSandboxAttestation(signed(x))).toThrow(
      "QA_PUBLIC_KEY_REQUIRED",
    );
  });
  it("rejects valid signatures over duplicate keys, whitespace or invalid UTF-8", () => {
    const x = make(),
      canonical = canonicalQaJson(x.body);
    for (const raw of [
      Buffer.from(
        canonical.replace(
          '"live_mode":false',
          '"live_mode":true,"live_mode":false',
        ),
      ),
      Buffer.from(" " + canonical),
      Buffer.from([0xff]),
    ])
      expect(() => verifyLocalSandboxAttestation(signed(x, raw))).toThrow(
        raw[0] === 255
          ? "QA_SIGNED_JSON_INVALID"
          : "QA_CANONICAL_SIGNED_JSON_REQUIRED",
      );
  });
  it("rejects unbalanced declared net settlement and missing refund parent", () => {
    const x = make("SETTLEMENT");
    x.body.event.settlement.provider_fees = "8.00";
    expect(() => verifyLocalSandboxAttestation(signed(x))).toThrow(
      "QA_SETTLEMENT_NET_DIFFERS",
    );
    const y = make("REFUND");
    y.body.event.related_transaction_reference = null;
    expect(() => verifyLocalSandboxAttestation(signed(y))).toThrow(
      "QA_PARENT_REFERENCE_REQUIRED",
    );
  });
  it("quarantines exact replay once, retains original signed bytes, and looks up historical evidence without renewing it", () =>
    temporary(async (directory) => {
      const p = signed(make()),
        a = await quarantineLocalSandboxAttestation({ directory, ...p }),
        b = await quarantineLocalSandboxAttestation({ directory, ...p });
      expect(a.receipt_id).toBe(b.receipt_id);
      expect(b.replayed).toBe(true);
      expect(await readdir(join(directory, "receipts"))).toHaveLength(1);
      expect(a.attestation.raw_base64).toBe(p.raw.toString("base64"));
      expect(a.attestation.public_key_pem).toBe(publicPem);
      expect(JSON.stringify(a)).not.toContain("PRIVATE KEY");
      const lookup = await lookupLocalQuarantineReceipt(
        directory,
        a.receipt_id,
      );
      expect(lookup.lookup_only).toBe(true);
      expect(lookup.provider_authenticated).toBe(false);
      expect(lookup.current_evidence_validity_rechecked).toBe(false);
    }));
  it("stores a new event/new nonce for the same money as conflict, never a second proposal", () =>
    temporary(async (directory) => {
      const x = make(),
        a = await quarantineLocalSandboxAttestation({
          directory,
          ...signed(x),
        }),
        y = make();
      y.body.event.transaction_reference = x.body.event.transaction_reference;
      y.body.event.order_id++;
      const b = await quarantineLocalSandboxAttestation({
        directory,
        ...signed(y),
      });
      expect(b.record.status).toBe("QUARANTINED_CONFLICT");
      expect(b.record.reasons).toContain(
        "MONETARY_TRANSACTION_REUSED_WITH_NEW_EVENT",
      );
      expect(b.record.can_record_book_event).toBe(false);
      expect(a.record.can_record_book_event).toBe(false);
      expect(await readdir(join(directory, "receipts"))).toHaveLength(2);
    }));
  it("retains changed event reference/nonce as explicit immutable conflict", () =>
    temporary(async (directory) => {
      const x = make();
      await quarantineLocalSandboxAttestation({ directory, ...signed(x) });
      x.body.event.amount = "199.00";
      const r = await quarantineLocalSandboxAttestation({
        directory,
        ...signed(x),
      });
      expect(r.record.status).toBe("QUARANTINED_CONFLICT");
      expect(r.record.reasons).toContain("NONCE_REUSED_WITH_DIFFERENT_BODY");
      expect(r.record.reasons).toContain(
        "EVENT_REFERENCE_REUSED_WITH_DIFFERENT_BODY",
      );
    }));
  it("never treats a missing capture parent as confirmed", () =>
    temporary(async (directory) => {
      const r = await quarantineLocalSandboxAttestation({
        directory,
        ...signed(make("REFUND")),
      });
      expect(r.record.reasons).toContain(
        "CAUSAL_PARENT_NOT_CONFIRMED_IN_LOCAL_QUARANTINE",
      );
      expect(r.record.provider_authenticated).toBe(false);
    }));
  it("fails closed for tampered archive, stale lock, public directory and symlink", () =>
    temporary(async (directory) => {
      const p = signed(make()),
        r = await quarantineLocalSandboxAttestation({ directory, ...p });
      const path = join(directory, "receipts", r.receipt_id + ".json"),
        old = await readFile(path, "utf8");
      await writeFile(
        path,
        old.replace(
          '"provider_authenticated":false',
          '"provider_authenticated":true',
        ),
      );
      await expect(
        lookupLocalQuarantineReceipt(directory, r.receipt_id),
      ).rejects.toThrow("QUARANTINE_RECEIPT_INVALID");
      await writeFile(path, old);
      await writeFile(join(directory, "write.lock"), "existing QA writer", {
        mode: 0o600,
      });
      await expect(
        quarantineLocalSandboxAttestation({ directory, ...p }),
      ).rejects.toThrow("QUARANTINE_WRITE_BARRIER_REVIEW_REQUIRED");
      await unlink(join(directory, "write.lock"));
      await chmod(directory, 0o755);
      await expect(
        quarantineLocalSandboxAttestation({ directory, ...p }),
      ).rejects.toThrow("QUARANTINE_PRIVATE_DIRECTORY_REQUIRED");
      await chmod(directory, 0o700);
      await symlink(
        path,
        join(directory, "receipts", "f".repeat(64) + ".json"),
      );
      await expect(
        lookupLocalQuarantineReceipt(directory, r.receipt_id),
      ).rejects.toThrow("QUARANTINE_RECEIPT_INVALID");
    }));
  it("serializes two actual processes and publishes one receipt for a simultaneous replay", () =>
    temporary(async (directory) => {
      const p = signed(make());
      const barrier = await open(join(directory, "write.lock"), "wx", 0o600);
      await barrier.writeFile("QA start barrier");
      const bridgeUrl = new URL(
        "../../scripts/m9/woo-sandbox-auth-quarantine.mjs",
        import.meta.url,
      ).href;
      const code = `import{quarantineLocalSandboxAttestation}from ${JSON.stringify(bridgeUrl)};let s='';for await(const c of process.stdin)s+=c;const p=JSON.parse(s);process.stdout.write('READY\\n');const r=await quarantineLocalSandboxAttestation({...p,raw:Buffer.from(p.raw,'base64')});console.log(JSON.stringify({id:r.receipt_id,replayed:r.replayed,waits:r.lock_waits,provider_authenticated:r.record.provider_authenticated}));`;
      const children = [
        spawn(process.execPath, ["--input-type=module", "-e", code]),
        spawn(process.execPath, ["--input-type=module", "-e", code]),
      ];
      const closed = children.map((child) => once(child, "close"));
      const outputs = children.map((child) => {
        let out = "",
          error = "";
        child.stdout.on("data", (c) => (out += c));
        child.stderr.on("data", (c) => (error += c));
        child.stdin.end(
          JSON.stringify({ directory, ...p, raw: p.raw.toString("base64") }),
        );
        return {
          child,
          get out() {
            return out;
          },
          get error() {
            return error;
          },
        };
      });
      try {
        for (
          let i = 0;
          i < 100 && !outputs.every((x) => x.out.includes("READY"));
          i++
        )
          await new Promise((r) => setTimeout(r, 10));
        expect(outputs.every((x) => x.out.includes("READY"))).toBe(true);
        await new Promise((r) => setTimeout(r, 30));
        await barrier.close();
        await unlink(join(directory, "write.lock"));
        await Promise.all(
          closed.map((done) => done.then(([code]) => expect(code).toBe(0))),
        );
        const results = outputs.map((x) =>
          JSON.parse(x.out.trim().split("\n").at(-1)),
        );
        expect(results[0].id).toBe(results[1].id);
        expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
        expect(results.every((r) => r.waits > 0)).toBe(true);
        expect(results.every((r) => r.provider_authenticated === false)).toBe(
          true,
        );
        expect(await readdir(join(directory, "receipts"))).toHaveLength(1);
      } finally {
        for (const child of children) if (child.exitCode === null) child.kill();
        await barrier.close().catch(() => {});
        await unlink(join(directory, "write.lock")).catch(() => {});
      }
    }));
});
