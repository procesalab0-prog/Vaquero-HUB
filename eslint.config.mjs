import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import next from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

import { noServerImportInClient } from "./eslint-rules/no-server-import-in-client.mjs";

const eslintConfig = defineConfig([
  globalIgnores([
    ".next/**",
    "dist/**",
    "out/**",
    "build/**",
    "work/**",
    "next-env.d.ts",
  ]),
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  reactHooks.configs.flat["recommended-latest"],
  jsxA11y.flatConfigs.recommended,
  next.configs["core-web-vitals"],
  {
    plugins: {
      vaquero: {
        rules: {
          "no-server-import-in-client": noServerImportInClient,
        },
      },
    },
    rules: {
      "vaquero/no-server-import-in-client": "error",
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  prettier,
]);

export default eslintConfig;
