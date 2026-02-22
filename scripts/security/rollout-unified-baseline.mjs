#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const MANAGED_MARKER = "Managed-by: trancendos-governance-v1";
const DEFAULT_REPORT_PATH = "reports/repo-governance-audit.csv";
const DEFAULT_OUTPUT_DIRECTORY = "reports";

const TEMPLATE_DEFINITIONS = [
  {
    templatePath: "templates/unified-repo-baseline/.github/dependabot.yml",
    targetPath: ".github/dependabot.yml",
  },
  {
    templatePath: "templates/unified-repo-baseline/.github/CODEOWNERS",
    targetPath: ".github/CODEOWNERS",
  },
  {
    templatePath: "templates/unified-repo-baseline/.github/workflows/security-posture.yml",
    targetPath: ".github/workflows/security-posture.yml",
  },
  {
    templatePath: "templates/unified-repo-baseline/.github/workflows/ci-standard.yml",
    targetPath: ".github/workflows/ci-standard.yml",
  },
  {
    templatePath: "templates/unified-repo-baseline/SECURITY.md",
    targetPath: "SECURITY.md",
  },
  {
    templatePath: "templates/unified-repo-baseline/.governance/standards.json",
    targetPath: ".governance/standards.json",
  },
  {
    templatePath: "templates/unified-repo-baseline/.governance/external-services.json",
    targetPath: ".governance/external-services.json",
  },
  {
    templatePath: "templates/unified-repo-baseline/.governance/future-ready-2060.json",
    targetPath: ".governance/future-ready-2060.json",
  },
];

