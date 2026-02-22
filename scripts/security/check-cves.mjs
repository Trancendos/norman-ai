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

function extractVersionFromNpmViewOutput(output) {
  if (!output) {
    return null;
  }

  const parsed = parseJsonSafe(output);
  if (typeof parsed === "string") {
    return parsed;
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return null;
    }
    return parsed[parsed.length - 1];
  }

  const trimmed = output.replace(/^['"]|['"]$/g, "").trim();
  if (/^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function resolveConcreteVersion(pkgName, spec) {
  const attempt = runCommand("npm", ["view", `${pkgName}@${spec}`, "version", "--json"]);
  if (attempt.status === 0) {
    const version = extractVersionFromNpmViewOutput(attempt.stdout);
    if (version) {
      return { ok: true, version };
    }
  }

  return {
    ok: false,
    reason:
      attempt.stderr ||
      `Unable to resolve a concrete version for ${pkgName}@${spec}`,
  };
}

function extractSeverity(vulnerability) {
  const sevEntries = vulnerability?.severity;
  if (!Array.isArray(sevEntries) || sevEntries.length === 0) {
    return "unknown";
  }
  const normalized = sevEntries
    .map((item) => item?.score)
    .filter(Boolean)
    .join(", ");
  return normalized || "unknown";
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const packageJsonPath = path.join(root, "package.json");

  if (!existsSync(packageJsonPath)) {
    console.error("package.json not found. Nothing to scan.");
    process.exit(2);
  }

  const packageJsonRaw = await readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(packageJsonRaw);

  const directDeps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
    ...(packageJson.optionalDependencies || {}),
  };

  const entries = Object.entries(directDeps);
  if (entries.length === 0) {
    console.log("No dependencies declared. CVE scan skipped.");
    return;
  }

  const scanTargets = [];
  const skipped = [];
  const unresolved = [];

  for (const [pkgName, spec] of entries) {
    if (isSkippableSpec(spec)) {
      skipped.push({ pkgName, spec, reason: "non-registry or internal dependency spec" });
      continue;
    }

    const resolved = resolveConcreteVersion(pkgName, spec);
    if (!resolved.ok) {
      unresolved.push({ pkgName, spec, reason: resolved.reason });
      continue;
    }

    scanTargets.push({
      pkgName,
      declaredSpec: spec,
      resolvedVersion: resolved.version,
    });
  }

  if (scanTargets.length === 0) {
    console.log("No external registry dependencies resolved for CVE scanning.");
    if (unresolved.length > 0) {
      console.error("Some dependencies could not be resolved:");
      for (const item of unresolved) {
        console.error(`- ${item.pkgName}@${item.spec}: ${item.reason}`);
      }
      process.exit(2);
    }
    return;
  }

  const queryPayload = {
    queries: scanTargets.map((target) => ({
      package: { ecosystem: "npm", name: target.pkgName },
      version: target.resolvedVersion,
    })),
  };

  const response = await fetch("https://api.osv.dev/v1/querybatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(queryPayload),
  });

  if (!response.ok) {
    console.error(`OSV query failed with HTTP ${response.status}`);
    process.exit(2);
  }

  const osvResult = await response.json();
  const results = Array.isArray(osvResult?.results) ? osvResult.results : [];

  const findings = [];
  for (let i = 0; i < results.length; i += 1) {
    const vulns = results[i]?.vulns || [];
    if (vulns.length === 0) {
      continue;
    }

    const target = scanTargets[i];
    for (const vuln of vulns) {
      findings.push({
        package: target.pkgName,
        declared: target.declaredSpec,
        resolved: target.resolvedVersion,
        id: vuln.id || "unknown-id",
        aliases: Array.isArray(vuln.aliases) ? vuln.aliases.join(", ") : "",
        summary: (vuln.summary || "").replace(/\s+/g, " ").trim(),
        severity: extractSeverity(vuln),
      });
    }
  }

  console.log(`Scanned dependencies: ${scanTargets.length}`);
  console.log(`Skipped dependencies: ${skipped.length}`);
  if (unresolved.length > 0) {
    console.log(`Unresolved dependencies: ${unresolved.length}`);
    for (const item of unresolved) {
      console.log(`  - ${item.pkgName}@${item.spec}: ${item.reason}`);
    }
  }

  if (findings.length === 0) {
    console.log("No known CVEs found for direct dependencies at resolved versions.");
    if (unresolved.length > 0) {
      process.exit(2);
    }
    return;
  }

  console.error(`Detected ${findings.length} vulnerability findings:`);
  for (const finding of findings) {
    console.error(
      [
        `- ${finding.package}@${finding.resolved}`,
        `id=${finding.id}`,
        finding.aliases ? `aliases=${finding.aliases}` : "",
        `severity=${finding.severity}`,
        finding.summary ? `summary=${finding.summary}` : "",
      ]
        .filter(Boolean)
        .join(" | "),
    );
  }

  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
