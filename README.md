# norman-ai

Security guardian and threat detection

## Part of Luminous-MastermindAI Ecosystem

## Security and Dependency Governance

This repository now includes proactive security and dependency management controls:

- **Direct dependency CVE scanning** via OSV (`npm run security:cve`)
- **N-0 / N-1 dependency compliance checks** (`npm run security:n-1`)
- **Combined dependency posture checks** (`npm run security:deps`)
- **Cross-repo governance audit** for a GitHub owner (`npm run audit:repos`)
- **Workflow/action inventory and drift analysis** (`npm run audit:workflows`)
- **Tech-stack and vendor concentration analysis** (`npm run audit:vendors`)
- **Unified baseline rollout engine** (`npm run governance:unify`, `npm run governance:unify:apply`)
- **Governance self-heal orchestration** (`npm run governance:self-heal`)
- **Dependabot automation** for npm and GitHub Actions updates
- **Managed templates and schemas** for standards, legal compliance, and 2060 readiness
- **GitHub Actions workflows** for recurring audit and self-healing validation

### N-0 / N-1 Policy

- **N-0**: dependency is on the latest major release
- **N-1**: dependency is one major behind latest
- Anything older than N-1 is **non-compliant** and fails the policy check

Internal or workspace dependencies (for example `workspace:*`) are excluded from public registry checks and must be governed in their source repository.

## Installation

```bash
pnpm install
```

## Development

```bash
pnpm dev
```

## Security/Compliance Commands

```bash
# Direct CVE scan using resolved dependency versions
npm run security:cve

# N-0/N-1 compliance analysis
npm run security:n-1

# Full dependency posture checks
npm run security:deps

# Validate local governance standards documents
npm run governance:validate-docs

# Cross-repo control audit
npm run audit:repos

# Cross-repo workflow/action analysis
npm run audit:workflows

# Cross-repo tech-stack and vendor concentration analysis
npm run audit:vendors

# Plan baseline rollout for high-risk repositories
npm run governance:unify

# Apply baseline rollout to all repositories
npm run governance:unify:apply

# End-to-end self-heal and validation cycle
npm run governance:self-heal
```

For cross-repository write operations (`governance:unify:apply`), ensure `GH_TOKEN` has write access to target repositories (for example an org-scoped PAT in `ORG_GOVERNANCE_TOKEN`).

### GitHub Workflows Added

- `.github/workflows/security-posture.yml`
  - PR dependency review
  - Baseline file validation
  - Local dependency and governance checks (when scripts are present)
- `.github/workflows/ci-standard.yml`
  - Required baseline governance file checks
- `.github/workflows/repo-governance-audit.yml`
  - Scheduled/dispatchable multi-repo governance, workflow, and vendor scans
  - Artifact upload for all generated reports
- `.github/workflows/governance-self-heal.yml`
  - Scheduled dry-run self-heal cycle
  - Optional dispatch mode to apply baseline controls across repositories

## License

MIT © Trancendos
