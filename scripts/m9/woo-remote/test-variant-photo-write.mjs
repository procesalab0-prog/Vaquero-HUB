// Execute the PHP writer in the already installed, isolated Playground runtime.
// No WordPress bootstrap, real database, credentials or HTTP requests.
import fs from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const runtime = process.argv[2];
if (!runtime || process.argv.length !== 3)
  throw Error("Usage: test-variant-photo-write.mjs EXISTING_RUNTIME_DIR");
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
  const writerSource = await fs.readFile(
    new URL("./variant-photo-write.php", import.meta.url),
    "utf8",
  );
  php.writeFile("/variant-photo-write.php", writerSource);
  const fixture = await fs.readFile(
    new URL(
      "../../../tests/fixtures/m9-variant-photo-write.php",
      import.meta.url,
    ),
    "utf8",
  );
  const response = await php.run({ code: fixture });
  if (response.errors || response.exitCode !== 0)
    throw Error(response.errors || response.text);
  const result = JSON.parse(response.text);
  if (
    result.controls !== 42 ||
    result.network_requests !== 0 ||
    result.real_database_writes !== 0
  )
    throw Error("PHP_WRITER_CONTROLS_INCOMPLETE:" + JSON.stringify(result));
  console.log(
    JSON.stringify({
      ...result,
      scope: "ISOLATED_PHP_FIXTURES_NOT_LIVE_REMOTE_WOO",
    }),
  );
} finally {
  php.exit();
}
