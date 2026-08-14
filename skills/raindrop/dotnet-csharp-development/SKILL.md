---
name: dotnet-csharp-development
description: "Use when editing .cs files or building dotnet projects."
---

# C# / .NET Development

## Build & Test

- Restore: `dotnet restore`
- Build (project-specific config): `dotnet build <path>.csproj -c <Configuration>`
- Test: `dotnet test <path>.csproj`
- Build output: always check `0 Error(s)` in the final summary line; pre-existing warnings are normal in large codebases.

## Coding Style (general)

- PascalCase for types, methods, properties, constants; camelCase for locals/params; `_camelCase` for private fields.
- Nullable enabled in modern projects — watch `CS8600`/`CS8602`/`CS8604`.
- Keep files focused; avoid unrelated refactors in a single change.

## Pitfalls

### P1: Incremental patches on brace-heavy code break brace alignment

When editing a multi-line block of C# with deep brace nesting (3+ levels), do **NOT** do incremental find-and-replace patches on individual `}` lines. Each patch shifts the context for the next one, creating cascading misalignment.

**Correct approach**: Read the entire affected block (from opening to closing brace), understand the structure, then rewrite the whole block in a single edit. This is especially critical for tab-indented code where visual alignment matters.

### P2: Moving interactive CAD prompts out of a transaction

When refactoring AutoCAD/BricsCAD code that calls interactive methods (jigs, `GetPoint`, `GetAngle`, `PointMonitor`) inside a `Transaction` scope:

1. The transaction must commit BEFORE the interactive call
2. Interactive methods open their own transactions internally
3. The pattern: insert → commit → interact → (interactive method handles its own transaction)

### P3: Cross-class method visibility for shared helpers

When extracting a method to be called from another class in the same assembly:
- `private static` → `internal static` (not `public`)
- Add `using <SourceNamespace>;` to the calling file
- `internal` keeps it assembly-scoped — correct for plugin code

## Techniques

### Multi-file coordinated changes

When changing a method's visibility and adding a caller in another file:
1. Change visibility first (e.g., `private` → `internal`)
2. Add the `using` directive to the caller file
3. Add the call site
4. Build once to verify — don't chain multiple visibility changes before building

### Dual-platform C# (preprocessor directives)

Many CAD plugins support multiple platforms via `#if BRX_APP` / `#elif ACAD_APP`. When editing shared code:
- Check which platform defines apply to your build configuration
- Platform-specific usings go in the `#if` block at the top of the file
- Common code (below the usings) compiles against both — use the shared API surface

## Workflow

### Sequential issue implementation

When the user asks to implement multiple issues sequentially:
1. Branch from dev for each issue
2. Plan → implement → build-verify → commit
3. Switch back to dev before starting the next issue
4. Do NOT push unless asked — local branches + commits are the default

### Build verification cadence

- Build after each logical change (not after every line)
- Check `grep -E "Error\(s\)|error CS"` on build output for quick pass/fail
- A clean build with `0 Error(s)` is the commit gate
