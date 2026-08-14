---
name: pr-review-toolkit
description: "6 parallel reviewer agents for thorough PR review."
version: 1.0.0
author: Hermes Agent (adapted from Anthropic's pr-review-toolkit)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Code-Review, Pull-Requests, Quality, Multi-Agent]
    related_skills: [github-code-review, github-pr-workflow, requesting-code-review]
---

# PR Review Toolkit

Comprehensive pull request review using 6 specialized reviewer agents, each
focusing on a different aspect of code quality. Dispatched in parallel via
`delegate_task` for speed, with results aggregated into a single structured
report.

Adapted from Anthropic's official `pr-review-toolkit` Claude Code plugin, using
Hermes's `delegate_task` for parallel subagent execution instead of Claude
Code's `Task` tool.

## When to use

- After creating a PR — run before requesting review
- Pre-push sanity check on uncommitted/staged changes
- When the user says "review this PR", "check the code", "run a review"
- After implementing a feature — proactive self-review before declaring done
- Before merging — final quality gate

## Review Aspects

| Aspect | Agent | Focus |
|--------|-------|-------|
| `code` | code-reviewer | Adherence to project guidelines (AGENTS.md/CLAUDE.md), style, patterns, best practices |
| `tests` | pr-test-analyzer | Test coverage quality — behavioral vs line, edge cases, gaps |
| `errors` | silent-failure-hunter | Silent failures, swallowed exceptions, inadequate error handling |
| `types` | type-design-analyzer | Type design — encapsulation, invariants, enforcement (rated 1-10) |
| `comments` | comment-analyzer | Comment accuracy, documentation rot, misleading comments |
| `simplify` | code-simplifier | Clarity and maintainability — runs after other reviews pass |

Default: run all applicable aspects. User can specify a subset, e.g.
"review tests and errors only".

## Workflow

### Step 1: Determine review scope

```bash
# Get changed files — staged changes (pre-push) or full diff vs base branch
git diff --staged --name-only          # staged (pre-commit)
git diff main...HEAD --name-only       # full branch diff (pre-PR)
git diff HEAD --name-only              # unstaged changes

# Stat summary to gauge size
git diff main...HEAD --stat

# Check if a PR already exists
gh pr view --json number,title 2>/dev/null || echo "no PR yet"
```

### Step 2: Determine applicable reviews

Based on the changed files:

- **Always applicable**: `code-reviewer` (general quality + project guidelines)
- **If test files changed** (`*Tests.cs`, `*Test.cs`, `test_*.py`, `*.test.ts`): `pr-test-analyzer`
- **If comments/docs added or modified**: `comment-analyzer`
- **If error handling changed** (try/catch, error blocks, fallback logic): `silent-failure-hunter`
- **If types added/modified** (new classes, structs, interfaces, type signatures): `type-design-analyzer`
- **After other reviews pass**: `code-simplifier` (polish)

Quick heuristic to detect applicable reviews:

```bash
# Test files?
git diff main...HEAD --name-only | grep -iE "test|spec" && echo "tests apply"
# Error handling?
git diff main...HEAD | grep -iE "catch|throw|try|except|error|fallback" && echo "errors apply"
# Comments?
git diff main...HEAD | grep -E "^\+.*//|^\+.*///|^\+.*#|^\+.*\* " && echo "comments apply"
# New types?
git diff main...HEAD | grep -E "^\+.*(class|struct|interface|enum|record|type) " && echo "types apply"
```

### Step 3: Gather diff context

```bash
# Full diff for the review — save to a temp file so subagents can read it
git diff main...HEAD > /tmp/pr-review-diff.patch
wc -l /tmp/pr-review-diff.patch

# List of changed files for subagent context
git diff main...HEAD --name-only > /tmp/pr-review-changed-files.txt
cat /tmp/pr-review-changed-files.txt
```

### Step 4: Launch review agents in parallel

Use `delegate_task` with `tasks` array to run all applicable reviewers
simultaneously. Each subagent gets the diff, changed file list, and the
project's convention files (AGENTS.md / CLAUDE.md) as context.

**Important**: `delegate_task` supports up to 3 concurrent subagents. For 6
reviewers, split into 2 batches of 3, or run the most relevant 3 first
(code-reviewer, silent-failure-hunter, pr-test-analyzer) and the rest
(type-design-analyzer, comment-analyzer, code-simplifier) in a second batch.

**Dispatch batch 1 (core reviews):**

```
delegate_task(tasks=[
  {
    goal: "<code-reviewer prompt>",
    context: "<shared context>"
  },
  {
    goal: "<silent-failure-hunter prompt>",
    context: "<shared context>"
  },
  {
    goal: "<pr-test-analyzer prompt>",
    context: "<shared context>"
  }
])
```

**Then dispatch batch 2 (specialized reviews):**

```
delegate_task(tasks=[
  {
    goal: "<type-design-analyzer prompt>",
    context: "<shared context>"
  },
  {
    goal: "<comment-analyzer prompt>",
    context: "<shared context>"
  },
  {
    goal: "<code-simplifier prompt>",
    context: "<shared context>"
  }
])
```

### Step 5: Aggregate results

After all agents return, merge findings into a single report:

1. Collect each agent's findings (Critical / Warning / Suggestion / Positive)
2. Deduplicate across agents (code-reviewer and code-simplifier may overlap)
3. Sort by severity: Critical > Warning > Suggestion > Positive
4. Present the aggregated report

### Step 6: Post to GitHub (optional)

If a PR exists, post the aggregated review as a PR comment or formal review:

```bash
# Summary comment
gh pr comment $PR_NUMBER --body "$(cat /tmp/pr-review-report.md)"

# Or formal review with inline comments
gh pr review $PR_NUMBER --comment --body "$(cat /tmp/pr-review-report.md)"
```

## Agent Prompts

Each agent's full review prompt — pass these as the `goal` in `delegate_task`.
All agents share the same `context` (diff + changed files + project guidelines).

### Shared context (pass to every subagent)

```
You are reviewing a pull request. The diff is at /tmp/pr-review-diff.patch.
The changed files are listed in /tmp/pr-review-changed-files.txt.
The project guidelines are in AGENTS.md (and/or CLAUDE.md) in the repo root.

Read the diff file and the changed source files as needed to provide
a thorough review. Report findings as:

CRITICAL: [file:line] — description
WARNING: [file:line] — description
SUGGESTION: [file:line] — description
POSITIVE: [what was done well]
```

### code-reviewer

```
You are an expert code reviewer. Review the diff against the project's
guidelines (AGENTS.md/CLAUDE.md) with high precision to minimize false
positives. Check for:

- Adherence to project coding style and naming conventions
- Pattern violations (does the new code follow established patterns in the codebase?)
- Potential bugs or logic errors
- Security issues (input validation, secrets, injection)
- Missing error handling or edge cases
- Dead code or unused imports

Focus on the DIFF (changed lines) — don't review unchanged code. For each
finding, cite the file and line number. Minimize false positives: only flag
issues you're confident about.
```

### silent-failure-hunter

```
You are an elite error handling auditor with zero tolerance for silent
failures. Review the diff for:

- Silent failures in catch/except blocks (swallowed errors, empty catch, bare except)
- Inadequate error logging (errors that occur without proper logging or user feedback)
- Inappropriate fallback behavior (falling back to a default that hides a real problem)
- Missing error handling where it should exist (API calls, file I/O, network ops)
- Error states that leave the system in an inconsistent state

For each finding, explain: what error is being suppressed, what the user-
visible impact would be, and what the correct handling should be.
```

### pr-test-analyzer

```
You are an expert test coverage analyst. Review the diff for:

- Behavioral coverage vs line coverage — are the critical code paths tested?
- Missing edge case tests (empty inputs, nulls, boundary conditions, error paths)
- Test quality — are tests readable, maintainable, and not brittle?
- Untested error handling paths that could cause silent failures
- Missing negative test cases for validation logic

Focus on whether the TESTS adequately cover the CHANGES (not on testing the
entire codebase). If no test files changed, flag this as a gap.
```

### comment-analyzer

```
You are a meticulous code comment analyzer. Review the diff for:

- Comment accuracy: do comments match what the code actually does?
- Documentation completeness: are public APIs documented?
- Comment rot: are comments likely to become outdated as code evolves?
- Misleading or outdated comments in changed code
- Comments that restate the code without adding value ("sets the variable")
- Missing comments where non-obvious logic needs explanation

Only review comments in CHANGED lines. For each finding, cite the file, line,
and the specific issue.
```

### type-design-analyzer

```
You are a type design expert. Review any new or modified types in the diff
(classes, structs, interfaces, enums, records, type aliases) for:

- Encapsulation quality (1-10): are internals properly hidden?
- Invariant expression (1-10): are the type's valid states clearly expressed?
- Type usefulness (1-10): does the type earn its existence?
- Enforcement (1-10): are invariants enforced at construction and throughout?

For each new or modified type, provide the 4 ratings with a one-line
justification. Flag types that score below 5 on any axis. If no types were
added or modified, report "No types to review."
```

### code-simplifier

```
You are a code simplification expert. Review the diff for:

- Unnecessary complexity that could be simplified
- Redundant or duplicated code that could be extracted
- Overly verbose solutions where a simpler approach exists
- Code that could be made more readable without changing behavior

Do NOT suggest changes that alter behavior. Focus on clarity and
maintainability of the CHANGED code only. For each suggestion, show the
current code and the simplified version.
```

## Aggregated Report Format

After all agents return, present findings in this structure:

```markdown
## PR Review: [branch name or PR #]

**Reviewed**: N files, +X -Y lines
**Aspects**: code, tests, errors, types, comments, simplify

### 🔴 Critical
- **file.cs:42** — [agent] Description of the issue

### ⚠️ Warnings
- **file.cs:88** — [agent] Description

### 💡 Suggestions
- **file.cs:120** — [agent] Description

### ✅ Positive
- [agent] What was done well

### Type Design Ratings (if applicable)
- `TypeName`: Encapsulation 8/10, Invariants 7/10, Usefulness 9/10, Enforcement 6/10
```

## Prerequisites

- Inside a git repository
- `gh` CLI (optional — only needed for posting reviews to GitHub)
- See `github-auth` skill for GitHub authentication

## Related Skills

- `github-code-review` — single-agent review with inline GitHub comments
- `github-pr-workflow` — PR lifecycle management
- `requesting-code-review` — pre-commit review with security scan
