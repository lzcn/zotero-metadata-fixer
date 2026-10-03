import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url);
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const directory = new URL(`release/v${pkg.version}/`, root);
await mkdir(directory, { recursive: true });
const name = `${pkg.name}.xpi`;
const bytes = await readFile(new URL(`dist/${name}`, root));
await copyFile(new URL(`dist/${name}`, root), new URL(name, directory));
await writeFile(
  new URL("SHA256SUMS", directory),
  `${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`,
);
console.log(`Prepared release/v${pkg.version}; nothing was uploaded.`);
