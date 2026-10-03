import { build } from "esbuild";
import { readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
await rm(root + ".tests-build", { recursive: true, force: true });
await build({
  entryPoints: (await readdir(root + "src"))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => root + "src/" + name),
  outdir: root + ".tests-build",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
});
const tests = (await readdir(root + "tests"))
  .filter((name) => name.endsWith(".test.mjs"))
  .map((name) => root + "tests/" + name);
const result = spawnSync(process.execPath, ["--test", ...tests], {
  cwd: root,
  stdio: "inherit",
});
process.exitCode = result.status ?? 1;
