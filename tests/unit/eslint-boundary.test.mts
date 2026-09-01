import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

import { noServerImportInClient } from "../../eslint-rules/no-server-import-in-client.mjs";

const linter = new Linter({ configType: "flat" });
const config = {
  languageOptions: {
    ecmaVersion: "latest" as const,
    sourceType: "module" as const,
  },
  plugins: {
    vaquero: {
      rules: {
        "no-server-import-in-client": noServerImportInClient,
      },
    },
  },
  rules: {
    "vaquero/no-server-import-in-client": "error" as const,
  },
};

describe("regla ESLint de frontera", () => {
  it("rechaza un cliente que importa el cliente administrativo", () => {
    const messages = linter.verify(
      `'use client';\nimport { createAdminClient } from "@/lib/supabase/admin";`,
      config,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.ruleId).toBe("vaquero/no-server-import-in-client");
  });

  it("permite el mismo import en un módulo de servidor", () => {
    const messages = linter.verify(
      `import { createAdminClient } from "@/lib/supabase/admin";`,
      config,
    );

    expect(messages).toEqual([]);
  });
});
