#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const NODE_VENDOR_PATTERNS = [
  { vendor: "AWS", patterns: [/^@aws-sdk\//i, /^aws-sdk$/i, /^aws-/i] },
  { vendor: "Google", patterns: [/^@google-cloud\//i, /^googleapis$/i, /^gcp-/i] },
  { vendor: "Microsoft", patterns: [/^@azure\//i, /^microsoft-/i] },
  { vendor: "OpenAI", patterns: [/^openai$/i] },
  { vendor: "Anthropic", patterns: [/^@anthropic-ai\//i, /^anthropic$/i] },
  { vendor: "Cloudflare", patterns: [/^cloudflare$/i, /^@cloudflare\//i] },
  { vendor: "Vercel", patterns: [/^vercel$/i, /^@vercel\//i, /^next$/i] },
  { vendor: "GitHub", patterns: [/^@octokit\//i, /^@actions\//i] },
  { vendor: "Stripe", patterns: [/^stripe$/i, /^@stripe\//i] },
];

const PYTHON_VENDOR_PATTERNS = [
  { vendor: "AWS", patterns: [/^boto3$/i, /^botocore$/i, /^aws-/i] },
  { vendor: "Google", patterns: [/^google-cloud-/i, /^google-api-python-client$/i] },
  { vendor: "Microsoft", patterns: [/^azure-/i] },
  { vendor: "OpenAI", patterns: [/^openai$/i] },
  { vendor: "Anthropic", patterns: [/^anthropic$/i] },
  { vendor: "Cloudflare", patterns: [/^cloudflare$/i] },
  { vendor: "Stripe", patterns: [/^stripe$/i] },
];

function parseArgs(argv) {
  const args = {
    owner: "",
    limit: 200,
    outputDir: "reports",
    includeForks: false,
    includeArchived: false,
  };

  for (const token of argv) {
    if (token.startsWith("--owner=")) {
      args.owner = token.slice("--owner=".length).trim();
    } else if (token.startsWith("--limit=")) {
      const parsed = Number.parseInt(token.slice("--limit=".length), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        args.limit = parsed;
      }
    } else if (token.startsWith("--output-dir=")) {
      args.outputDir = token.slice("--output-dir=".length).trim();
    } else if (token === "--include-forks") {
      args.includeForks = true;
    } else if (token === "--include-archived") {
      args.includeArchived = true;
    }
  }

  return args;
}

function runGh(args) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

function parseJsonSafe(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function encodePath(pathValue) {
  return pathValue
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function listDir(repoFullName, ref, dirPath = "") {
  const encodedRef = encodeURIComponent(ref);
  const encodedPath = encodePath(dirPath);
  const endpoint = encodedPath
    ? `repos/${repoFullName}/contents/${encodedPath}?ref=${encodedRef}`
    : `repos/${repoFullName}/contents?ref=${encodedRef}`;
  const response = runGh(["api", endpoint]);
  if (response.status !== 0) {
    if (/404|Not Found|HTTP 404/i.test(response.stderr)) {
      return { ok: true, entries: [] };
    }
    return { ok: false, entries: [], error: response.stderr || "unable to list directory" };
  }

  const parsed = parseJsonSafe(response.stdout, []);
  if (!Array.isArray(parsed)) {
    return { ok: true, entries: [] };
  }
  return { ok: true, entries: parsed };
}

function fetchFile(repoFullName, ref, targetPath) {
  const encodedRef = encodeURIComponent(ref);
  const endpoint = `repos/${repoFullName}/contents/${encodePath(targetPath)}?ref=${encodedRef}`;
  const response = runGh(["api", endpoint]);
  if (response.status !== 0) {
    if (/404|Not Found|HTTP 404/i.test(response.stderr)) {
      return { ok: true, exists: false, content: "" };
    }
    return { ok: false, exists: false, content: "", error: response.stderr || "unable to fetch file" };
  }
  const parsed = parseJsonSafe(response.stdout, null);
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, exists: false, content: "", error: "unable to parse file response" };
  }
  const decoded = Buffer.from((parsed.content || "").replace(/\n/g, ""), "base64").toString("utf8");
  return { ok: true, exists: true, content: decoded };
}

function detectStacks(entries) {
  const names = new Set(entries.map((item) => item?.name).filter(Boolean));
  const stacks = [];

  if (names.has("package.json")) {
    stacks.push("nodejs");
  }
  if (names.has("requirements.txt") || names.has("pyproject.toml") || names.has("Pipfile")) {
    stacks.push("python");
  }
  if (names.has("go.mod")) {
    stacks.push("go");
  }
  if (names.has("Cargo.toml")) {
    stacks.push("rust");
  }
  if (names.has("pom.xml") || names.has("build.gradle") || names.has("build.gradle.kts")) {
    stacks.push("jvm");
  }
  if (names.has("Gemfile")) {
    stacks.push("ruby");
  }
  if (names.has("composer.json")) {
    stacks.push("php");
  }

  if (stacks.length === 0) {
    stacks.push("unknown");
  }
  return stacks;
}

function incrementVendor(vendorCount, vendorName) {
  vendorCount.set(vendorName, (vendorCount.get(vendorName) || 0) + 1);
}

function detectNodeVendors(packageJsonContent, vendorCount) {
  const packageJson = parseJsonSafe(packageJsonContent, null);
  if (!packageJson || typeof packageJson !== "object") {
    return;
  }

  const dependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
    ...(packageJson.optionalDependencies || {}),
  };

  for (const packageName of Object.keys(dependencies)) {
    for (const matcher of NODE_VENDOR_PATTERNS) {
      if (matcher.patterns.some((pattern) => pattern.test(packageName))) {
        incrementVendor(vendorCount, matcher.vendor);
      }
    }
  }
}

function normalizePythonPackage(rawLine) {
  const withoutComment = rawLine.split("#")[0].trim();
  if (!withoutComment || withoutComment.startsWith("-")) {
    return "";
  }
  return withoutComment.split(/[<>=!~\[]/)[0].trim().toLowerCase();
}

function detectPythonVendors(requirementsContent, vendorCount) {
  const lines = requirementsContent.split(/\r?\n/);
  for (const line of lines) {
    const packageName = normalizePythonPackage(line);
    if (!packageName) {
      continue;
    }
    for (const matcher of PYTHON_VENDOR_PATTERNS) {
      if (matcher.patterns.some((pattern) => pattern.test(packageName))) {
        incrementVendor(vendorCount, matcher.vendor);
      }
    }
  }
}

function summarizeVendorConcentration(vendorCount) {
  const entries = [...vendorCount.entries()].sort((a, b) => b[1] - a[1]);
  const totalSignals = entries.reduce((sum, [, count]) => sum + count, 0);
  if (entries.length === 0 || totalSignals === 0) {
    return {
      totalSignals: 0,
      dominantVendor: "none",
      dominantCount: 0,
      dominantRatio: 0,
      singleDependencyRisk: "LOW",
    };
  }

  const [dominantVendor, dominantCount] = entries[0];
  const dominantRatio = dominantCount / totalSignals;
  let singleDependencyRisk = "LOW";
  if (dominantCount >= 3 && dominantRatio >= 0.7) {
    singleDependencyRisk = "HIGH";
  } else if (dominantCount >= 2 && dominantRatio >= 0.55) {
    singleDependencyRisk = "MEDIUM";
  }

  return {
    totalSignals,
    dominantVendor,
    dominantCount,
    dominantRatio,
    singleDependencyRisk,
  };
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.owner) {
    console.error("Missing required argument: --owner=<github-owner>");
    process.exit(2);
  }

  const repoListResponse = runGh([
    "repo",
    "list",
    args.owner,
    "--limit",
    String(args.limit),
    "--json",
    "nameWithOwner,defaultBranchRef,isFork,isArchived",
  ]);
  if (repoListResponse.status !== 0) {
    console.error(repoListResponse.stderr || "Unable to list repositories.");
    process.exit(2);
  }

  const listedRepos = parseJsonSafe(repoListResponse.stdout, []);
  if (!Array.isArray(listedRepos) || listedRepos.length === 0) {
    console.error("No repositories returned.");
    process.exit(2);
  }

  const repos = listedRepos.filter((repo) => {
    if (!args.includeForks && repo.isFork) {
      return false;
    }
    if (!args.includeArchived && repo.isArchived) {
      return false;
    }
    return true;
  });

  const rows = [];
  const errors = [];

  for (const repo of repos) {
    const repoFullName = repo.nameWithOwner;
    const branch = repo.defaultBranchRef?.name || "main";
    const root = listDir(repoFullName, branch, "");
    if (!root.ok) {
      errors.push(`${repoFullName}: ${root.error}`);
      continue;
    }

    const stacks = detectStacks(root.entries);
    const vendorCount = new Map();

    if (stacks.includes("nodejs")) {
      const packageJsonFile = fetchFile(repoFullName, branch, "package.json");
      if (packageJsonFile.ok && packageJsonFile.exists) {
        detectNodeVendors(packageJsonFile.content, vendorCount);
      } else if (!packageJsonFile.ok) {
        errors.push(`${repoFullName}:package.json: ${packageJsonFile.error}`);
      }
    }

    if (stacks.includes("python")) {
      const reqFile = fetchFile(repoFullName, branch, "requirements.txt");
      if (reqFile.ok && reqFile.exists) {
        detectPythonVendors(reqFile.content, vendorCount);
      }
    }

    const externalInventoryFile = fetchFile(repoFullName, branch, ".governance/external-services.json");
    const hasExternalInventory = externalInventoryFile.ok && externalInventoryFile.exists;

    const concentration = summarizeVendorConcentration(vendorCount);
    rows.push({
      repo: repoFullName,
      stacks: stacks.join(";"),
      vendorSignals: concentration.totalSignals,
      dominantVendor: concentration.dominantVendor,
      dominantVendorSignals: concentration.dominantCount,
      dominantVendorRatio: concentration.dominantRatio.toFixed(2),
      singleDependencyRisk: concentration.singleDependencyRisk,
      hasExternalServiceInventory: hasExternalInventory,
      vendorsDetected: [...vendorCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => `${name}:${count}`)
        .join(";"),
    });
  }

  rows.sort((a, b) => {
    const severityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    if (severityOrder[a.singleDependencyRisk] !== severityOrder[b.singleDependencyRisk]) {
      return severityOrder[a.singleDependencyRisk] - severityOrder[b.singleDependencyRisk];
    }
    return Number.parseFloat(b.dominantVendorRatio) - Number.parseFloat(a.dominantVendorRatio);
  });

  const outputDirectory = path.resolve(process.cwd(), args.outputDir);
  await mkdir(outputDirectory, { recursive: true });

  const csvColumns = [
    "repo",
    "stacks",
    "vendorSignals",
    "dominantVendor",
    "dominantVendorSignals",
    "dominantVendorRatio",
    "singleDependencyRisk",
    "hasExternalServiceInventory",
    "vendorsDetected",
  ];
  const csvLines = [
    csvColumns.join(","),
    ...rows.map((row) => csvColumns.map((column) => csvEscape(row[column])).join(",")),
  ];

  const highRisk = rows.filter((row) => row.singleDependencyRisk === "HIGH");
  const mediumRisk = rows.filter((row) => row.singleDependencyRisk === "MEDIUM");
  const lowRisk = rows.filter((row) => row.singleDependencyRisk === "LOW");

  const mdLines = [
    "# Tech Stack and Vendor Concentration Analysis",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Owner: ${args.owner}`,
    `Repositories scanned: ${rows.length}`,
    "",
    "## Vendor Concentration Risk Summary",
    "",
    `- HIGH: ${highRisk.length}`,
    `- MEDIUM: ${mediumRisk.length}`,
    `- LOW: ${lowRisk.length}`,
    "",
    "## Repositories Requiring Provider Portability Hardening (Top 25)",
    "",
    "| Repository | Stacks | Dominant Vendor | Ratio | Risk | External Inventory |",
    "| --- | --- | --- | ---: | --- | --- |",
    ...rows.slice(0, 25).map(
      (row) =>
        `| ${row.repo} | ${row.stacks} | ${row.dominantVendor} | ${row.dominantVendorRatio} | ${row.singleDependencyRisk} | ${row.hasExternalServiceInventory} |`,
    ),
    "",
    "## Portability Controls to Enforce",
    "",
    "- Define at least one validated secondary provider for each critical external service.",
    "- Maintain cutover runbooks and maximum tolerated downtime targets.",
    "- Add contract and adapter abstractions for provider-specific SDK usage.",
    "- Review legal documents (EULA, ToS, AUP, DPA, FACT, FAST, SLA) quarterly.",
    "",
  ];

  if (errors.length > 0) {
    mdLines.push("## Retrieval Errors");
    mdLines.push("");
    for (const err of errors.slice(0, 100)) {
      mdLines.push(`- ${err}`);
    }
    mdLines.push("");
  }

  const csvPath = path.join(outputDirectory, "repo-tech-stack-vendor-risk.csv");
  const mdPath = path.join(outputDirectory, "repo-tech-stack-vendor-risk.md");
  await writeFile(csvPath, `${csvLines.join("\n")}\n`, "utf8");
  await writeFile(mdPath, `${mdLines.join("\n")}\n`, "utf8");

  console.log(`Wrote ${csvPath}`);
  console.log(`Wrote ${mdPath}`);
  console.log(`HIGH concentration risk repos: ${highRisk.length}`);
  console.log(`MEDIUM concentration risk repos: ${mediumRisk.length}`);
  console.log(`LOW concentration risk repos: ${lowRisk.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
