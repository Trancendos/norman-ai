#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

function getNestedValue(obj, keyPath) {
  return keyPath.split(".").reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), obj);
}

function validateFile(filePath, checks) {
  if (!existsSync(filePath)) {
    return { ok: false, errors: [`Missing required file: ${filePath}`] };
  }

  let data;
  try {
    data = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      errors: [
        `Invalid JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }

  const errors = [];
  for (const check of checks) {
    const value = getNestedValue(data, check.path);
    if (value === undefined || value === null) {
      errors.push(`${filePath}: missing ${check.path}`);
      continue;
    }
    const actualType = Array.isArray(value) ? "array" : typeof value;
    if (check.type && actualType !== check.type) {
      errors.push(`${filePath}: ${check.path} must be ${check.type}`);
      continue;
    }
    if (check.type === "string" && check.nonEmpty && String(value).trim().length === 0) {
      errors.push(`${filePath}: ${check.path} must be non-empty`);
    }
    if (check.type === "array" && check.minItems !== undefined && Array.isArray(value) && value.length < check.minItems) {
      errors.push(`${filePath}: ${check.path} must contain at least ${check.minItems} entries`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function readJson(filePath) {
  return readFile(filePath, "utf8").then((raw) => JSON.parse(raw));
}

async function main() {
  const root = process.cwd();
  const standardsPath = path.join(root, ".governance/standards.json");
  const servicesPath = path.join(root, ".governance/external-services.json");
  const futurePath = path.join(root, ".governance/future-ready-2060.json");

  const validations = [
    validateFile(standardsPath, [
      { path: "managedBy", type: "string", nonEmpty: true },
      { path: "schemaVersion", type: "string", nonEmpty: true },
      { path: "repositoryType", type: "string", nonEmpty: true },
      { path: "lifecycleCoverage.built", type: "boolean" },
      { path: "lifecycleCoverage.implemented", type: "boolean" },
      { path: "lifecycleCoverage.designed", type: "boolean" },
      { path: "lifecycleCoverage.discovered", type: "boolean" },
      { path: "lifecycleCoverage.maintained", type: "boolean" },
      { path: "standards.modularDesign", type: "object" },
      { path: "standards.fluidicDynamicEnvironment", type: "object" },
      { path: "standards.adaptiveUxUi", type: "object" },
      { path: "standards.selfLearningLivingDocumentation", type: "object" },
      { path: "standards.zeroCostOptimization", type: "object" },
      { path: "standards.legalEthicalGlobalCompliance", type: "object" },
    ]),
    validateFile(servicesPath, [
      { path: "managedBy", type: "string", nonEmpty: true },
      { path: "schemaVersion", type: "string", nonEmpty: true },
      { path: "reviewCadenceDays", type: "number" },
      { path: "services", type: "array", minItems: 1 },
    ]),
    validateFile(futurePath, [
      { path: "managedBy", type: "string", nonEmpty: true },
      { path: "schemaVersion", type: "string", nonEmpty: true },
      { path: "visionHorizon", type: "number" },
      { path: "principles", type: "array", minItems: 3 },
      { path: "capabilityTargets.shortTerm_12Months", type: "array", minItems: 1 },
      { path: "capabilityTargets.midTerm_3Years", type: "array", minItems: 1 },
      { path: "capabilityTargets.longTerm_2060", type: "array", minItems: 1 },
      { path: "annualReview.required", type: "boolean" },
      { path: "annualReview.ownerRole", type: "string", nonEmpty: true },
      { path: "annualReview.nextReviewUtc", type: "string", nonEmpty: true },
    ]),
  ];

  const errors = validations.flatMap((result) => result.errors);
  if (errors.length > 0) {
    for (const err of errors) {
      console.error(err);
    }
    process.exit(1);
  }

  const services = await readJson(servicesPath);
  const unresolvedAlternatives = (services.services || [])
    .filter((service) => Array.isArray(service?.resilience?.alternativeProviders))
    .filter((service) => service.resilience.alternativeProviders.length === 0)
    .map((service) => service.name);

  if (unresolvedAlternatives.length > 0) {
    console.error(
      `Services missing alternative providers: ${unresolvedAlternatives.join(", ")}`,
    );
    process.exit(1);
  }

  console.log("Governance documents validation passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
