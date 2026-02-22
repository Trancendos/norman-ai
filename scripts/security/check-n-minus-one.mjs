#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SKIP_SPEC_PREFIXES = [
  "workspace:",
  "file:",
  "link:",
  "git+",
  "github:",
  "http:",
  "https:",
  "ssh:",
];

function isSkippableSpec(spec) {
  if (typeof spec !== "string") {
    return true;
  }
  return SKIP_SPEC_PREFIXES.some((prefix) => spec.startsWith(prefix));
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    status: result.status ?? 1,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

function parseJsonSafe(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseSingleVersion(output) {
  const parsed = parseJsonSafe(output);
  if (typeof parsed === "string") {
    return parsed;
  }
  if (Array.isArray(parsed) && parsed.length > 0) {
    return parsed[parsed.length - 1];
  }

  const cleaned = output.replace(/^['"]|['"]$/g, "").trim();
  if (/^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(cleaned)) {
    return cleaned;
  }
  return null;
}

function major(version) {
  const match = /^(\d+)\./.exec(version);
  return match ? Number.parseInt(match[1], 10) : null;
}

function resolveVersion(name, spec) {
  const result = runCommand("npm", ["view", `${name}@${spec}`, "version", "--json"]);
  if (result.status !== 0) {
    return { ok: false, reason: result.stderr || "unable to resolve declared range" };
  }
  const resolvedVersion = parseSingleVersion(result.stdout);
  if (!resolvedVersion) {
    return { ok: false, reason: "resolved version parsing failed" };
  }
  return { ok: true, version: resolvedVersion };
}

function latestVersion(name) {
  const result = runCommand("npm", ["view", name, "version", "--json"]);
  if (result.status !== 0) {
    return { ok: false, reason: result.stderr || "unable to fetch latest version" };
  }
  const parsed = parseSingleVersion(result.stdout);
  if (!parsed) {
    return { ok: false, reason: "latest version parsing failed" };
  }
  return { ok: true, version: parsed };
}

function classifyCompliance(currentMajor, latestMajor) {
  if (currentMajor === latestMajor) {
    return "N0";
  }
  if (currentMajor === latestMajor - 1) {
    return "N1";
  }
  if (currentMajor < latestMajor - 1) {
    return "NON_COMPLIANT";
  }
  return "AHEAD_OR_PRERELEASE";
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const packageJsonPath = path.join(root, "package.json");

  if (!existsSync(packageJsonPath)) {
    console.error("package.json not found. Nothing to analyze.");
    process.exit(2);
  }

  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const directDeps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
    ...(packageJson.optionalDependencies || {}),
  };

  const entries = Object.entries(directDeps);
  if (entries.length === 0) {
    console.log("No dependencies declared. N-0/N-1 policy check skipped.");
    return;
  }

  const results = [];
  const skipped = [];

  for (const [name, spec] of entries) {
    if (isSkippableSpec(spec)) {
      skipped.push({ name, spec, reason: "non-registry or internal dependency spec" });
      continue;
    }

    const declared = resolveVersion(name, spec);
    if (!declared.ok) {
      results.push({
        name,
        spec,
        status: "UNRESOLVED",
        detail: declared.reason,
      });
      continue;
    }

    const latest = latestVersion(name);
    if (!latest.ok) {
      results.push({
        name,
        spec,
        status: "UNRESOLVED",
        detail: latest.reason,
      });
      continue;
    }

    const currentMajor = major(declared.version);
    const latestMajor = major(latest.version);
    if (currentMajor === null || latestMajor === null) {
      results.push({
        name,
        spec,
        status: "UNRESOLVED",
        detail: "unable to parse semver major versions",
      });
      continue;
    }

    const status = classifyCompliance(currentMajor, latestMajor);
    results.push({
      name,
      spec,
      declaredVersion: declared.version,
      latestVersion: latest.version,
      currentMajor,
      latestMajor,
      status,
    });
  }

  const compliant = results.filter((item) => item.status === "N0" || item.status === "N1");
  const nonCompliant = results.filter((item) => item.status === "NON_COMPLIANT");
  const unresolved = results.filter((item) => item.status === "UNRESOLVED");

  console.log(`Dependencies analyzed: ${results.length}`);
  console.log(`Skipped dependencies: ${skipped.length}`);
  console.log(`N0/N1 compliant dependencies: ${compliant.length}`);
  console.log(`Non-compliant dependencies: ${nonCompliant.length}`);
  console.log(`Unresolved dependencies: ${unresolved.length}`);

  for (const item of results) {
    const base = `- ${item.name}@${item.spec}`;
    if (item.status === "UNRESOLVED") {
      console.log(`${base} -> ${item.status} (${item.detail})`);
      continue;
    }
    console.log(
      `${base} -> ${item.status} (declared=${item.declaredVersion}, latest=${item.latestVersion})`,
    );
  }

  if (nonCompliant.length > 0 || unresolved.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
