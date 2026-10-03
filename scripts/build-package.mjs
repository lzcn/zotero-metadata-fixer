import { build } from "esbuild";
import { zipSync, unzipSync } from "fflate";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(await readFile(root + "package.json", "utf8"));
const manifest = JSON.parse(await readFile(root + "manifest.json", "utf8"));
assert.equal(pkg.version, manifest.version);
assert.equal(manifest.applications.zotero.id, "metadata-linter@lzcn");
// Zotero rejects manifests without these fields before checking compatibility.
for (const field of ["id", "update_url", "strict_max_version"])
  assert.ok(
    manifest.applications.zotero[field],
    `Missing applications.zotero.${field}`,
  );
assert.equal(
  new URL(manifest.applications.zotero.update_url).protocol,
  "https:",
);
const bundle = await build({
  entryPoints: [root + "src/runtime.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "MetadataLinter",
  platform: "browser",
  target: "firefox140",
  legalComments: "inline",
});
const files = { "content/runtime.js": bundle.outputFiles[0].contents };
for (const name of [
  "manifest.json",
  "bootstrap.js",
  "LICENSE",
  "THIRD-PARTY-NOTICES",
  "data/conferences.json",
  "data/conference-catalog.json",
])
  files[name] = await readFile(root + name);
for (const name of await readdir(root + "content"))
  files["content/" + name] = await readFile(root + "content/" + name);
for (const [size, name] of Object.entries({
  ...manifest.icons,
  16: "icons/icon-16.png",
  20: "icons/icon-20.png",
})) {
  const png = await readFile(root + name);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), Number(size), `${name}: wrong width`);
  assert.equal(png.readUInt32BE(20), Number(size), `${name}: wrong height`);
  files[name] = png;
}
for (const [name, bytes] of Object.entries(files))
  if (name.endsWith(".js"))
    new Script(Buffer.from(bytes).toString("utf8"), { filename: name });
const bytes = zipSync(files, {
  level: 9,
  mtime: new Date("2020-01-01T00:00:00Z"),
});
const unpacked = unzipSync(bytes);
assert.deepEqual(Object.keys(unpacked).sort(), Object.keys(files).sort());
assert.ok(unpacked["content/dialog.xhtml"]);
assert.ok(unpacked["content/runtime.js"]);
assert.ok(unpacked["data/conferences.json"]);
await mkdir(root + "dist", { recursive: true });
await writeFile(root + "dist/" + pkg.name + ".xpi", bytes);
console.log(`Built dist/${pkg.name}.xpi (${bytes.length} bytes)`);
