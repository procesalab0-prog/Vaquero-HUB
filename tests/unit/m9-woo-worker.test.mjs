import { it, expect, afterEach, vi } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compilePlan,
  hash,
  plainHtml,
} from "../../scripts/m9/woo-test/plan.mjs";
import {
  runJob,
  wooClient,
  reconcileKnownResult,
} from "../../scripts/m9/woo-test/worker.mjs";
import { sampleInput } from "../../scripts/m9/woo-test/fixtures.mjs";
const dirs = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function directory() {
  const d = await mkdtemp(join(tmpdir(), "m9-woo-"));
  dirs.push(d);
  return d;
}
function fake() {
  const records = new Map(),
    writes = [];
  let nextId = 101;
  return {
    records,
    writes,
    request: async (method, path, data) => {
      if (method === "GET") {
        if (!records.has(path)) throw new Error("WOO_HTTP_404");
        return structuredClone(records.get(path));
      }
      writes.push({ method, path, data: structuredClone(data) });
      const id = method === "POST" ? nextId++ : Number(path.split("/").at(-1));
      const key = method === "POST" ? `${path}/${id}` : path;
      const prior = records.get(key) || {};
      const value = {
        ...prior,
        ...structuredClone(data),
        id,
        meta_data: [
          ...(prior.meta_data || []).filter(
            (m) => !data.meta_data?.some((n) => n.key === m.key),
          ),
          ...(data.meta_data || []),
        ],
      };
      if (path === "products") value.variations = [];
      if (method === "POST" && path.endsWith("/variations"))
        records.get(path.replace("/variations", "")).variations.push(id);
      records.set(key, value);
      return structuredClone(value);
    },
  };
}
async function create() {
  const input = sampleInput(),
    journalDir = await directory(),
    api = fake();
  const result = await runJob({ input, journalDir, request: api.request });
  return { input, journalDir, api, result };
}
function update(x) {
  const input = structuredClone(x.input);
  input.mode = "update";
  input.revision = 2;
  const pid = x.result.steps[0].remote_id;
  input.target = {
    store_id: input.store.id,
    product_id: pid,
    snapshot: structuredClone(x.api.records.get(`products/${pid}`)),
    variants: input.variants.map((v, i) => {
      const id = x.result.steps[i + 1].remote_id;
      return {
        variant_id: v.id,
        id,
        snapshot: structuredClone(
          x.api.records.get(`products/${pid}/variations/${id}`),
        ),
      };
    }),
  };
  return input;
}
it("compiles complete draft, preserves barcode zeros, escapes editorial HTML and never sends stock", () => {
  const input = sampleInput(),
    before = JSON.stringify(input),
    plan = compilePlan(input);
  expect(plan.steps).toHaveLength(3);
  expect(plan.steps[0].payload.status).toBe("draft");
  expect(plan.steps[1].payload.meta_data).toContainEqual({
    key: "_mi_tienda_barcode",
    value: "000007779",
  });
  expect(plan.steps[1].payload.sku).toBe("LAB-1000001-1");
  expect(JSON.stringify(plan)).not.toMatch(
    /stock|sale_price|manage_stock|delete|global_unique_id/,
  );
  expect(plainHtml("<script>x</script>\n&")).toBe(
    "<p>&lt;script&gt;x&lt;/script&gt;<br />&amp;</p>",
  );
  expect(JSON.stringify(input)).toBe(before);
  expect(compilePlan(input)).toEqual(plan);
});
it.each([
  "https://vaquerosm.com",
  "https://staging.vaquerosm.com",
  "http://localhost:9417",
  "http://127.0.0.1:9417/?x=1",
  "http://user:pass@127.0.0.1:9417",
])("rejects destination %s before network", (url) => {
  const i = sampleInput();
  i.store.base_url = url;
  expect(() => compilePlan(i)).toThrow();
  expect(() => wooClient(i.store)).toThrow();
});
it("rejects cross-store IDs, changed categories, duplicate variant identity and injected stock", () => {
  for (const change of [
    (i) => (i.bindings.store_id = "live"),
    (i) => (i.content.categories[0] = "Changed"),
    (i) => (i.variants[1].barcode = i.variants[0].barcode),
    (i) => (i.variants[0].stock_quantity = 4),
    (i) => (i.content.short_description = "Other"),
  ]) {
    const i = sampleInput();
    change(i);
    expect(() => compilePlan(i)).toThrow();
  }
});
it("persists returned IDs and repeated successful job performs no requests", async () => {
  const x = await create();
  expect(x.result.state).toBe("SUCCEEDED");
  expect(x.api.writes).toHaveLength(3);
  const again = await runJob({
    ...x,
    request: () => {
      throw new Error("must not request");
    },
  });
  expect(again).toEqual(x.result);
  expect(again.steps.map((s) => s.remote_id)).toEqual([101, 102, 103]);
});
it("updates selected variants without deleting omitted children, changing SKU, promotion or stock", async () => {
  const x = await create(),
    input = update(x);
  input.variants = input.variants.slice(0, 1);
  input.target.variants = input.target.variants.slice(0, 1);
  input.content.name = "Updated";
  input.variants[0].price_cents = 82500;
  const omitted = structuredClone(
    x.api.records.get("products/101/variations/103"),
  );
  const done = await runJob({
    input,
    journalDir: x.journalDir,
    request: x.api.request,
  });
  expect(done.state).toBe("SUCCEEDED");
  expect(x.api.writes.slice(3).map((w) => w.path)).toEqual([
    "products/101",
    "products/101/variations/102",
  ]);
  expect(x.api.records.get("products/101/variations/103")).toEqual(omitted);
  expect(x.api.writes[4].data).not.toHaveProperty("sku");
  expect(x.api.writes[3].data).not.toHaveProperty("attributes");
});
it("blocks remote edit before any write", async () => {
  const x = await create(),
    input = update(x);
  x.api.records.get("products/101/variations/103").regular_price = "999.00";
  const r = await runJob({
    input,
    journalDir: x.journalDir,
    request: x.api.request,
  });
  expect(r.state).toBe("REVIEW_REQUIRED");
  expect(x.api.writes).toHaveLength(3);
});
it("retries a failed read safely, then sends update once", async () => {
  const x = await create(),
    input = update(x);
  expect(
    (
      await runJob({
        input,
        journalDir: x.journalDir,
        request: async () => {
          throw new Error("offline");
        },
      })
    ).state,
  ).toBe("PENDING");
  expect(
    (await runJob({ input, journalDir: x.journalDir, request: x.api.request }))
      .state,
  ).toBe("SUCCEEDED");
  expect(x.api.writes).toHaveLength(6);
});
it("lost create response requires review and never posts again", async () => {
  const input = sampleInput(),
    journalDir = await directory(),
    api = fake();
  const request = async (...args) => {
    const r = await api.request(...args);
    if (args[0] === "POST") throw new Error("lost secret");
    return r;
  };
  const r = await runJob({ input, journalDir, request });
  expect(r.state).toBe("REVIEW_REQUIRED");
  expect(api.writes).toHaveLength(1);
  expect(
    (await runJob({ input, journalDir, request: api.request })).state,
  ).toBe("REVIEW_REQUIRED");
  expect(api.writes).toHaveLength(1);
  expect(JSON.stringify(r)).not.toContain("secret");
});
it("interrupted dispatch survives process restart as review, not another POST", async () => {
  const x = await create(),
    file = join(
      x.journalDir,
      `${hash([x.input.store.id, x.input.product_id])}.json`,
    );
  const ledger = JSON.parse(await readFile(file));
  ledger.jobs[0].state = "RUNNING";
  ledger.jobs[0].steps[1].state = "DISPATCHING";
  await writeFile(file, JSON.stringify(ledger));
  expect(
    (
      await runJob({
        ...x,
        request: () => {
          throw new Error("must not request");
        },
      })
    ).state,
  ).toBe("REVIEW_REQUIRED");
});
it("rejects changed revision content and second create with new revision", async () => {
  const x = await create();
  x.input.content.name = "Changed";
  await expect(runJob({ ...x, request: x.api.request })).rejects.toThrow(
    "REVISION_CONTENT_CHANGED",
  );
  x.input.revision = 2;
  await expect(runJob({ ...x, request: x.api.request })).rejects.toThrow(
    "PRODUCT_ALREADY_SUBMITTED",
  );
});
it("locks simultaneous workers before second can dispatch", async () => {
  const input = sampleInput(),
    journalDir = await directory(),
    api = fake();
  let release, reached;
  const gate = new Promise((r) => (release = r)),
    started = new Promise((r) => (reached = r));
  const first = runJob({
    input,
    journalDir,
    request: async (...args) => {
      reached();
      await gate;
      return api.request(...args);
    },
  });
  await started;
  await expect(
    runJob({ input, journalDir, request: api.request }),
  ).rejects.toThrow("WORKER_LOCKED");
  release();
  expect((await first).state).toBe("SUCCEEDED");
  expect(api.writes).toHaveLength(3);
});
it("invalid success response stops child sends", async () => {
  const input = sampleInput(),
    journalDir = await directory();
  let calls = 0;
  expect(
    (
      await runJob({
        input,
        journalDir,
        request: async () => {
          calls++;
          return { id: 0 };
        },
      })
    ).state,
  ).toBe("REVIEW_REQUIRED");
  expect(calls).toBe(1);
});
it("recovers a lost child response by verified ID and resumes without duplicating parent or child", async () => {
  const input = sampleInput(),
    journalDir = await directory(),
    api = fake();
  const request = async (...args) => {
    const r = await api.request(...args);
    if (args[0] === "POST" && args[1].endsWith("variations"))
      throw new Error("lost response");
    return r;
  };
  const stopped = await runJob({ input, journalDir, request });
  expect(stopped.state).toBe("REVIEW_REQUIRED");
  expect(api.writes).toHaveLength(2);
  await expect(
    reconcileKnownResult({
      input,
      journalDir,
      stepKey: input.variants[0].id,
      remoteId: 999,
      request: api.request,
    }),
  ).rejects.toThrow("WOO_HTTP_404");
  const recovered = await reconcileKnownResult({
    input,
    journalDir,
    stepKey: input.variants[0].id,
    remoteId: 102,
    request: api.request,
  });
  expect(recovered.state).toBe("PENDING");
  expect(
    (await runJob({ input, journalDir, request: api.request })).state,
  ).toBe("SUCCEEDED");
  expect(api.writes).toHaveLength(3);
});
it("accepts Woo trailing HTML newlines but does not accept altered text", async () => {
  const input = sampleInput(),
    journalDir = await directory(),
    api = fake();
  const request = async (...args) => {
    const r = await api.request(...args);
    if (r.description) r.description += "\n";
    if (r.short_description) r.short_description += "\n";
    return r;
  };
  expect((await runJob({ input, journalDir, request })).state).toBe(
    "SUCCEEDED",
  );
  const other = await directory();
  expect(
    (
      await runJob({
        input,
        journalDir: other,
        request: async (...args) => {
          const r = await api.request(...args);
          r.description = "Wrong";
          return r;
        },
      })
    ).state,
  ).toBe("REVIEW_REQUIRED");
});
it("does not resend unchanged media or categories when editing title", async () => {
  const x = await create(),
    input = update(x);
  input.content.name = "Changed title";
  const plan = compilePlan(input);
  expect(plan.steps[0].payload).not.toHaveProperty("images");
  expect(plan.steps[0].payload).not.toHaveProperty("categories");
  expect(plan.steps[0].payload.name).toBe("Changed title");
});
it("supports a simple product with one SKU and barcode on the parent", () => {
  const i = sampleInput();
  i.type = "simple";
  i.variants = i.variants.slice(0, 1);
  i.variants[0].attributes = [];
  const plan = compilePlan(i);
  expect(plan.steps).toHaveLength(1);
  expect(plan.steps[0].payload.regular_price).toBe("820.00");
  expect(plan.steps[0].payload.sku).toBe(i.variants[0].sku);
  expect(plan.steps[0].payload).not.toHaveProperty("attributes");
});
it("follows no external redirect and retries only a GET redirected to its exact URL", async () => {
  const input = sampleInput();
  const mock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "/wp-json/wc/v3/products/11" },
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 11 }), { status: 200 }),
    );
  vi.stubGlobal("fetch", mock);
  expect(await wooClient(input.store)("GET", "products/11")).toEqual({
    id: 11,
  });
  expect(mock).toHaveBeenCalledTimes(2);
  expect(mock.mock.calls[0][0]).toBe(mock.mock.calls[1][0]);
  mock.mockReset().mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: {
        location: "https://vaquerosm.com/wp-json/wc/v3/products/11",
      },
    }),
  );
  await expect(wooClient(input.store)("GET", "products/11")).rejects.toThrow(
    "WOO_HTTP_302",
  );
  expect(mock).toHaveBeenCalledTimes(1);
  mock.mockReset().mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { location: "/wp-json/wc/v3/products" },
    }),
  );
  await expect(wooClient(input.store)("POST", "products", {})).rejects.toThrow(
    "WOO_HTTP_302",
  );
  expect(mock).toHaveBeenCalledTimes(1);
  expect(mock.mock.calls[0][1].redirect).toBe("error");
});

it("accepts reordered category membership but rejects substituted categories", async () => {
  for (const corrupted of [false, true]) {
    const input = sampleInput(),
      api = fake(),
      journalDir = await directory();
    input.content.categories.push("Otra");
    input.bindings.categories.push({ id: 99, path: "Otra" });
    const request = async (...args) => {
      const r = await api.request(...args);
      if (r.categories) {
        r.categories.reverse();
        if (corrupted) r.categories[0].id = 999;
      }
      return r;
    };
    const r = await runJob({ input, journalDir, request });
    expect(r.state).toBe(corrupted ? "REVIEW_REQUIRED" : "SUCCEEDED");
  }
});
