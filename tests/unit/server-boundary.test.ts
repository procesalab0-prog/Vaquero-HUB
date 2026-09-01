import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const sourceRoots = ["app", "components", "lib", "hooks"]
  .map((directory) => join(root, directory))
  .filter(existsSync);
const protectedFiles = new Set([
  join(root, "lib/supabase/admin.ts"),
  join(root, "lib/supabase/server.ts"),
]);

type ModuleGraph = Map<string, string[]>;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return sourceFiles(path);
    if (![".ts", ".tsx", ".mts"].includes(extname(entry.name))) return [];

    return [path];
  });
}

function resolveLocalImport(fromFile: string, moduleName: string) {
  let basePath: string;

  if (moduleName.startsWith("@/")) {
    basePath = resolve(root, moduleName.slice(2));
  } else if (moduleName.startsWith(".")) {
    basePath = resolve(dirname(fromFile), moduleName);
  } else {
    return null;
  }

  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.mts`,
    join(basePath, "index.ts"),
    join(basePath, "index.tsx"),
    join(basePath, "index.mts"),
  ];

  return (
    candidates.find((candidate) => {
      return existsSync(candidate) && statSync(candidate).isFile();
    }) ?? null
  );
}

function inspectModule(path: string) {
  const source = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const isClient = sourceFile.statements.some(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression) &&
      statement.expression.text === "use client",
  );
  const imports = sourceFile.statements.flatMap((statement) => {
    if (
      (ts.isImportDeclaration(statement) ||
        ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const dependency = resolveLocalImport(
        path,
        statement.moduleSpecifier.text,
      );
      return dependency ? [dependency] : [];
    }

    return [];
  });

  return { imports, isClient };
}

function findProtectedPath(
  graph: ModuleGraph,
  start: string,
  protectedModules: Set<string>,
  trail = [start],
): string[] | null {
  if (protectedModules.has(start)) return trail;

  for (const dependency of graph.get(start) ?? []) {
    if (trail.includes(dependency)) continue;

    const violation = findProtectedPath(graph, dependency, protectedModules, [
      ...trail,
      dependency,
    ]);
    if (violation) return violation;
  }

  return null;
}

describe("límite entre navegador y servidor", () => {
  it("detecta una importación privilegiada aunque sea transitiva", () => {
    const graph: ModuleGraph = new Map([
      ["client.tsx", ["helper.ts"]],
      ["helper.ts", ["admin.ts"]],
      ["admin.ts", []],
    ]);

    expect(
      findProtectedPath(graph, "client.tsx", new Set(["admin.ts"])),
    ).toEqual(["client.tsx", "helper.ts", "admin.ts"]);
  });

  it("impide rutas directas o transitivas desde cliente a servidor", () => {
    const files = sourceRoots.flatMap(sourceFiles);
    const modules = new Map(files.map((path) => [path, inspectModule(path)]));
    const graph = new Map(
      [...modules].map(([path, module]) => [path, module.imports]),
    );
    const violations = [...modules]
      .filter(([, module]) => module.isClient)
      .map(([path]) => findProtectedPath(graph, path, protectedFiles))
      .filter((path): path is string[] => Boolean(path))
      .map((path) => path.map((part) => relative(root, part)).join(" -> "));

    expect(violations).toEqual([]);
  });
});
