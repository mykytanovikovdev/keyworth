/**
 * What the browser downloads: builds the app with source maps into a
 * temporary folder (the real `dist/` and the deploy target are untouched), lists every script chunk
 * with its size and gzip size, and breaks the largest chunk down by package and
 * project folder. Usage: `npm run bundle:size` (`-- --all` for every group,
 * not only the 30 largest).
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { sizesByGroup, sizesBySource, type SourceMap } from "./bundle-map.ts";

const showAll = process.argv.includes("--all");
const out = mkdtempSync(join(tmpdir(), "keyworth-bundle-"));
// Every build points `wrangler deploy` at its own output; put it back after.
const DEPLOY_TARGET = ".wrangler/deploy/config.json";
const deployTarget = existsSync(DEPLOY_TARGET)
  ? readFileSync(DEPLOY_TARGET, "utf8")
  : null;
const kB = (bytes: number) => `${(bytes / 1024).toFixed(1)} kB`.padStart(10);

try {
  const build = spawnSync(
    "npx",
    ["vite", "build", "--sourcemap", "--outDir", out, "--logLevel", "error"],
    { stdio: "inherit" },
  );
  if (build.status !== 0) process.exit(build.status ?? 1);

  const assets = join(out, "client", "assets");
  const chunks = readdirSync(assets)
    .filter((file) => file.endsWith(".js"))
    .map((file) => {
      const code = readFileSync(join(assets, file), "utf8");
      return { file, code, size: Buffer.byteLength(code) };
    })
    .sort((a, b) => b.size - a.size);

  console.log("\nScript chunks (size, gzip):");
  for (const { file, code, size } of chunks) {
    console.log(`${kB(size)} ${kB(gzipSync(code).length)}  ${file}`);
  }

  const largest = chunks[0];
  if (largest) {
    const map = JSON.parse(
      readFileSync(join(assets, `${largest.file}.map`), "utf8"),
    ) as SourceMap;
    const groups = sizesByGroup(sizesBySource(largest.code, map));
    console.log(`\n${largest.file} by package and folder:`);
    for (const [group, size] of showAll ? groups : groups.slice(0, 30)) {
      console.log(`${kB(size)}  ${group}`);
    }
    if (!showAll && groups.length > 30) {
      console.log(`  … ${String(groups.length - 30)} more (--all)`);
    }
  }
} finally {
  rmSync(out, { recursive: true, force: true });
  if (deployTarget === null) rmSync(DEPLOY_TARGET, { force: true });
  else writeFileSync(DEPLOY_TARGET, deployTarget);
}
