import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  FAMILY_PROTOCOL,
  TEST_ORIGIN,
  validateFamilyPacket,
  remoteClient,
} from "../../scripts/m9/woo-remote/client.mjs";
import { processRemoteJob } from "../../scripts/m9/woo-remote/process-job.mjs";
function packet() {
  const image = {
    base64: "AA==",
    sha256: createHash("sha256")
      .update(Buffer.from([0]))
      .digest("hex"),
    alt: "Cover",
  };
  return {
    protocol: FAMILY_PROTOCOL,
    request_id: "11111111-1111-4111-8111-111111111111",
    product_id: "22222222-2222-4222-8222-222222222222",
    revision: 1,
    name: "Camisa",
    description: "Description",
    short_description: "BASE",
    barcode: "M9-P-22222222-2222-4222-8222-222222222222",
    images: [image],
    categories: ["Dama", "Dama > Camisa"],
    descriptive_attributes: [
      { name: "Color", option: "Guinda", variation: false },
    ],
    variants: ["S", "M"].map((size, i) => ({
      variant_id: `33333333-3333-4333-8333-33333333333${i}`,
      barcode: `000${i}`,
      price_cents: 82000,
      attributes: { TALLA: size },
    })),
  };
}
describe("remote family protocol", () => {
  it("keeps all variants and leading zeroes", () => {
    const p = packet();
    expect(validateFamilyPacket(p)).toEqual(p);
  });
  it.each([
    [
      "stock",
      (p) => {
        p.stock_quantity = 4;
      },
    ],
    [
      "publication",
      (p) => {
        p.status = "publish";
      },
    ],
    [
      "duplicate barcode",
      (p) => {
        p.variants[1].barcode = p.variants[0].barcode;
      },
    ],
    [
      "duplicate attributes",
      (p) => {
        p.variants[1].attributes = { TALLA: "S" };
      },
    ],
    [
      "partial attributes",
      (p) => {
        p.variants[1].attributes = { COLOR: "Red" };
      },
    ],
    [
      "numeric barcode",
      (p) => {
        p.variants[0].barcode = 123;
      },
    ],
    [
      "duplicate photos",
      (p) => {
        p.images.push(p.images[0]);
      },
    ],
    [
      "invented source ID",
      (p) => {
        p.variants[0].woo_id = 123;
      },
    ],
    [
      "empty category",
      (p) => {
        p.categories = ["Dama > "];
      },
    ],
  ])("rejects %s", (_name, mutate) => {
    const p = packet();
    mutate(p);
    expect(() => validateFamilyPacket(p)).toThrow();
  });
  it("checks remote family capability before POST", async () => {
    const calls = [];
    const c = remoteClient({
      origin: TEST_ORIGIN,
      username: "test",
      password: "test",
      transport: async (url, opt) => {
        calls.push(opt.method);
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
    await expect(c.createFamily(packet())).rejects.toThrow(
      "REMOTE_FAMILY_UNAVAILABLE",
    );
    expect(calls).toEqual(["GET"]);
  });
  it("binds complete gallery before exactly one family dispatch; repeated claim only reads receipt", async () => {
    const p = packet(),
      events = [];
    const claim = {
      id: p.request_id,
      state: "RUNNING",
      dispatch: true,
      claim_id: "claim",
      packet: {
        ...p,
        origin: TEST_ORIGIN,
        content: {
          name: p.name,
          description: p.description,
          short_description: p.short_description,
          categories: p.categories,
          images: [
            {
              url: "https://vaquerosm.com/wp-content/uploads/test.jpg",
              alt: "Cover",
            },
          ],
        },
      },
    };
    const args = {
      jobId: p.request_id,
      actorId: "actor",
      rpc: async (name) => {
        events.push(name);
        return claim;
      },
      photoReader: async () => ({
        base64: p.images[0].base64,
        sha256: p.images[0].sha256,
      }),
      client: {
        createFamily: async (sent) => {
          expect(sent).toEqual(p);
          events.push("POST");
          return { state: "SUCCEEDED" };
        },
        receipt: async () => {
          events.push("GET");
          return { state: "SUCCEEDED" };
        },
      },
    };
    await processRemoteJob(args);
    expect(events).toEqual([
      "claim_remote_web",
      "bind_remote_web_gallery",
      "POST",
      "finish_remote_web",
    ]);
    events.length = 0;
    claim.dispatch = false;
    await processRemoteJob(args);
    expect(events).toEqual(["claim_remote_web", "GET", "finish_remote_web"]);
  });
  it("does not send after a gallery binding failure", async () => {
    const p = packet();
    let sent = false;
    await expect(
      processRemoteJob({
        jobId: p.request_id,
        actorId: "actor",
        rpc: async (name) => {
          if (name === "bind_remote_web_gallery") throw Error("changed");
          return {
            id: p.request_id,
            state: "RUNNING",
            dispatch: true,
            claim_id: "claim",
            packet: {
              ...p,
              origin: TEST_ORIGIN,
              content: { images: [{ url: "x", alt: "Cover" }] },
            },
          };
        },
        photoReader: async () => p.images[0],
        client: {
          createFamily: () => {
            sent = true;
          },
        },
      }),
    ).rejects.toThrow("changed");
    expect(sent).toBe(false);
  });
});
