import { describe, expect, it } from "vitest";

describe("Supabase local", () => {
  it("responde mediante la Data API con la clave pública", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    expect(url).toBeTruthy();
    expect(key).toBeTruthy();

    const response = await fetch(`${url}/rest/v1/`, {
      headers: {
        apikey: key!,
      },
    });

    expect(response.ok).toBe(true);
  });
});
