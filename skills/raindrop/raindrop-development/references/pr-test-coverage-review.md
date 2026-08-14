# PR Test-Coverage Review Technique (Raindrop / C# CAD plugins)

A reusable technique for reviewing whether the **tests** adequately cover the
**changes** in a PR — *not* an audit of the whole codebase's test coverage.
Exercised on the `fix/active-singleton-drift-drawing-switch` branch
(Jul 30, 2026): 6 source files changed, 0 test files changed, ~50 test files
in the project, none referencing any changed method.

## When this technique applies

- Reviewing a Raindrop PR (or any C# CAD-plugin PR) where the changed code is
  CAD-runtime/Document-Database threading, transaction, XData, or lock code.
- The test project (`src/RaindropTests/`) has **no mocking framework** — only
  NUnit + coverlet, references the main project directly. Existing tests cover
  *pure-logic* code (geometry engines, settings nav, MLeaderStyle value
  equality, catalog row parsing). The CAD-interop layer is untested by design.

## The assessment pipeline

1. **Diff the changed-files list.** `read_file` the diff patch and the
   changed-files list. If **no test files (`*Tests.cs`) appear in the
   changed-files list**, that is the first finding: behavioral changes landed
   with zero test updates. AGENTS.md says "Include test updates when changing
   behavior" — flag the violation.
2. **Confirm no existing test covers the changed methods.** `grep -rn` for
   each changed method name across `src/RaindropTests/`. If zero hits, the
   changed code paths are completely unverified by any test. (Use `terminal`
   with `grep`, not `search_files` — see the Windows-path pitfall in the
   main SKILL.md.)
3. **Inspect the test infrastructure.** Check the test csproj for mocking
   packages (Moq / NSubstitute / FakeItEasy). If none, record that the
   practical test ceiling is "pure-logic only" — CAD-interop code cannot be
   unit-tested without a test harness / fake Database/Document, which the
   project does not have. This shapes *what* you recommend, not *whether* you
   flag the gap.
4. **Map each changed method to its testable surface.** For each change:
   - Is there a pure-logic predicate that could be extracted and tested?
     (e.g. `IsIrrigationDrawing(doc)` → entity-presence scan → `count > 0`
     — the scan is in `EditorSelection.GetFromModelSpace(db, ...)` which is
     already the right testable shape if a test Database were feasible.)
   - Are there null/edge paths that are testable *without* CAD?
     (e.g. `Active.GetDocument(null)` → returns null; `SaveToDrawing(null)`
     → does it tolerate null? These are safety hinges.)
   - Is the change a delegation contract (parameterless → `Active.*` →
     explicit overload)? A test verifying the two paths stay synchronized
     is valuable even if it needs a minimal Document.

## Report format

Emit findings in the 4-tier format the review task specifies:

- **CRITICAL** — behavioral change with zero tests; invariant the fix
  introduces is unverified.
- **WARNING** — untested error/edge paths that could cause silent failures
  (null-document, missing lock, overload desync, indentation artifacts
  hinting at mechanical refactor).
- **SUGGESTION** — testable extractions, delegation-contract tests,
  pure-helper candidates.
- **POSITIVE** — backward-compatible overload design, preserved null
  guards, existing test patterns that *could* extend to the changed code.

Always cite `[file:line]` so findings are actionable.

## Specific edge cases to look for in Active.*-drift fixes

When the PR's pattern is "capture Document/Database at entry, thread it
through" (the `fix/active-singleton-drift-drawing-switch` shape), these
are the untested-edge-case hotspots:

| Location | Edge case | Why it matters |
|---|---|---|
| `Active.GetDocument(db)` callers | `db` has no owning Document (side-loaded via `ReadDwgFile`) → returns null | Lock/Save calls receive null; behavior unverified |
| `using (Active.GetDocument(db)?.LockDocument())` | null-conditional silently skips the lock | Transaction runs with no document lock — threading-safety unverified |
| `Settings?.SaveToDrawing(Active.GetDocument(db))` | `GetDocument` returns null → `SaveToDrawing(null)` | Untested null-tolerance in SaveToDrawing |
| Parameterless → explicit overload pairs | Future refactor desyncs the two paths | No delegation-contract test catches it |
| `using (doc.LockDocument())` block re-indentation | Brace structure correct but indentation wrong (mechanical refactor artifact) | Readability/maintainability; real brace bugs in this block would be invisible |

## Key constraint to communicate

The project's test infrastructure limits what's *practically* testable to
pure-logic code. Do **not** recommend "add unit tests for
`GetMLeaderStyleID(db, ...)`" without acknowledging that it requires a live
or fake Database/Document the project doesn't have. The actionable
recommendation is:

1. **Cover the null/edge paths** in `GetDocument`, `GetSettingsFromDictionary`,
   `SaveToDrawing` — these are safety hinges and may be testable with minimal
   fakes or by extraction.
2. **Extract pure predicates** from CAD-interop methods (the entity-presence
   scan, the dictionary-existence check) into helpers that take a `Database`
   and can be tested with a test harness if one is ever added.
3. **Flag the structural invariant** ("captured db/doc used throughout, not
   Active.*") as unverified — a future regression that reintroduces
   `Active.*` inside one of these methods will not be caught by any test.

This is the technique's value: it tells the reviewer *and* the author exactly
where the coverage cliff is, given the real constraints, rather than a generic
"you should add tests."
