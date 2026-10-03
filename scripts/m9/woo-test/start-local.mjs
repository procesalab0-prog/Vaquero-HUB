import { Server } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { runtimeMode } from "./runtime-mode.mjs";

// Runtime dependencies live OUTSIDE the application's shared node_modules.
if (!process.argv[2])
  throw new Error("Usage: start-local.mjs ISOLATED_RUNTIME_DIR");
const root = resolve(process.argv[2]);
if (process.argv.length > 4) throw new Error("UNKNOWN_RUNTIME_OPTION");
const recoveryMarker = await readFile(
  resolve(root, "private/recovery.json"),
  "utf8",
)
  .then(JSON.parse)
  .catch((e) => {
    if (e.code !== "ENOENT") throw e;
    return null;
  });
const { port, readOnly } = runtimeMode(root, process.argv[3], recoveryMarker);
await mkdir(resolve(root, "wordpress"), { recursive: true });
await mkdir(resolve(root, "private"), { recursive: true, mode: 0o700 });
const guard = await readFile(
  new URL("./local-guard.php", import.meta.url),
  "utf8",
);
// Playground 3.1.56 listens without a host argument. Restrict every TCP listener
// in this dedicated process before importing/starting it; do not expose admin on LAN.
const originalListen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
  if (typeof args[0] === "number") {
    const callback = args.find((arg) => typeof arg === "function");
    return originalListen.call(
      this,
      { port: args[0], host: "127.0.0.1" },
      callback,
    );
  }
  throw new Error("UNEXPECTED_LISTENER_OPTIONS");
};
const { runCLI } = await import(
  pathToFileURL(resolve(root, "node_modules/@wp-playground/cli/index.js"))
);
const installed = await readFile(
  resolve(root, "private/installed.json"),
  "utf8",
)
  .then(() => true)
  .catch((e) => {
    if (e.code !== "ENOENT") throw e;
    return false;
  });
const wordpressExists = await readFile(
  resolve(root, "wordpress/wp-includes/version.php"),
  "utf8",
)
  .then(() => true)
  .catch((e) => {
    if (e.code !== "ENOENT") throw e;
    return false;
  });
if (!installed && wordpressExists)
  throw new Error(
    "INCOMPLETE_INSTALLATION_REQUIRES_REVIEW_USE_A_NEW_DIRECTORY",
  );
if (installed && !wordpressExists)
  throw new Error("PERSISTED_WORDPRESS_FILES_MISSING");
if (readOnly && !installed) throw new Error("RECOVERY_INSTALL_FORBIDDEN");
const blueprint = {
  constants: {
    WP_ENVIRONMENT_TYPE: "local",
    DISABLE_WP_CRON: true,
    WP_HTTP_BLOCK_EXTERNAL: true,
    AUTOMATIC_UPDATER_DISABLED: true,
    ...(readOnly
      ? {
          M9_RECOVERY_READ_ONLY: true,
          WP_HOME: `http://127.0.0.1:${port}`,
          WP_SITEURL: `http://127.0.0.1:${port}`,
        }
      : {}),
  },
  steps: [
    { step: "mkdir", path: "/wordpress/wp-content/mu-plugins" },
    {
      step: "writeFile",
      path: "/wordpress/wp-content/mu-plugins/m9-local-guard.php",
      data: guard,
    },
    ...(!installed
      ? [
          {
            step: "installPlugin",
            pluginData: {
              resource: "url",
              url: "https://downloads.wordpress.org/plugin/woocommerce.11.1.2.zip",
            },
            options: { activate: true },
          },
          {
            step: "setSiteOptions",
            options: {
              blogname: "Mi Tienda SM — Laboratorio WooCommerce",
              blogdescription: "PRUEBAS LOCALES SIN CONEXIÓN A LA TIENDA REAL",
              blog_public: "0",
              woocommerce_currency: "MXN",
              woocommerce_store_address: "Pruebas locales",
              woocommerce_allow_tracking: "no",
              woocommerce_onboarding_profile: { completed: true },
              permalink_structure: "/%postname%/",
            },
          },
          {
            step: "runPHP",
            code: `<?php require '/wordpress/wp-load.php'; wp_set_password('${randomBytes(32).toString("hex")}',1); $r=WP_Application_Passwords::create_new_application_password(1,array('name'=>'M9 local worker')); if(is_wp_error($r)) throw new Exception('Application password setup failed'); file_put_contents('/m9-private/auth.json',json_encode(array('username'=>get_userdata(1)->user_login,'password'=>$r[0]))); chmod('/m9-private/auth.json',0600);`,
          },
        ]
      : []),
    ...(!readOnly
      ? [
          {
            step: "runPHP",
            code: "<?php require '/wordpress/wp-load.php'; delete_transient('_wc_activation_redirect');",
          },
        ]
      : []),
  ],
};
const instance = await runCLI({
  command: "server",
  define: {
    WP_ENVIRONMENT_TYPE: "local",
    ...(readOnly
      ? {
          WP_HOME: `http://127.0.0.1:${port}`,
          WP_SITEURL: `http://127.0.0.1:${port}`,
        }
      : {}),
  },
  "define-bool": {
    DISABLE_WP_CRON: true,
    WP_HTTP_BLOCK_EXTERNAL: true,
    AUTOMATIC_UPDATER_DISABLED: true,
    ...(readOnly ? { M9_RECOVERY_READ_ONLY: true } : {}),
  },
  php: "8.3",
  wp: "7.0.6",
  port,
  workers: 1,
  login: false,
  wordpressInstallMode: installed
    ? "do-not-attempt-installing"
    : "download-and-install",
  "mount-before-install": [
    { hostPath: resolve(root, "wordpress"), vfsPath: "/wordpress" },
    { hostPath: resolve(root, "private"), vfsPath: "/m9-private" },
  ],
  blueprint,
});
if (instance.server.address().address !== "127.0.0.1")
  throw new Error("NON_LOCAL_BIND");
await writeFile(
  resolve(root, "private/installed.json"),
  JSON.stringify({
    runtime: "@wp-playground/cli@3.1.56",
    url: `http://127.0.0.1:${port}`,
    launcher: fileURLToPath(import.meta.url),
  }) + "\n",
  { mode: 0o600 },
);
console.log(`M9_LOCAL_WOO_READY http://127.0.0.1:${port}`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await instance[Symbol.asyncDispose]();
    process.exit(0);
  });
