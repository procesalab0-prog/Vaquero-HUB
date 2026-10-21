import fs from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const runtime = process.argv[2];
if (!runtime || process.argv.length !== 3)
  throw Error("Usage: test-order-trial.mjs EXISTING_RUNTIME_DIR");
const dependencies = pathToFileURL(
  resolve(runtime, "node_modules/.pnpm") + "/",
);
const { loadNodeRuntime } = await import(
  new URL(
    "@php-wasm+node@3.1.56/node_modules/@php-wasm/node/index.js",
    dependencies,
  )
);
const { PHP } = await import(
  new URL(
    "@php-wasm+universal@3.1.56/node_modules/@php-wasm/universal/index.js",
    dependencies,
  )
);
const php = new PHP(
  await loadNodeRuntime("8.3", {
    emscriptenOptions: { processId: process.pid },
  }),
);
try {
  for (const name of await fs.readdir(new URL("./", import.meta.url))) {
    if (!name.endsWith(".php")) continue;
    php.writeFile(
      `/${name}`,
      await fs.readFile(new URL(name, import.meta.url), "utf8"),
    );
    const lint = await php.run({
      code: `<?php token_get_all(file_get_contents('/${name}'), TOKEN_PARSE);`,
    });
    if (lint.errors || lint.exitCode !== 0)
      throw Error(`PHP_SYNTAX_${name}: ${lint.errors}`);
  }
  const isolation = await fs.readFile(
    new URL("./m9-test-isolation.php", import.meta.url),
    "utf8",
  );
  const guard = isolation.match(
    /function m9_test_block_order\(\$order\) \{[\s\S]*?\n\}/,
  )?.[0];
  if (!guard) throw Error("ACTUAL_ORDER_GUARD_MISSING");
  php.writeFile("/guard.php", "<?php\n" + guard);
  php.writeFile(
    "/order-trial.php",
    await fs.readFile(new URL("./order-trial.php", import.meta.url), "utf8"),
  );
  const response = await php.run({
    code: await fs.readFile(
      new URL("../../../tests/fixtures/m9-order-trial.php", import.meta.url),
      "utf8",
    ),
  });
  if (response.errors || response.exitCode !== 0)
    throw Error(response.errors || response.text);
  const result = JSON.parse(response.text);
  if (
    result.controls < 30 ||
    result.network_requests !== 0 ||
    result.real_database_writes !== 0
  )
    throw Error("PHP_CONTROLS_INCOMPLETE");
  console.log(JSON.stringify(result));
} finally {
  php.exit();
}
