import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const sourceRoots = [join(root, "app"), join(root, "components")];
const protectedImports = [
  "@/lib/supabase/admin",
  "@/lib/supabase/server",
  "/lib/supabase/admin",
  "/lib/supabase/server",
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return sourceFiles(path);
    if (![".ts", ".tsx"].includes(extname(entry.name))) return [];

    return [path];
  });
}

describe("límite entre navegador y servidor", () => {
  it("impide que un componente cliente importe clientes privilegiados", () => {
    const violations = sourceRoots.flatMap(sourceFiles).filter((path) => {
      const source = readFileSync(path, "utf8");
      const isClientComponent = /^\s*["']use client["'];?/m.test(source);

      return (
        isClientComponent &&
        protectedImports.some((moduleName) => source.includes(moduleName))
      );
    });

    expect(violations).toEqual([]);
  });
});
