# norman-ai

Security guardian and threat detection

## Part of Luminous-MastermindAI Ecosystem

## Security and Dependency Governance

This repository now includes proactive security and dependency management controls:

- **Direct dependency CVE scanning** via OSV (`npm run security:cve`)
- **N-0 / N-1 dependency compliance checks** (`npm run security:n-1`)
- **Combined dependency posture checks** (`npm run security:deps`)
- **Cross-repo governance audit** for a GitHub owner (`npm run audit:repos`)
- **Dependabot automation** for npm and GitHub Actions updates
- **GitHub Actions workflows** for recurring security posture validation

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

# Cross-repo control audit (default owner set to Trancendos)
npm run audit:repos
```

### GitHub Workflows Added

- `.github/workflows/security-posture.yml`
  - PR dependency review
  - Direct dependency CVE checks
  - N-0/N-1 enforcement
  - CodeQL analysis
- `.github/workflows/repo-governance-audit.yml`
  - Scheduled/dispatchable multi-repo governance scan
  - Artifact upload for governance reports

## License

MIT © Trancendos
