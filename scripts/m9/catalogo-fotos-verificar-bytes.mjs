import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fetchPhoto } from "./woo-remote/process-job.mjs";
import { parseVariantPhotoUrls } from "./prepare-variant-photos.mjs";
import { stable } from "./woo-test/plan.mjs";
const digest = (x) => createHash("sha256").update(x).digest("hex");
const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
function checkBytes(bytes, mime) {
  const magic =
    mime === "image/jpeg"
      ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : mime === "image/png"
        ? bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mime === "image/webp"
          ? bytes.toString("ascii", 0, 4) === "RIFF" &&
            bytes.toString("ascii", 8, 12) === "WEBP"
          : false;
  if (!magic || bytes.length < 1 || bytes.length > 4194304)
    throw Error("INVALID_PHOTO_BYTES_OR_MIME");
}
export async function existingPublicPhotoReader(url) {
  let mime;
  const file = await fetchPhoto(url, async (target, options) => {
    const response = await fetch(target, options);
    mime = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!Object.hasOwn(ext, mime)) {
      await response.body?.cancel();
      throw Error("INVALID_PHOTO_CONTENT_TYPE");
    }
    return response;
  });
  return { ...file, mime };
}
export async function verifyCatalogPhotoBytes(
  plan,
  reader = existingPublicPhotoReader,
) {
  const { plan_sha256, ...body } = plan ?? {};
  if (
    plan?.protocol !== "m9-photo-gap-refresh-1" ||
    plan.project_id !== "zsezjtswqeijboezvado" ||
    plan_sha256 !== digest(stable(body)) ||
    plan.import_allowed !== false ||
    plan.send_allowed !== false ||
    plan.inert_batch?.executable !== false ||
    plan.summary?.new_photos_to_prepare !== plan.inert_batch?.items?.length
  )
    throw Error("PINNED_INERT_PHOTO_PLAN_REQUIRED");
  const targets = new Set();
  for (const item of plan.inert_batch.items) {
    const parsed = parseVariantPhotoUrls(item.new_images);
    if (
      !parsed.valid ||
      parsed.urls.length === 0 ||
      stable(parsed.urls) !== stable(item.urls) ||
      item.import_allowed !== false ||
      item.send_allowed !== false
    )
      throw Error("EXACT_PHOTO_URLS_REQUIRED");
    for (const url of parsed.urls) targets.add(url);
  }
  if (targets.size > 20) throw Error("SMALL_PHOTO_BYTE_BATCH_REQUIRED");
  const files = new Map(),
    proofs = [];
  let total = 0;
  for (const url of [...targets].sort()) {
    const file = await reader(url),
      bytes = Buffer.from(file.base64, "base64");
    checkBytes(bytes, file.mime);
    const sha256 = digest(bytes);
    if (file.sha256 !== sha256) throw Error("PHOTO_READER_DIGEST_MISMATCH");
    total += bytes.length;
    if (total > 64 * 1024 * 1024) throw Error("PHOTO_BATCH_BYTES_LIMIT");
    const name = `${sha256}.${ext[file.mime]}`;
    files.set(name, bytes);
    proofs.push({
      url,
      sha256,
      bytes: bytes.length,
      mime: file.mime,
      file: name,
    });
  }
  return {
    protocol: "m9-photo-local-bytes-1",
    plan_sha256,
    proofs,
    files,
    total_bytes: total,
    downloads: targets.size,
    import_allowed: false,
    send_allowed: false,
    writes_performed: 0,
  };
}
export async function verifyLocalCatalogPhotoBytes(path) {
  const packet = JSON.parse(
    await readFile(resolve(path, "proofs.json"), "utf8"),
  );
  for (const p of packet.proofs) {
    if (!/^[a-f0-9]{64}[.](jpg|png|webp)$/.test(p.file))
      throw Error("INVALID_LOCAL_PHOTO_FILE");
    const bytes = await readFile(resolve(path, p.file));
    checkBytes(bytes, p.mime);
    if (bytes.length !== p.bytes || digest(bytes) !== p.sha256)
      throw Error("LOCAL_PHOTO_BYTES_CHANGED");
  }
  return {
    files_verified: packet.proofs.length,
    sha256: packet.plan_sha256,
    network_requests: 0,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv[2] === "--verify-local")
    console.log(
      JSON.stringify(
        await verifyLocalCatalogPhotoBytes(resolve(process.argv[3])),
      ),
    );
  else {
    if (process.argv.length !== 5)
      throw Error(
        "USAGE: PLAN_FILE EXPECTED_FILE_SHA256 NEW_PRIVATE_OUTPUT_DIR",
      );
    const bytes = await readFile(resolve(process.argv[2]));
    if (digest(bytes) !== process.argv[3]) throw Error("PLAN_FILE_SHA_CHANGED");
    const packet = await verifyCatalogPhotoBytes(JSON.parse(bytes)),
      out = resolve(process.argv[4]);
    await mkdir(out, { recursive: false, mode: 0o700 });
    for (const [name, data] of packet.files)
      await writeFile(resolve(out, name), data, { flag: "wx", mode: 0o600 });
    const proof = { ...packet };
    delete proof.files;
    await writeFile(
      resolve(out, "proofs.json"),
      JSON.stringify(proof, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    console.log(JSON.stringify(await verifyLocalCatalogPhotoBytes(out)));
  }
}
