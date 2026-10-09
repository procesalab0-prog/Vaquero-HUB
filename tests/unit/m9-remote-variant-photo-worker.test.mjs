import { it, expect } from "vitest";
import { createHash } from "node:crypto";
import { processRemoteVariantPhotos } from "../../scripts/m9/woo-remote/process-variant-photos.mjs";
import {
  remoteClient,
  TEST_ORIGIN,
} from "../../scripts/m9/woo-remote/client.mjs";
const parent = "97c82026-b3cc-4c60-8f22-13d7c00fb33a",
  id = "11111111-1111-4111-8111-111111111111",
  product = "14f3af61-18f0-4adb-b1d8-29b447ae9cdb";
const bytes = Buffer.from("photo-fixture"),
  sha = createHash("sha256").update(bytes).digest("hex");
function setup(existing = false) {
  const events = [],
    packet = { protocol: "m9-remote-variant-photo-write-1", update_id: id },
    receipt = { state: "SUCCEEDED", packet };
  const context = {
    product_id: product,
    context_hash: "hash",
    packet: { request_id: parent },
    receipt: { state: "SUCCEEDED", a: 1, b: 2 },
    items: [0, 1].map((n) => ({
      variant_id: String(n),
      barcode: "000" + n,
      photos: [{ sha256: sha, bytes: bytes.length, alt: "" }],
      stored: [
        {
          url: `https://zsezjtswqeijboezvado.supabase.co/storage/v1/object/public/product-images/${product}/${sha}.jpg`,
          alt: "",
        },
      ],
    })),
  };
  const f = {
    parentId: parent,
    actorId: "actor",
    context,
    events,
    newId: () => id,
    prepare: async (data) => {
      events.push("prepare");
      expect(data.source[0].bytes.equals(bytes)).toBe(true);
      return {};
    },
    plan: () => packet,
    photoReader: async () => {
      events.push("read-bytes");
      return { sha256: sha, base64: bytes.toString("base64") };
    },
    rpc: async (name, args) => {
      events.push(name);
      if (name === "begin_remote_variant_photos")
        return args.p_packet
          ? { dispatch: true, job: { id, packet } }
          : { dispatch: false, job: existing ? { id, packet } : null };
      if (name === "remote_variant_photo_context") return context;
      if (name === "finish_remote_variant_photos")
        return { state: "SUCCEEDED" };
      throw Error("UNEXPECTED_RPC");
    },
    client: {
      variantPhotoWritePreflight: async () => events.push("preflight"),
      variantPhotos: async () => ({ complete: true }),
      receipt: async () => ({ b: 2, a: 1, state: "SUCCEEDED" }),
      photo: async () => {},
      assignVariantPhotos: async () => events.push("POST"),
      variantPhotoReceipt: async () => {
        events.push("GET-receipt");
        return receipt;
      },
    },
  };
  return f;
}
it("claims durably before POST, deduplicates source reads, and verifies receipt before finish", async () => {
  const f = setup();
  await processRemoteVariantPhotos(f);
  expect(f.events).toEqual([
    "preflight",
    "begin_remote_variant_photos",
    "remote_variant_photo_context",
    "read-bytes",
    "prepare",
    "begin_remote_variant_photos",
    "POST",
    "GET-receipt",
    "finish_remote_variant_photos",
  ]);
});
it("existing running request is recovery only without reading source or POST", async () => {
  const f = setup(true);
  await processRemoteVariantPhotos(f);
  expect(f.events).toEqual([
    "preflight",
    "begin_remote_variant_photos",
    "GET-receipt",
    "finish_remote_variant_photos",
  ]);
});
it("unknown POST outcome queries the same receipt and never resends", async () => {
  const f = setup();
  f.client.assignVariantPhotos = async () => {
    f.events.push("POST");
    throw Error("TIMEOUT");
  };
  await processRemoteVariantPhotos(f);
  expect(f.events.filter((x) => x === "POST")).toHaveLength(1);
  expect(f.events).toContain("GET-receipt");
});
it("racing preparation uses the already claimed job and never POSTs again", async () => {
  const f = setup(),
    rpc = f.rpc;
  f.rpc = async (name, args) =>
    name === "begin_remote_variant_photos" && args.p_packet
      ? { dispatch: false, job: { id, packet: { update_id: id } } }
      : rpc(name, args);
  await processRemoteVariantPhotos(f);
  expect(f.events).not.toContain("POST");
  expect(f.events).toContain("GET-receipt");
});
it.each([
  "preflight",
  "bytes",
  "origin",
  "parent-receipt",
  "preparation",
  "queue",
  "uncertain-receipt",
  "finish",
])("stops safely on %s failure", async (what) => {
  const f = setup();
  if (what === "preflight")
    f.client.variantPhotoWritePreflight = async () => {
      throw Error("UNAVAILABLE");
    };
  if (what === "bytes")
    f.photoReader = async () => ({ base64: "AA==", sha256: sha });
  if (what === "origin")
    f.context.items[0].stored[0].url =
      "https://vaquerosm.com/wp-content/uploads/a.jpg";
  if (what === "parent-receipt")
    f.client.receipt = async () => ({ state: "CHANGED" });
  if (what === "preparation")
    f.prepare = async () => {
      throw Error("CHANGED");
    };
  if (what === "queue") {
    const rpc = f.rpc;
    f.rpc = async (n, a) => {
      if (n === "begin_remote_variant_photos" && a.p_packet)
        throw Error("STALE");
      return rpc(n, a);
    };
  }
  if (what === "uncertain-receipt")
    f.client.variantPhotoReceipt = async () => ({ state: "APPLYING" });
  if (what === "finish") {
    const rpc = f.rpc;
    f.rpc = async (n, a) => {
      if (n === "finish_remote_variant_photos") throw Error("SOURCE_CHANGED");
      return rpc(n, a);
    };
  }
  await expect(processRemoteVariantPhotos(f)).rejects.toThrow();
  expect(f.events.filter((x) => x === "POST").length).toBeLessThanOrEqual(1);
  if (!["uncertain-receipt", "finish"].includes(what))
    expect(f.events).not.toContain("POST");
});
it("requires the installed writer capability before any assignment POST", async () => {
  const calls = [];
  const client = remoteClient({
    origin: TEST_ORIGIN,
    username: "fixture",
    password: "fixture",
    transport: async (url, opts) => {
      calls.push([url, opts.method]);
      return {
        ok: true,
        json: async () => ({
          protocol: "m9-remote-draft-1",
          origin: TEST_ORIGIN,
          mail_blocked: true,
          outbound_blocked: true,
          purchase_blocked: true,
          orders_blocked: true,
          payment_gateways: 0,
        }),
      };
    },
  });
  await expect(client.variantPhotoWritePreflight()).rejects.toThrow(
    "VARIANT_PHOTO_WRITER_UNAVAILABLE",
  );
  expect(calls).toHaveLength(1);
  expect(calls[0][1]).toBe("GET");
});
