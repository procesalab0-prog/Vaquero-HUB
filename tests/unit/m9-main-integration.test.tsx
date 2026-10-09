import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  permission: vi.fn(),
  rpc: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("@/lib/auth/workspace-session", () => ({
  getWorkspaceSession: mocks.session,
}));
vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: mocks.permission,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/components/workspace-context", () => ({
  useWorkspace: () => ({ activeLocation: null }),
}));
import { MigrationQuestions } from "../../app/(workspace)/inicio/migration-questions";
import { saveOwnerAnswer } from "../../app/(workspace)/productos/migracion-dudas/actions";
import { ProductsWorkspace } from "../../app/(workspace)/productos/products-workspace";
import { WEB_STAGING_URL } from "../../lib/web-draft";

describe("integración de M9 con el programa principal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({
      profile: { is_active: true },
      supabase: { rpc: mocks.rpc },
    });
    mocks.redirect.mockImplementation((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("en staging remite a la bandeja principal sin consultar ni duplicar respuestas", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", WEB_STAGING_URL);
    const html = renderToStaticMarkup(await MigrationQuestions());
    expect(html).toContain(
      'href="https://vaquero-hub.vercel.app/productos/migracion-dudas"',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("en el principal conserva el contador y las opciones visibles", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      "https://drubkjlmfbdeglucakmg.supabase.co",
    );
    mocks.rpc.mockResolvedValue({
      data: { summary: { questions: 3, answered: 1, batch: 1 } },
      error: null,
    });
    const html = renderToStaticMarkup(await MigrationQuestions());
    expect(mocks.rpc).toHaveBeenCalledWith(
      "main_m9_owner_inbox",
      expect.any(Object),
    );
    expect(html).toContain("2 preguntas por responder");
    expect(html).toContain("Responder preguntas ahora");
    expect(html).toContain("Ver respuestas guardadas");
  });
  it("no muestra preguntas a una sesión inactiva", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", WEB_STAGING_URL);
    mocks.session.mockResolvedValue({ profile: { is_active: false } });
    expect(await MigrationQuestions()).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("un envío directo desde staging tampoco guarda respuestas allí", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", WEB_STAGING_URL);
    await expect(saveOwnerAnswer(new FormData())).rejects.toThrow(
      "REDIRECT:https://vaquero-hub.vercel.app/productos/migracion-dudas",
    );
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("conserva el código literal y ficha web fuera del botón de variantes", () => {
    const html = renderToStaticMarkup(
      <ProductsWorkspace
        initialVariants={[
          {
            id: "v",
            productId: "p",
            productName: "Camisa",
            brand: "Wrangler",
            legacyCode: "000123",
            color: "Azul",
            size: "S",
            price: 740,
            stock: 0,
          },
        ]}
        categories={[]}
        attributeValues={[]}
        preview
        webDraftsEnabled
      />,
    );
    expect(html).toContain("000123");
    expect(html).toContain('href="/productos/ficha-web?producto=p"');
    expect(html).toContain("Ver variantes");
    expect(html).not.toMatch(
      /<button[^>]*class="catalog-inline-detail"[^>]*>(?:(?!<\/button>)[\s\S])*<a /,
    );
  });
  it("oculta ficha web cuando el entorno no la habilita", () => {
    const html = renderToStaticMarkup(
      <ProductsWorkspace
        initialVariants={[
          {
            id: "v",
            productId: "p",
            productName: "Camisa",
            brand: "Wrangler",
            legacyCode: "000123",
            color: "Azul",
            size: "S",
            price: 740,
            stock: 0,
          },
        ]}
        categories={[]}
        attributeValues={[]}
        preview
      />,
    );
    expect(html).not.toContain("/productos/ficha-web");
  });
});
