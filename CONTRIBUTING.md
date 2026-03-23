# Contributing to Rebel AI Ventures

## SWE Flow

All contributions follow the Rebel AI SWE Flow:

```
PLAN → BUILD → REVIEW → QA → SHIP → DEPLOY
```

### 1. Plan (`/plan`)
- Create a BRIEF.md with requirements
- Get CEO/Architecture approval

### 2. Build (`/build`)
- Create feature branch: `feature/REBAA-XXX-description`
- Write tests first (TDD)
- Commit atomically

### 3. Review (`/review`)
- Create PR
- Pass all CI checks
- Get code review approval

### 4. QA (`/qa`)
- Run QA tests
- Fix any bugs found
- Get QA approval

### 5. Ship (`/ship`)
- Update CHANGELOG
- Bump version
- Merge to main

### 6. Deploy (`/deploy`)
- Deploy to staging
- Run smoke tests
- Deploy to production

## Commit Message Format

```
type(scope): description [REBAA-XXX]

- Detail 1
- Detail 2
```

Types: feat, fix, refactor, test, docs, chore

## Branch Naming

- `feature/REBAA-XXX-description`
- `fix/REBAA-XXX-description`
- `chore/REBAA-XXX-description`

## Quality Gates

All PRs must pass:
- ✅ Unit tests (>80% coverage)
- ✅ Integration tests
- ✅ Lint & TypeScript
- ✅ Security scan (CodeQL)
- ✅ Secret scan (TruffleHog)
- ✅ Code review (1 approval)
