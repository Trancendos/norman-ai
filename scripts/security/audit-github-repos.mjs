#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    owner: "",
    limit: 100,
    outputDir: "reports",
    strict: false,
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
    } else if (token === "--strict") {
      args.strict = true;
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

function buildContentsEndpoint(repoFullName, dirPath, ref) {
  const encodedRef = encodeURIComponent(ref);
  if (!dirPath) {
    return `repos/${repoFullName}/contents?ref=${encodedRef}`;
  }
  const encodedPath = dirPath
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `repos/${repoFullName}/contents/${encodedPath}?ref=${encodedRef}`;
}

function listDir(repoFullName, ref, dirPath = "") {
  const endpoint = buildContentsEndpoint(repoFullName, dirPath, ref);
  const response = runGh(["api", endpoint]);
  if (response.status !== 0) {
    const notFound = /404|Not Found|HTTP 404/i.test(response.stderr);
    if (notFound) {
      return { ok: true, entries: [] };
    }
    return { ok: false, entries: [], error: response.stderr || "gh api request failed" };
  }

  const parsed = parseJsonSafe(response.stdout, []);
  if (Array.isArray(parsed)) {
    return { ok: true, entries: parsed };
  }
  if (parsed && typeof parsed === "object") {
    return { ok: true, entries: [parsed] };
  }

  return { ok: false, entries: [], error: "unable to parse directory listing" };
}

function hasAnyName(entries, expectedNames) {
  const names = new Set(entries.map((item) => item?.name).filter(Boolean));
  return expectedNames.some((name) => names.has(name));
}

function detectManifest(entries) {
  const manifestNames = [
    "package.json",
    "requirements.txt",
    "pyproject.toml",
    "Pipfile",
    "go.mod",
    "Cargo.toml",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "Gemfile",
    "composer.json",
  ];
  return hasAnyName(entries, manifestNames);
}

function classifyRepoType(repoName) {
  const normalized = repoName.toLowerCase();
  if (normalized.includes("ecosystem") || normalized.includes("nexus") || normalized.includes("plexus")) {
    return "integration-hub";
  }
  if (normalized.endsWith("-ai") || normalized.startsWith("the-")) {
    return "service-module";
  }
  return "general";
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function riskTier(score) {
  if (score >= 6) {
    return "LOW";
  }
  if (score >= 4) {
    return "MEDIUM";
  }
  return "HIGH";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.owner) {
    console.error("Missing --owner=<github-owner> argument.");
    process.exit(2);
  }

  const ghVersion = runGh(["--version"]);
  if (ghVersion.status !== 0) {
    console.error("GitHub CLI (gh) is required but not available.");
    process.exit(2);
  }

  const repoListResponse = runGh([
    "repo",
    "list",
    args.owner,
    "--limit",
    String(args.limit),
    "--json",
    "name,nameWithOwner,defaultBranchRef,isArchived,isFork,isPrivate,updatedAt",
  ]);

  if (repoListResponse.status !== 0) {
    console.error(repoListResponse.stderr || "Unable to list repositories.");
    process.exit(2);
  }

  const listedRepos = parseJsonSafe(repoListResponse.stdout, []);
  if (!Array.isArray(listedRepos) || listedRepos.length === 0) {
    console.error("No repositories returned for audit.");
    process.exit(2);
  }

  const filteredRepos = listedRepos.filter((repo) => {
    if (!args.includeForks && repo.isFork) {
      return false;
    }
    if (!args.includeArchived && repo.isArchived) {
      return false;
    }
    return true;
  });

  const records = [];
  const errors = [];

  for (const repo of filteredRepos) {
    const repoFullName = repo.nameWithOwner;
    const defaultBranch = repo.defaultBranchRef?.name || "main";

    const root = listDir(repoFullName, defaultBranch, "");
    const githubDir = listDir(repoFullName, defaultBranch, ".github");
    let workflows = { ok: true, entries: [] };

    if (githubDir.ok && hasAnyName(githubDir.entries, ["workflows"])) {
      workflows = listDir(repoFullName, defaultBranch, ".github/workflows");
    }

    const repoErrors = [root, githubDir, workflows]
      .filter((item) => !item.ok)
      .map((item) => item.error)
      .filter(Boolean);
    if (repoErrors.length > 0) {
      errors.push({ repo: repoFullName, errors: repoErrors });
    }

    const workflowNames = workflows.entries.map((item) => item?.name || "").filter(Boolean);

    const hasDependabot = hasAnyName(githubDir.entries, ["dependabot.yml"]);
    const hasSecurityPolicy =
      hasAnyName(root.entries, ["SECURITY.md"]) || hasAnyName(githubDir.entries, ["SECURITY.md"]);
    const hasCodeowners =
      hasAnyName(root.entries, ["CODEOWNERS"]) || hasAnyName(githubDir.entries, ["CODEOWNERS"]);
    const hasSecurityWorkflow = workflowNames.some((name) =>
      /(security|codeql|vuln|cve|sast|osv)/i.test(name),
    );
    const hasCiWorkflow = workflowNames.some((name) => /(ci|test|build|lint|release)/i.test(name));
    const hasManifest = detectManifest(root.entries);
    const hasReadme = hasAnyName(root.entries, ["README.md"]);

    const controls = {
      hasDependabot,
      hasSecurityPolicy,
      hasCodeowners,
      hasSecurityWorkflow,
      hasCiWorkflow,
      hasManifest,
      hasReadme,
    };

    const score = Object.values(controls).filter(Boolean).length;
    const missingControls = Object.entries(controls)
      .filter(([, present]) => !present)
      .map(([controlName]) => controlName);

    records.push({
      repo: repoFullName,
      defaultBranch,
      isPrivate: Boolean(repo.isPrivate),
      updatedAt: repo.updatedAt || "",
      repoType: classifyRepoType(repo.name || ""),
      score,
      risk: riskTier(score),
      missingControls: missingControls.join(";"),
      ...controls,
    });
  }

  records.sort((a, b) => {
    if (a.risk !== b.risk) {
      const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return order[a.risk] - order[b.risk];
    }
    return a.score - b.score;
  });

  const outputDirectory = path.resolve(process.cwd(), args.outputDir);
  await mkdir(outputDirectory, { recursive: true });

  const csvColumns = [
    "repo",
    "defaultBranch",
    "isPrivate",
    "updatedAt",
    "repoType",
    "score",
    "risk",
    "hasDependabot",
    "hasSecurityPolicy",
    "hasCodeowners",
    "hasSecurityWorkflow",
    "hasCiWorkflow",
    "hasManifest",
    "hasReadme",
    "missingControls",
  ];

  const csvLines = [
    csvColumns.join(","),
    ...records.map((record) =>
      csvColumns.map((column) => csvEscape(record[column])).join(","),
    ),
  ];

  const highRisk = records.filter((record) => record.risk === "HIGH");
  const mediumRisk = records.filter((record) => record.risk === "MEDIUM");
  const lowRisk = records.filter((record) => record.risk === "LOW");

  const summaryMd = [
    "# Repository Governance Audit",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Owner: ${args.owner}`,
    `Repos scanned: ${records.length}`,
    "",
    "## Risk Summary",
    "",
    `- HIGH: ${highRisk.length}`,
    `- MEDIUM: ${mediumRisk.length}`,
    `- LOW: ${lowRisk.length}`,
    "",
    "## Highest Priority Repositories (Top 20)",
    "",
    "| Repo | Risk | Score | Missing Controls |",
    "| --- | --- | --- | --- |",
    ...records.slice(0, 20).map(
      (record) =>
        `| ${record.repo} | ${record.risk} | ${record.score}/7 | ${record.missingControls || "none"} |`,
    ),
    "",
    "## Control Definitions",
    "",
    "- hasDependabot: `.github/dependabot.yml` exists",
    "- hasSecurityPolicy: `SECURITY.md` exists (root or .github)",
    "- hasCodeowners: `CODEOWNERS` exists (root or .github)",
    "- hasSecurityWorkflow: workflow filename indicates security scanning",
    "- hasCiWorkflow: workflow filename indicates CI validation",
    "- hasManifest: common package/application manifest exists",
    "- hasReadme: `README.md` exists",
    "",
  ];

  if (errors.length > 0) {
    summaryMd.push("## Audit Retrieval Errors");
    summaryMd.push("");
    for (const err of errors.slice(0, 50)) {
      summaryMd.push(`- ${err.repo}: ${err.errors.join(" | ")}`);
    }
    summaryMd.push("");
  }

  const csvPath = path.join(outputDirectory, "repo-governance-audit.csv");
  const mdPath = path.join(outputDirectory, "repo-governance-audit.md");
  await writeFile(csvPath, `${csvLines.join("\n")}\n`, "utf8");
  await writeFile(mdPath, `${summaryMd.join("\n")}\n`, "utf8");

  console.log(`Wrote ${csvPath}`);
  console.log(`Wrote ${mdPath}`);
  console.log(`HIGH risk repos: ${highRisk.length}`);
  console.log(`MEDIUM risk repos: ${mediumRisk.length}`);
  console.log(`LOW risk repos: ${lowRisk.length}`);

  if (args.strict && highRisk.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