function parseArgs(argv) {
  const args = {
    owner: "",
    limit: 200,
    apply: false,
    all: false,
    top: 10,
    includeForks: false,
    includeArchived: false,
    overwriteManaged: true,
    outputDir: DEFAULT_OUTPUT_DIRECTORY,
    reportPath: DEFAULT_REPORT_PATH,
    strict: false,
    repos: [],
  };

  for (const token of argv) {
    if (token.startsWith("--owner=")) {
      args.owner = token.slice("--owner=".length).trim();
    } else if (token.startsWith("--limit=")) {
      const parsed = Number.parseInt(token.slice("--limit=".length), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        args.limit = parsed;
      }
    } else if (token === "--apply") {
      args.apply = true;
    } else if (token === "--all") {
      args.all = true;
    } else if (token.startsWith("--top=")) {
      const parsed = Number.parseInt(token.slice("--top=".length), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        args.top = parsed;
      }
    } else if (token === "--include-forks") {
      args.includeForks = true;
    } else if (token === "--include-archived") {
      args.includeArchived = true;
    } else if (token === "--no-overwrite-managed") {
      args.overwriteManaged = false;
    } else if (token.startsWith("--output-dir=")) {
      args.outputDir = token.slice("--output-dir=".length).trim();
    } else if (token.startsWith("--report-path=")) {
      args.reportPath = token.slice("--report-path=".length).trim();
    } else if (token.startsWith("--repos=")) {
      args.repos = token
        .slice("--repos=".length)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    } else if (token === "--strict") {
      args.strict = true;
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

function parseCsvRows(content) {
  const rows = [];
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    return rows;
  }
  const headers = splitCsvLine(lines[0]);
  for (let i = 1; i < lines.length; i += 1) {
    const values = splitCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j += 1) {
      row[headers[j]] = values[j] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  values.push(current);
  return values;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function encodePath(pathValue) {
  return pathValue
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function getFile(repoFullName, branch, targetPath) {
  const encodedPath = encodePath(targetPath);
  const endpoint = `repos/${repoFullName}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  const response = runGh(["api", endpoint]);

  if (response.status !== 0) {
    if (/404|Not Found|HTTP 404/i.test(response.stderr)) {
      return { ok: true, exists: false, path: targetPath };
    }
    return {
      ok: false,
      exists: false,
      path: targetPath,
      error: response.stderr || "unable to read file from GitHub API",
    };
  }

  const parsed = parseJsonSafe(response.stdout, null);
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, exists: false, path: targetPath, error: "unable to parse file metadata" };
  }

  const encodedContent = (parsed.content || "").replace(/\n/g, "");
  const decodedContent = Buffer.from(encodedContent, "base64").toString("utf8");
  return {
    ok: true,
    exists: true,
    path: targetPath,
    sha: parsed.sha || "",
    content: decodedContent,
  };
}

function putFile(repoFullName, branch, targetPath, content, sha = "") {
  const encodedPath = encodePath(targetPath);
  const endpoint = `repos/${repoFullName}/contents/${encodedPath}`;
  const message = `chore(governance): standardize ${targetPath}`;
  const encodedContent = Buffer.from(content, "utf8").toString("base64");

  const args = [
    "api",
    "--method",
    "PUT",
    endpoint,
    "-f",
    `message=${message}`,
    "-f",
    `branch=${branch}`,
    "-f",
    `content=${encodedContent}`,
  ];
  if (sha) {
    args.push("-f", `sha=${sha}`);
  }

  return runGh(args);
}

async function loadTemplateContents(rootDirectory) {
  const templates = [];
  for (const definition of TEMPLATE_DEFINITIONS) {
    const absoluteTemplatePath = path.resolve(rootDirectory, definition.templatePath);
    const content = await readFile(absoluteTemplatePath, "utf8");
    templates.push({
      targetPath: definition.targetPath,
      templatePath: definition.templatePath,
      content,
    });
  }
  return templates;
}

async function loadPrioritizedRepos(reportPath, topCount) {
  if (!existsSync(reportPath)) {
    return [];
  }

  const raw = await readFile(reportPath, "utf8");
  const rows = parseCsvRows(raw);
  const highRiskRows = rows.filter((row) => row.risk === "HIGH");
  return highRiskRows.slice(0, topCount).map((row) => row.repo).filter(Boolean);
}

function selectTargetRepos(allRepos, args, prioritizedRepos) {
  if (args.repos.length > 0) {
    const allowed = new Set(args.repos);
    return allRepos.filter((repo) => allowed.has(repo.nameWithOwner));
  }

  if (args.all) {
    return allRepos;
  }

  if (prioritizedRepos.length > 0) {
    const desired = new Set(prioritizedRepos);
    const selected = allRepos.filter((repo) => desired.has(repo.nameWithOwner));
    if (selected.length > 0) {
      return selected;
    }
  }

  return allRepos.slice(0, args.top);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.owner) {
    console.error("Missing required argument: --owner=<github-owner>");
    process.exit(2);
  }

  const ghVersion = runGh(["--version"]);
  if (ghVersion.status !== 0) {
    console.error("GitHub CLI (gh) is required but unavailable.");
    process.exit(2);
  }

  const repoListResponse = runGh([
    "repo",
    "list",
    args.owner,
    "--limit",
    String(args.limit),
    "--json",
    "name,nameWithOwner,defaultBranchRef,isArchived,isFork,isPrivate",
  ]);

  if (repoListResponse.status !== 0) {
    console.error(repoListResponse.stderr || "Unable to list repositories.");
    process.exit(2);
  }

  const repos = parseJsonSafe(repoListResponse.stdout, []);
  if (!Array.isArray(repos) || repos.length === 0) {
    console.error("No repositories available for rollout.");
    process.exit(2);
  }

  const filteredRepos = repos.filter((repo) => {
    if (!args.includeForks && repo.isFork) {
      return false;
    }
    if (!args.includeArchived && repo.isArchived) {
      return false;
    }
    return true;
  });

  const prioritizedRepos = await loadPrioritizedRepos(
    path.resolve(process.cwd(), args.reportPath),
    args.top,
  );
  const targetRepos = selectTargetRepos(filteredRepos, args, prioritizedRepos);
  if (targetRepos.length === 0) {
    console.error("No target repositories selected for rollout.");
    process.exit(2);
  }

  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const templates = await loadTemplateContents(projectRoot);

  const results = [];
  let totalPlannedWrites = 0;
  let totalAppliedWrites = 0;
  let totalFailures = 0;
  let permissionFailures = 0;

  for (const repo of targetRepos) {
    const repoFullName = repo.nameWithOwner;
    const defaultBranch = repo.defaultBranchRef?.name || "main";

    const planned = [];
    const skippedDrift = [];
    const errors = [];

    for (const template of templates) {
      const remoteFile = getFile(repoFullName, defaultBranch, template.targetPath);
      if (!remoteFile.ok) {
        errors.push(`${template.targetPath}: ${remoteFile.error}`);
        continue;
      }

      if (!remoteFile.exists) {
        planned.push({
          mode: "create",
          targetPath: template.targetPath,
          content: template.content,
          sha: "",
        });
        continue;
      }

      if (remoteFile.content === template.content) {
        continue;
      }

      const isManaged = remoteFile.content.includes(MANAGED_MARKER);
      if (args.overwriteManaged && isManaged) {
        planned.push({
          mode: "update-managed",
          targetPath: template.targetPath,
          content: template.content,
          sha: remoteFile.sha || "",
        });
      } else {
        skippedDrift.push(template.targetPath);
      }
    }

    totalPlannedWrites += planned.length;
    let appliedCount = 0;

    if (args.apply) {
      for (const writeItem of planned) {
        const writeResponse = putFile(
          repoFullName,
          defaultBranch,
          writeItem.targetPath,
          writeItem.content,
          writeItem.sha,
        );
        if (writeResponse.status === 0) {
          appliedCount += 1;
        } else {
          totalFailures += 1;
          if (/HTTP 403|Resource not accessible by integration/i.test(writeResponse.stderr || "")) {
            permissionFailures += 1;
          }
          errors.push(`${writeItem.targetPath}: ${writeResponse.stderr || "write failed"}`);
        }
      }
    }

    totalAppliedWrites += appliedCount;
    results.push({
      repo: repoFullName,
      defaultBranch,
      plannedWrites: planned.length,
      appliedWrites: appliedCount,
      skippedDriftCount: skippedDrift.length,
      skippedDrift: skippedDrift.join(";"),
      errors: errors.join(" | "),
    });
  }

  const outputDirectory = path.resolve(process.cwd(), args.outputDir);
  await mkdir(outputDirectory, { recursive: true });

  const csvColumns = [
    "repo",
    "defaultBranch",
    "plannedWrites",
    "appliedWrites",
    "skippedDriftCount",
    "skippedDrift",
    "errors",
  ];
  const csvLines = [
    csvColumns.join(","),
    ...results.map((row) => csvColumns.map((column) => csvEscape(row[column])).join(",")),
  ];

  const mdLines = [
    "# Unified Baseline Rollout Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Owner: ${args.owner}`,
    `Mode: ${args.apply ? "apply" : "plan-only"}`,
    `Target repositories: ${targetRepos.length}`,
    `Planned writes: ${totalPlannedWrites}`,
    `Applied writes: ${totalAppliedWrites}`,
    `Failures: ${totalFailures}`,
    "",
    "| Repo | Planned | Applied | Drift Skipped | Errors |",
    "| --- | ---: | ---: | ---: | --- |",
    ...results.map(
      (row) =>
        `| ${row.repo} | ${row.plannedWrites} | ${row.appliedWrites} | ${row.skippedDriftCount} | ${
          row.errors || "none"
        } |`,
    ),
    "",
    "## Notes",
    "",
    "- Drift-skipped files are existing files that differ from managed templates and do not contain the managed marker.",
    "- Re-run with `--apply` to execute changes. Managed template files are updated automatically unless `--no-overwrite-managed` is set.",
    permissionFailures > 0
      ? "- Permission failures detected. Use a token with write access to target repositories (for example `GH_TOKEN` mapped to an org-wide PAT such as `ORG_GOVERNANCE_TOKEN`)."
      : "- No cross-repository permission failures detected.",
    "",
  ];

  const csvPath = path.join(outputDirectory, "repo-unified-baseline-rollout.csv");
  const mdPath = path.join(outputDirectory, "repo-unified-baseline-rollout.md");
  await writeFile(csvPath, `${csvLines.join("\n")}\n`, "utf8");
  await writeFile(mdPath, `${mdLines.join("\n")}\n`, "utf8");

  console.log(`Wrote ${csvPath}`);
  console.log(`Wrote ${mdPath}`);
  console.log(`Planned writes: ${totalPlannedWrites}`);
  console.log(`Applied writes: ${totalAppliedWrites}`);
  console.log(`Failures: ${totalFailures}`);

  if (args.strict && (totalFailures > 0 || totalPlannedWrites > totalAppliedWrites)) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
