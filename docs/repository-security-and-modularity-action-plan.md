# Repository Security, Dependency, and Modularity Program

## Scope and Context

This repository (`Trancendos/norman-ai`) now contains tooling to:

1. Enforce CVE checks on direct dependencies.
2. Enforce dependency freshness against an **N-0 / N-1** policy.
3. Audit GitHub repositories for baseline governance and security controls.
4. Produce a repeatable path for modular architecture governance.

Because only one repository is checked out locally in this environment, deep code-level analysis is performed here, while cross-repo analysis is automated through the `audit-github-repos` script against the GitHub owner.

## Deep Findings for This Repository (Before vs After)

### Previously Missing

- No automated CVE checks.
- No dependency freshness/N-1 policy checks.
- No Dependabot configuration.
- No scheduled security workflow.
- No cross-repo governance visibility process.

### Implemented in This Iteration

- `scripts/security/check-cves.mjs` (OSV-based direct dependency CVE scanning).
- `scripts/security/check-n-minus-one.mjs` (N-0 / N-1 compliance enforcement).
- `scripts/security/audit-github-repos.mjs` (cross-repo governance baseline scan).
- `scripts/security/audit-workflow-actions.mjs` (cross-repo workflow/action inventory + drift scan).
- `scripts/security/analyze-tech-stack-vendor-risk.mjs` (cross-repo stack and provider concentration analysis).
- `scripts/security/rollout-unified-baseline.mjs` (managed baseline rollout and remediation engine).
- `scripts/security/self-heal-governance.mjs` (audit -> remediate -> re-audit orchestration).
- `scripts/security/validate-governance-documents.mjs` (local governance document validation).
- `.github/dependabot.yml` (proactive dependency update management).
- `.github/workflows/security-posture.yml` (dependency review + baseline governance and local security checks).
- `.github/workflows/repo-governance-audit.yml` (scheduled owner-wide governance audit).
- `.github/workflows/governance-self-heal.yml` (scheduled/dispatchable self-heal pipeline).
- README updates and operational guidance.

## Repository Control Baseline (Required for Every Active App/Service Repo)

Each active repository should meet this baseline:

1. `README.md` with architecture boundaries and integration contracts.
2. `SECURITY.md` with vulnerability disclosure path.
3. `CODEOWNERS` for change accountability.
4. `.github/dependabot.yml` enabled.
5. At least one CI workflow (`test/build/lint`) and one security workflow (`codeql/cve/dependency`).
6. Dependency policy checks for N-0/N-1.
7. SBOM generation and artifact retention (recommended next step).

## Cross-Repo Gap Analysis Method

Run:

```bash
npm run audit:repos
```

Outputs:

- `reports/repo-governance-audit.csv`
- `reports/repo-governance-audit.md`
- `reports/repo-workflow-action-audit.csv`
- `reports/action-usage-inventory.csv`
- `reports/workflow-action-standardization-audit.md`
- `reports/repo-tech-stack-vendor-risk.csv`
- `reports/repo-tech-stack-vendor-risk.md`

These reports identify missing controls per repository and classify risk (`HIGH`, `MEDIUM`, `LOW`) by control coverage score.

### Current Baseline Snapshot (from latest audit run)

- Repos scanned: **43**
- HIGH risk: **41**
- MEDIUM risk: **0**
- LOW risk: **2** (`trancendos-ecosystem`, `secrets-portal`)
- Note: snapshot evaluates each repo's **default branch** at scan time; repositories improved on feature branches will remain HIGH until merged.

Most repositories currently have README + manifest files but are missing:

- Dependabot configuration
- SECURITY policy
- CODEOWNERS
- Security workflow
- CI workflow

This indicates a broad governance standardization gap rather than isolated failures.

### Highest Priority Remediation Wave (First 10)

