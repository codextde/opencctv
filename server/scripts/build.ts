import { mkdirSync } from "node:fs";
import pkg from "../package.json" with { type: "json" };

const ALL = ["linux-x64", "linux-arm64", "darwin-arm64", "darwin-x64", "windows-x64"];
const host = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
const args = process.argv.slice(2).map((a) => (a === "local" ? host : a));
const targets = args.length ? args : ALL;

const defines: string[] = [];
for (const [name, value] of [
  ["OPENCCTV_BUILTIN_GOOGLE_CLIENT_ID", process.env.GOOGLE_CLIENT_ID],
  ["OPENCCTV_BUILTIN_GOOGLE_CLIENT_SECRET", process.env.GOOGLE_CLIENT_SECRET],
]) if (value) defines.push("--define", `${name}=${JSON.stringify(value)}`);

const GEN = "src/eufy-worker.gen.ts";
const worker = await Bun.build({ entrypoints: ["src/eufy-worker.mjs"], target: "node", format: "esm", minify: true });
if (!worker.success) throw new Error(`eufy worker bundle failed: ${worker.logs.join("\n")}`);
await Bun.write(GEN, `export default ${JSON.stringify(await worker.outputs[0]!.text())};\n`);
const restoreGen = () => Bun.write(GEN, 'export default "";\n');

mkdirSync("dist", { recursive: true });
for (const t of targets) {
  if (!ALL.includes(t)) throw new Error(`unknown target ${t}`);
  const out = `dist/opencctv-${t}${t.startsWith("windows") ? ".exe" : ""}`;
  console.log(`building ${out}`);
  const p = Bun.spawn(
    [
      "bun", "build", "--compile", "--production",
      `--target=bun-${t}`,
      ...defines,
      "src/index.ts", "--outfile", out,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if ((await p.exited) !== 0) {
    await restoreGen();
    process.exit(1);
  }
}
await restoreGen();
console.log(`built OpenCCTV ${pkg.version}`);
