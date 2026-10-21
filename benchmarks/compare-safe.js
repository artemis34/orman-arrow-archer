import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")),
);
if (!args.baseline || !args.codec)
  throw new Error(
    "Pass --baseline=SOURCE_ROOT --codec=SOURCE_ROOT; --candidate defaults to current checkout",
  );
const roots = {
  baseline: resolve(args.baseline),
  codec: resolve(args.codec),
  candidate: resolve(args.candidate || "."),
};
const out = resolve(args.outdir || "/tmp/wildbow-safe-comparison");
mkdirSync(out, { recursive: true });
const cases = [
    "arena-8",
    "team-16",
    "team-bots",
    "codec-floats",
    "client-view",
  ],
  results = [];
for (const [i, id] of cases.entries()) {
  const stages = Object.keys(roots);
  const order = [...stages.slice(i % 3), ...stages.slice(0, i % 3)];
  for (const stage of order) {
    const path = resolve(out, `${id}-${stage}.json`);
    const run = spawnSync(
      process.execPath,
      [
        "--expose-gc",
        "benchmarks/safe-optimizations.js",
        `--root=${roots[stage]}`,
        `--label=${stage}`,
        `--only=${id}`,
        "--warmups=2",
        `--repeats=${args.repeats || 7}`,
        `--out=${path}`,
      ],
      { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
    );
    process.stdout.write(run.stdout);
    process.stderr.write(run.stderr);
    if (run.status !== 0) process.exit(run.status || 1);
    const report = JSON.parse(readFileSync(path));
    results.push({
      id,
      stage,
      environment: report.environment,
      runtimeSha256: report.runtimeSha256,
      ...report.results[0],
    });
  }
}
writeFileSync(
  resolve(out, "summary.json"),
  JSON.stringify(
    { order: "rotated by case; independent sequential processes", results },
    null,
    2,
  ) + "\n",
);
