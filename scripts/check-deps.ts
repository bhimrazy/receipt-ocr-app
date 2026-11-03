#!/usr/bin/env bun
// Dependency hygiene (Bun has no `dedupe`): one version per package across the workspace,
// exact pins only, and a lockfile that matches the manifests.
import { Glob } from "bun";

const SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"] as const;
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const manifests = ["package.json"];
for await (const f of new Glob("{apps,packages}/*/package.json").scan(".")) manifests.push(f);

const problems: string[] = [];
const versions = new Map<string, Map<string, string[]>>();

for (const file of manifests.sort()) {
  const pkg = await Bun.file(file).json();
  for (const section of SECTIONS) {
    for (const [name, spec] of Object.entries<string>(pkg[section] ?? {})) {
      if (spec.startsWith("workspace:")) continue;
      if (!EXACT.test(spec)) problems.push(`${file}: ${name}@${spec} is not an exact pin`);
      const bySpec = versions.get(name) ?? new Map<string, string[]>();
      bySpec.set(spec, [...(bySpec.get(spec) ?? []), file]);
      versions.set(name, bySpec);
    }
  }
}

for (const [name, bySpec] of versions) {
  if (bySpec.size < 2) continue;
  const detail = [...bySpec].map(([spec, files]) => `${spec} (${files.join(", ")})`).join(" vs ");
  problems.push(`${name} has several versions: ${detail}`);
}

// A frozen install fails when bun.lock would change.
const install = Bun.spawnSync(["bun", "install", "--frozen-lockfile", "--dry-run"], {
  stdout: "pipe",
  stderr: "pipe",
});
if (install.exitCode !== 0) {
  problems.push(`bun.lock is out of sync with package.json:\n${install.stderr.toString().trim()}`);
}

if (problems.length > 0) {
  console.error(`check-deps: ${problems.length} problem(s)\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`check-deps: ok (${manifests.length} manifests, ${versions.size} external packages)`);
