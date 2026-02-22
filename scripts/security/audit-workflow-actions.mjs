#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const MANAGED_MARKER = "Managed-by: trancendos-governance-v1";
const LEGACY_ACTION_PATTERNS = [
  /^actions\/checkout@v[1-3]$/i,
  /^actions\/setup-node@v[1-3]$/i,
  /^actions\/upload-artifact@v[1-3]$/i,
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

function listDir(repoFullName, ref, dirPath) {
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
    return {
      ok: false,
      entries: [],
      error: response.stderr || "unable to list directory",
    };
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
    return { ok: false, exists: false, content: "", error: "unable to parse file payload" };
  }
  const decoded = Buffer.from((parsed.content || "").replace(/\n/g, ""), "base64").toString("utf8");
  return { ok: true, exists: true, content: decoded };
}

function extractActions(workflowContent) {
  const matches = [];
  const regex = /^\s*uses:\s*([^\s#]+)\s*$/gm;
  let found = regex.exec(workflowContent);
  while (found) {
    matches.push(found[1]);
    found = regex.exec(workflowContent);
  }
  return matches;
}

function isPinnedToSha(actionUse) {
  const ref = actionUse.split("@")[1] || "";
  return /^[0-9a-f]{40}$/i.test(ref);
}

function isLegacyAction(actionUse) {
  return LEGACY_ACTION_PATTERNS.some((pattern) => pattern.test(actionUse));
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

  const repoResponse = runGh([
    "repo",
    "list",
    args.owner,
    "--limit",
    String(args.limit),
    "--json",
    "nameWithOwner,defaultBranchRef,isFork,isArchived",
  ]);
  if (repoResponse.status !== 0) {
    console.error(repoResponse.stderr || "Unable to list repositories.");
    process.exit(2);
  }

  const allRepos = parseJsonSafe(repoResponse.stdout, []);
  if (!Array.isArray(allRepos) || allRepos.length === 0) {
    console.error("No repositories returned.");
    process.exit(2);
  }

  const repos = allRepos.filter((repo) => {
    if (!args.includeForks && repo.isFork) {
      return false;
    }
    if (!args.includeArchived && repo.isArchived) {
      return false;
    }
    return true;
  });

  const actionUsage = new Map();
  const repoRows = [];
  const errors = [];

  let totalWorkflows = 0;
  let totalActions = 0;
  let totalUnpinned = 0;
  let totalLegacy = 0;
  let managedTemplateWorkflows = 0;

  for (const repo of repos) {
    const repoFullName = repo.nameWithOwner;
    const branch = repo.defaultBranchRef?.name || "main";

    const workflowsDir = listDir(repoFullName, branch, ".github/workflows");
    if (!workflowsDir.ok) {
      errors.push(`${repoFullName}: ${workflowsDir.error}`);
      continue;
    }

    const workflowEntries = workflowsDir.entries.filter((entry) =>
      /\.(ya?ml)$/i.test(entry?.name || ""),
    );

    let repoActionCount = 0;
    let repoUnpinnedCount = 0;
    let repoLegacyCount = 0;
    let repoManagedTemplateCount = 0;
    const repoActionSet = new Set();

    for (const entry of workflowEntries) {
      const workflowPath = `.github/workflows/${entry.name}`;
      const workflowFile = fetchFile(repoFullName, branch, workflowPath);
      if (!workflowFile.ok || !workflowFile.exists) {
        if (!workflowFile.ok) {
          errors.push(`${repoFullName}:${workflowPath}: ${workflowFile.error}`);
        }
        continue;
      }

      if (workflowFile.content.includes(MANAGED_MARKER)) {
        repoManagedTemplateCount += 1;
      }

      const actions = extractActions(workflowFile.content);
      for (const action of actions) {
        repoActionCount += 1;
        repoActionSet.add(action);
        if (!isPinnedToSha(action)) {
          repoUnpinnedCount += 1;
        }
        if (isLegacyAction(action)) {
          repoLegacyCount += 1;
        }

        if (!actionUsage.has(action)) {
          actionUsage.set(action, { count: 0, repos: new Set(), pinnedBySha: 0 });
        }
        const usage = actionUsage.get(action);
        usage.count += 1;
        usage.repos.add(repoFullName);
        if (isPinnedToSha(action)) {
          usage.pinnedBySha += 1;
        }
      }
    }

    totalWorkflows += workflowEntries.length;
    totalActions += repoActionCount;
    totalUnpinned += repoUnpinnedCount;
    totalLegacy += repoLegacyCount;
    managedTemplateWorkflows += repoManagedTemplateCount;

    repoRows.push({
      repo: repoFullName,
      workflowCount: workflowEntries.length,
      distinctActions: repoActionSet.size,
      actionInvocations: repoActionCount,
      unpinnedActions: repoUnpinnedCount,
      legacyActions: repoLegacyCount,
      managedTemplateWorkflows: repoManagedTemplateCount,
    });
  }

  repoRows.sort((a, b) => {
    if (b.unpinnedActions !== a.unpinnedActions) {
      return b.unpinnedActions - a.unpinnedActions;
    }
    return b.actionInvocations - a.actionInvocations;
  });

  const actionRows = [...actionUsage.entries()].map(([action, usage]) => ({
    action,
    invocations: usage.count,
    repoCount: usage.repos.size,
    pinnedBySha: usage.pinnedBySha,
  }));
  actionRows.sort((a, b) => b.invocations - a.invocations);

  const outputDirectory = path.resolve(process.cwd(), args.outputDir);
  await mkdir(outputDirectory, { recursive: true });

  const repoCsvColumns = [
    "repo",
    "workflowCount",
    "distinctActions",
    "actionInvocations",
    "unpinnedActions",
    "legacyActions",
    "managedTemplateWorkflows",
  ];
  const repoCsvLines = [
    repoCsvColumns.join(","),
    ...repoRows.map((row) => repoCsvColumns.map((col) => csvEscape(row[col])).join(",")),
  ];

  const actionCsvColumns = ["action", "invocations", "repoCount", "pinnedBySha"];
  const actionCsvLines = [
    actionCsvColumns.join(","),
    ...actionRows.map((row) => actionCsvColumns.map((col) => csvEscape(row[col])).join(",")),
  ];

  const summaryMd = [
    "# Workflow and Action Standardization Audit",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Owner: ${args.owner}`,
    `Repositories scanned: ${repos.length}`,
    `Total workflows: ${totalWorkflows}`,
    `Total action invocations: ${totalActions}`,
    `Total unpinned action invocations: ${totalUnpinned}`,
    `Total legacy action invocations: ${totalLegacy}`,
    `Managed template workflows detected: ${managedTemplateWorkflows}`,
    "",
    "## Top 25 Most Used Actions",
    "",
    "| Action | Invocations | Repositories | Pinned by SHA |",
    "| --- | ---: | ---: | ---: |",
    ...actionRows
      .slice(0, 25)
      .map((row) => `| ${row.action} | ${row.invocations} | ${row.repoCount} | ${row.pinnedBySha} |`),
    "",
    "## Repositories With Highest Workflow Drift Pressure",
    "",
    "| Repository | Workflows | Invocations | Unpinned | Legacy | Managed Templates |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...repoRows
      .slice(0, 25)
      .map(
        (row) =>
          `| ${row.repo} | ${row.workflowCount} | ${row.actionInvocations} | ${row.unpinnedActions} | ${row.legacyActions} | ${row.managedTemplateWorkflows} |`,
      ),
    "",
  ];

  if (errors.length > 0) {
    summaryMd.push("## Retrieval Errors");
    summaryMd.push("");
    for (const err of errors.slice(0, 100)) {
      summaryMd.push(`- ${err}`);
    }
    summaryMd.push("");
  }

  const repoCsvPath = path.join(outputDirectory, "repo-workflow-action-audit.csv");
  const actionCsvPath = path.join(outputDirectory, "action-usage-inventory.csv");
  const mdPath = path.join(outputDirectory, "workflow-action-standardization-audit.md");
  await writeFile(repoCsvPath, `${repoCsvLines.join("\n")}\n`, "utf8");
  await writeFile(actionCsvPath, `${actionCsvLines.join("\n")}\n`, "utf8");
  await writeFile(mdPath, `${summaryMd.join("\n")}\n`, "utf8");

  console.log(`Wrote ${repoCsvPath}`);
  console.log(`Wrote ${actionCsvPath}`);
  console.log(`Wrote ${mdPath}`);
  console.log(`Unpinned action invocations: ${totalUnpinned}`);
  console.log(`Legacy action invocations: ${totalLegacy}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
