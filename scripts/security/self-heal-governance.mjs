#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    owner: "",
    limit: 200,
    outputDir: "reports",
    apply: false,
    all: false,
    top: 10,
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
    } else if (token === "--apply") {
      args.apply = true;
    } else if (token === "--all") {
      args.all = true;
    } else if (token.startsWith("--top=")) {
      const parsed = Number.parseInt(token.slice("--top=".length), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        args.top = parsed;
      }
    }
  }

  return args;
}

function runNodeScript(scriptPath, scriptArgs) {
  const result = spawnSync("node", [scriptPath, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    command: `node ${scriptPath} ${scriptArgs.join(" ")}`.trim(),
  };
}

function markdownBlock(label, payload) {
  return [
    `### ${label}`,
    "",
    "```text",
    payload || "(no output)",
    "```",
    "",
  ];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.owner) {
    console.error("Missing required argument: --owner=<github-owner>");
    process.exit(2);
  }

  const auditArgs = [`--owner=${args.owner}`, `--limit=${args.limit}`, `--output-dir=${args.outputDir}`];
  const rolloutArgs = [
    `--owner=${args.owner}`,
    `--limit=${args.limit}`,
    `--output-dir=${args.outputDir}`,
    `--top=${args.top}`,
  ];
  if (args.all) {
    rolloutArgs.push("--all");
  }
  if (args.apply) {
    rolloutArgs.push("--apply");
  }

  const commands = [
    {
      label: "Initial Governance Audit",
      result: runNodeScript("scripts/security/audit-github-repos.mjs", auditArgs),
    },
    {
      label: "Workflow and Action Standardization Audit",
      result: runNodeScript("scripts/security/audit-workflow-actions.mjs", auditArgs),
    },
    {
      label: "Tech Stack and Vendor Concentration Analysis",
      result: runNodeScript("scripts/security/analyze-tech-stack-vendor-risk.mjs", auditArgs),
    },
    {
      label: "Unified Baseline Rollout",
      result: runNodeScript("scripts/security/rollout-unified-baseline.mjs", rolloutArgs),
    },
    {
      label: "Post-Rollout Governance Audit",
      result: runNodeScript("scripts/security/audit-github-repos.mjs", auditArgs),
    },
  ];

  const outputDirectory = path.resolve(process.cwd(), args.outputDir);
  await mkdir(outputDirectory, { recursive: true });

  const summaryLines = [
    "# Governance Self-Heal and Validation Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Owner: ${args.owner}`,
    `Mode: ${args.apply ? "apply" : "plan-only"}`,
    "",
    "## Command Results",
    "",
    "| Step | Exit Code |",
    "| --- | ---: |",
    ...commands.map((entry) => `| ${entry.label} | ${entry.result.status} |`),
    "",
    "## Detailed Output",
    "",
  ];

  for (const entry of commands) {
    summaryLines.push(...markdownBlock(`${entry.label} (stdout)`, entry.result.stdout));
    if (entry.result.stderr) {
      summaryLines.push(...markdownBlock(`${entry.label} (stderr)`, entry.result.stderr));
    }
  }

  const reportPath = path.join(outputDirectory, "governance-self-heal-report.md");
  await writeFile(reportPath, `${summaryLines.join("\n")}\n`, "utf8");
  console.log(`Wrote ${reportPath}`);

  const failing = commands.filter((entry) => entry.result.status !== 0);
  if (failing.length > 0) {
    console.error(
      `Self-heal workflow detected failures in ${failing.length} step(s): ${failing
        .map((step) => step.label)
        .join(", ")}`,
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