1. `the-workshop`
2. `the-void`
3. `the-treasury`
4. `the-sanctuary`
5. `the-observatory`
6. `the-nexus`
7. `the-lighthouse`
8. `the-library`
9. `the-ice-box`
10. `the-hive`

## Modularity and Repo Boundaries Review

### Decision Framework: Merge vs Separate

Keep repos **separate** when:

- They represent independent deployable services.
- They have distinct security boundaries.
- They are consumed through clear API or event contracts.
- They require independent release cadence.

Consider **merging** when:

- Two repos are always released/deployed together.
- Shared code exceeds service-specific code and causes circular dependencies.
- Integration contract is undocumented and effectively internal.

### Current Recommendation

- Keep `norman-ai` as a separate service module.
- Enforce integration through shared contracts (for example via `shared-core` versioned interfaces).
- Avoid cross-repo ad-hoc imports; use package releases and explicit version constraints.
- Keep integration hubs (`central-plexus`, `the-nexus`, `trancendos-ecosystem`) focused on orchestration/contracts, not business logic accumulation.
- If a service has no independent deployment/release need and duplicates domain ownership, merge it into its owning bounded context.

## Program Requirements by Repo Type

### Service Module Repos (for example `*-ai`, `the-*`)

- Security posture workflow
- Dependabot
- N-0/N-1 checks
- Unit/integration tests
- API/event contract documentation

### Integration Hub Repos (for example `central-plexus`, `the-nexus`, `*ecosystem*`)

- Contract tests between services
- Version compatibility matrix
- Backward compatibility gates
- Strict release notes and change impact matrix

### Shared Library Repos (for example `shared-core`)

- Semantic versioning discipline
- Breaking-change detection and migration notes
- Consumer impact analysis across dependent repos

## Grand Timeline (12-Week Program)

### Phase 0 (Week 0-1): Immediate Risk Reduction

- [x] Enable CVE scanning and dependency freshness checks in this repo.
- [x] Enable Dependabot in this repo.
- [x] Add owner-wide governance audit automation.
- [ ] Roll out baseline controls to top 10 highest-risk repos.

### Phase 1 (Week 2-4): Baseline Standardization

- [ ] Add `SECURITY.md` + `CODEOWNERS` to all active repos.
- [ ] Add security posture workflow to all production-impact repos.
- [ ] Enforce N-0/N-1 policy checks org-wide.
- [ ] Add branch protection rules for required checks.

### Phase 2 (Week 5-8): Modular Architecture Correction

- [ ] Map every repo to a bounded context (service, integration, shared-lib, platform).
- [ ] Define and document inter-repo contracts.
- [ ] Remove direct cross-repo code coupling patterns.
- [ ] Decide merge/separate actions using the framework above.

### Phase 3 (Week 9-12): Continuous Assurance

- [ ] Add SBOM generation and retention.
- [ ] Add scheduled compliance scorecard reporting.
- [ ] Set quarterly architecture and dependency drift reviews.
- [ ] Track MTTR for vulnerability remediation.

## Completion Review Matrix

| Workstream | Status | Evidence |
| --- | --- | --- |
| CVE checker setup | Completed (this repo) | `scripts/security/check-cves.mjs`, `security-posture.yml` |
| Dependency analysis + N-0/N-1 enforcement | Completed (this repo) | `scripts/security/check-n-minus-one.mjs` |
| Proactive dependency management | Completed (this repo) | `.github/dependabot.yml` |
| Cross-repo gap detection | Completed (automation) | `scripts/security/audit-github-repos.mjs` |
| Workflow/action unification analytics | Completed (automation) | `scripts/security/audit-workflow-actions.mjs` |
| Tech stack and supplier concentration analytics | Completed (automation) | `scripts/security/analyze-tech-stack-vendor-risk.mjs` |
| Cross-repo remediation rollout | In progress | `scripts/security/rollout-unified-baseline.mjs` + rollout reports |
| Merge/separate architecture decisions | Pending | Requires boundary mapping + dependency graph per repo |

