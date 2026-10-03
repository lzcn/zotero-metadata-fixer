import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url);
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const manifest = JSON.parse(
  await readFile(new URL("manifest.json", root), "utf8"),
);
const directory = new URL(`release/v${pkg.version}/`, root);
await mkdir(directory, { recursive: true });
const name = `${pkg.name}.xpi`;
const bytes = await readFile(new URL(`dist/${name}`, root));
await copyFile(new URL(`dist/${name}`, root), new URL(name, directory));
await writeFile(
  new URL("SHA256SUMS", directory),
  `${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`,
);
const checksum = createHash("sha256").update(bytes).digest("hex");
const host = manifest.applications.zotero;
await writeFile(
  new URL("updates.json", directory),
  JSON.stringify(
    {
      addons: {
        [host.id]: {
          updates: [
            {
              version: pkg.version,
              update_link: `https://github.com/lzcn/${pkg.name}/releases/download/v${pkg.version}/${name}`,
              update_hash: `sha256:${checksum}`,
              applications: {
                zotero: {
                  strict_min_version: host.strict_min_version,
                  strict_max_version: host.strict_max_version,
                },
              },
            },
          ],
        },
      },
    },
    null,
    2,
  ) + "\n",
);
for (const file of [
  "README.md",
  "README.zh-CN.md",
  "LICENSE",
  "THIRD-PARTY-NOTICES",
]) {
  await copyFile(new URL(file, root), new URL(file, directory));
}
console.log(`Prepared release/v${pkg.version}; nothing was uploaded.`);
