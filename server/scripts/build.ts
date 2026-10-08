import { mkdirSync } from "node:fs";
import pkg from "../package.json" with { type: "json" };

const ALL = ["linux-x64", "linux-arm64", "darwin-arm64", "darwin-x64", "windows-x64"];
const args = process.argv.slice(2);
const targets = args.length ? args : ALL;

mkdirSync("dist", { recursive: true });
for (const t of targets) {
  if (!ALL.includes(t)) throw new Error(`unknown target ${t}`);
  const out = `dist/opencctv-${t}${t.startsWith("windows") ? ".exe" : ""}`;
  console.log(`building ${out}`);
  const p = Bun.spawn(
    [
      "bun", "build", "--compile", "--minify",
      `--target=bun-${t}`,
      "--define", `process.env.NODE_ENV="production"`,
      "src/index.ts", "--outfile", out,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if ((await p.exited) !== 0) process.exit(1);
}
console.log(`built OpenCCTV ${pkg.version}`);
