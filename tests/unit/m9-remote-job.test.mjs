import { describe, it, expect } from "vitest";
import {
  processRemoteJob,
  fetchPhoto,
} from "../../scripts/m9/woo-remote/process-job.mjs";
import { TEST_ORIGIN } from "../../scripts/m9/woo-remote/client.mjs";
const photo = { base64: "AA==", sha256: "a".repeat(64) };
function harness(dispatch = true) {
  const events = [];
  const claim = {
    state: "RUNNING",
    dispatch,
    id: "job",
    claim_id: "claim",
    packet: {
      origin: TEST_ORIGIN,
      product_id: "product",
      revision: 1,
      barcode: "000123",
      price_cents: 219000,
      content: {
        name: "Test",
        description: "Text",
        short_description: "BASE",
        images: [{ url: "https://vaquerosm.com/wp-content/uploads/photo.jpg" }],
        categories: [],
      },
    },
  };
  return {
    events,
    claim,
    args: {
      jobId: "job",
      actorId: "actor",
      rpc: async (name, p) => {
        events.push([name, p]);
        return claim;
      },
      client: {
        createDraft: async (p) => {
          events.push(["POST", p]);
          return { state: "SUCCEEDED" };
        },
        receipt: async (id) => {
          events.push(["GET", id]);
          return { state: "SUCCEEDED" };
        },
      },
      photoReader: async () => photo,
    },
  };
}
describe("remote outbox processor", () => {
  it("binds image before dispatch and records the receipt", async () => {
    const h = harness();
    await processRemoteJob(h.args);
    expect(h.events.map((e) => e[0])).toEqual([
      "claim_remote_web",
      "bind_remote_web_image",
      "POST",
      "finish_remote_web",
    ]);
    expect(h.events[2][1].barcode).toBe("000123");
    expect(h.events[2][1]).not.toHaveProperty("stock_quantity");
  });
  it("reconciles a repeated action with GET only", async () => {
    const h = harness(false);
    await processRemoteJob(h.args);
    expect(h.events.map((e) => e[0])).toEqual([
      "claim_remote_web",
      "GET",
      "finish_remote_web",
    ]);
  });
  it("does not resend after an uncertain POST", async () => {
    const h = harness();
    h.args.client.createDraft = async () => {
      h.events.push(["POST"]);
      throw Error("timeout");
    };
    await expect(processRemoteJob(h.args)).rejects.toThrow("timeout");
    expect(h.events.filter((e) => e[0] === "POST")).toHaveLength(1);
    expect(h.events.some((e) => e[0] === "finish_remote_web")).toBe(false);
  });
  it("does not create after missing receipt", async () => {
    const h = harness(false);
    h.args.client.receipt = async () => {
      throw Error("404");
    };
    await expect(processRemoteJob(h.args)).rejects.toThrow("404");
    expect(h.events).toHaveLength(1);
  });
  it("will not dispatch when binding fails", async () => {
    const h = harness();
    const rpc = h.args.rpc;
    h.args.rpc = async (n, p) => {
      if (n === "bind_remote_web_image") throw Error("db");
      return rpc(n, p);
    };
    await expect(processRemoteJob(h.args)).rejects.toThrow();
    expect(h.events).toHaveLength(1);
  });
  it("does not truncate gallery or categories", async () => {
    for (const field of ["images", "categories"]) {
      const h = harness();
      h.claim.packet.content[field].push("extra");
      await expect(processRemoteJob(h.args)).rejects.toThrow(
        "REMOTE_CONTENT_SCOPE",
      );
      expect(h.events).toHaveLength(1);
    }
  });
  it("rejects wrong destination before image download", async () => {
    const h = harness();
    h.claim.packet.origin = "https://vaquerosm.com";
    await expect(processRemoteJob(h.args)).rejects.toThrow(
      "REMOTE_CLAIM_INVALID",
    );
  });
  it.each(["SUPERSEDED", "SUCCEEDED"])(
    "does not send state %s",
    async (state) => {
      const h = harness();
      h.claim.state = state;
      expect(await processRemoteJob(h.args)).toBe(state);
      expect(h.events).toHaveLength(1);
    },
  );
  it.each([
    "http://127.0.0.1/photo.jpg",
    "https://vaquerosm.com.evil.test/wp-content/uploads/x",
    "https://vaquerosm.com/wp-admin/x",
  ])("rejects source %s without network", async (url) => {
    await expect(
      fetchPhoto(url, () => {
        throw Error("network");
      }),
    ).rejects.toThrow("IMAGE_ORIGIN_FORBIDDEN");
  });
  it("enforces streaming limit without trusting content-length", async () => {
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(4 * 1024 * 1024 + 1));
        c.close();
      },
    });
    await expect(
      fetchPhoto(
        "https://vaquerosm.com/wp-content/uploads/a.jpg",
        async () => new Response(body),
      ),
    ).rejects.toThrow("IMAGE_TOO_LARGE");
  });
});
