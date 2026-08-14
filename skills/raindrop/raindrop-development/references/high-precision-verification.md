# High-Precision PR Review (Minimize False Positives)

A review is only as good as its signal-to-noise ratio. The single most common
way a review loses trust is by reporting findings that turn out to be wrong —
an overload that does exist, a "removed" variable that's still used, a line
number that no longer matches. Every false positive costs the author time and
erodes confidence in the real findings.

The fix is mechanical: **verify each candidate finding against the actual
codebase before reporting it.** The diff shows intent; the codebase shows
ground truth. Read both.

Use this when reviewing Raindrop PRs (especially the `Active.*` drift class of
fixes, where the diff *looks* like it captured `db` everywhere but a live
read of helper bodies reveals it didn't). Pairs with the `pr-review-toolkit`
code-reviewer agent prompt: run the checklist to *find* candidates; run this
workflow to *confirm* them.

## Workflow

### 1. Read the three independent inputs in parallel
Batch up front — these have no dependencies between them:
- the diff file (`/tmp/pr-review-diff.patch` or `git diff main...HEAD`)
- the changed-files list (`/tmp/pr-review-changed-files.txt`)
- the project guidelines (AGENTS.md)

One round-trip, not three.

### 2. Verify every referenced symbol before flagging a call-site issue
When the diff adds a call like `Foo(db)` or `Foo(doc)`, do NOT assume the
overload exists just because it was written. Before flagging "wrong overload
chosen" or "missing overload," grep the repo and confirm:
- the target overload signature actually exists
- its parameter types match what's passed
- the return type matches how the result is used

```bash
cd "C:/Users/tim/Raindrop/src/raindrop"
grep -rn "public static.*GetMLeaderStyleID" . --include="*.cs"
grep -rn "NODContainsDictionary" . --include="*.cs" | grep "Database"
```

If the overload exists and matches → not a finding. If it doesn't → that IS
the finding (broken call), and you've now proven it.

### 3. Read the actual current file, not just the diff context
The diff's context lines are a snapshot of one version. For findings that
depend on surrounding code (e.g. "this still uses `Active.*` at line N"), read
the live file with `read_file` and confirm the line content and number. A
finding citing a line that no longer matches the file is an immediate false
positive.

**Raindrop-specific:** `GetTextStyleID` (Styles.cs:54) reads `Database db =
Active.Database` (line 57). The diff shows it was "refactored to capture db" —
which *looks* like the drift fix. Only reading the live body reveals it still
reads `Active.Database`, not a caller-passed database. "Captured into a local"
≠ "received from caller." This subtlety is why step 3 matters.

### 4. Inspect whitespace with `cat -A` for indentation findings
The diff renders tabs and spaces ambiguously. For any indentation / style
finding, see the actual bytes:
```bash
sed -n '279p' SprinklerFactory.cs | cat -A   # ^I = tab, spaces show literally
```
Count the leading `^I` markers and compare to sibling lines at the same scope.
Only flag an indentation regression when the tab/space count genuinely differs
from neighbors at the same nesting level.

**File-local convention wins over repo convention.** AGENTS.md says "use tabs,"
but `AID_Palettes.cs` uses 4 spaces consistently throughout — its new lines
should match the file, not the repo. Only flag when the *new* lines break the
file's *own* established style. Check by sampling old lines in the same block:
```bash
sed -n '810,820p' AID_Palettes.cs | cat -A   # spaces, not tabs — file convention
```

### 5. Compare against the parent version with `git show`
When the diff *removes* lines and you suspect a bug (deleted something still in
use), or want to confirm a removal was dead-code cleanup, compare:
```bash
git show HEAD:"src/raindrop/CAD Utility/Styles.cs" | sed -n '60,95p'
```
This confirms whether the removed variable (`setttingPath` in `InitStyles`)
was referenced downstream (dead → safe removal / positive) or still used (→
real regression).

### 6. Trace transitive dependencies before declaring a fix "complete"
The core Raindrop review trap: a PR captures `doc`/`db` at entry and threads
it through *direct* calls — but calls helpers that internally still reference
`Active.*`. Before praising or flagging, check the helpers:
```bash
grep -n "Active.Database\|Active.Document" Active.cs | head
# AddXrecordToNamedDictionary (Active.cs:149) uses Active.Document.LockDocument() + Active.Database
```
Decision rule:
- If the new overload calls an **unchanged** helper that uses `Active.*`
  internally: the call site is a real WARNING (the lock/resource mismatch is
  introduced by the new overload's contract), even though the helper body is
  outside diff scope. State clearly that the helper internals are unchanged, so
  it's a call-site contract observation, not a diff-line nit.
- If the helper was also updated in the diff to take the parameter: positive.
- If the helper is dead code (no callers repo-wide): SUGGESTION to delete,
  not a warning.

### 7. Confirm dead code is actually unreferenced
Before suggesting deletion of "unreachable" code, grep the whole repo for
callers — not just the current file:
```bash
grep -rn "GetMLeaderStyleFromDWG" . --include="*.cs"
```
Only call it dead if the only hit is its own definition. (`GetMLeaderStyleFromDWG`
in Styles.cs:295 is dead — the `db`-overload routes through `CloneMLeaderStyle`
instead.)

## Path-tool caveat (Windows / MSYS hosts)
`search_files` / rg with a `C:\Users\...` path can fail with "cannot find the
path" because the tool forwards an MSYS-mangled `/c/Users/...` path to
ripgrep. If search_files fails on a Windows-native path, fall back to
`terminal` with the same `C:/Users/...` path — `grep -rn` via bash works where
the search tool does not. One diagnostic attempt, then switch; don't loop the
failing call. (Already documented in the SKILL.md "search_files vs terminal
grep" pitfall, restated here because it bit during this review.)

### 8. Check surviving-line indentation after method removal
When a diff *removes* a method that sat between two other methods (common in
dead-code cleanup), the surviving neighbors can end up over- or under-indented.
The diff's `+`/`-` lines show the change, but the *unchanged* lines around the
removal may have silently shifted. Compare the parent version's indentation
with the post-diff file:

```bash
# Parent (pre-removal) indentation
git show HEAD~1:src/raindrop/Palettes/PipeControl.cs | sed -n '205,215p' | cat -A
# Current (post-removal) indentation
sed -n '205,215p' src/raindrop/Palettes/PipeControl.cs | cat -A
```

Count `^I` markers on closing braces and the next method declaration. If the
post-removal file has an extra tab on `}` or on the next `public void Foo()`
that wasn't there in the parent, flag it as an indentation regression — even
though the file compiles (C# ignores indentation). This is the same corruption
the `patch` tool can introduce (see SKILL.md § "Patch Tool Tab Corruption"), but
it can also come from a manual or AI-assisted commit edit, not just the patch
tool. **The review-time fix is the same either way: compare parent vs current
with `cat -A` on the boundary lines.**

### 9. Grep for dangling XML doc references after symbol removal
When a diff removes a `[CommandMethod]`, public method, or class, grep the
whole repo for its name inside XML documentation tags — not just in code call
sites. The dead-code cascade check (SKILL.md § "Dead-command cascade to palette
methods") covers method-to-method references, but XML doc comments (`<summary>`,
`<remarks>`, `<see cref="...">`, `<c>...</c>`) can reference removed symbols and
become stale without breaking the build.

```bash
# After removing IR_WeightedArea_old, check for doc references
grep -rn "IR_WeightedArea_old\|WeightedAreaOld" --include="*.cs" . | grep -E '///|<see|<c>|<remarks|<summary'
```

These are SUGGESTION-level findings (they don't break compilation), but they
mislead future readers and should be updated to past tense or removed. Common
pattern: a replacement command's `<remarks>` says "the legacy implementation is
kept available as `IR_OldCommand` for a transition period" — after the old
command is removed, that sentence is a dangling forward reference to nothing.

### 10. Check docs tables that catalog removed commands
Beyond XML doc comments, also grep **markdown docs** for removed command names.
`docs/enki/commands.md` has a table listing every `[CommandMethod]` with a
description and a link slug. When a command is removed from source, its row in
this table becomes stale — it documents a command that no longer exists. The
`validate-commands.yml` CI check catches `docs/command-manifest.txt` drift (the
generated list), but it does NOT check `docs/enki/commands.md` (the human-written
reference table). This is a SUGGESTION-level finding the review toolkit caught on
PR #709 (Jul 31, 2026): `IR_WeightedArea_old` was removed from source and the
manifest, but its row in `enki/commands.md:126` was left behind.

```bash
# After removing a command, check the docs reference table too
grep -n "IR_WeightedArea_old" docs/enki/commands.md
```

## What NOT to capture as findings
- Unchanged code outside the diff, unless the diff adds a *call site* that
  reaches unchanged helper code under a mismatched resource contract — that
  new contract is in scope.
- File-local style conventions that differ from AGENTS.md. Consistency with
  the file's *own* established style is what matters; only flag if the *new*
  lines break the file's own convention.
- Pre-existing transitive dependencies the PR did not touch and does not
  newly invoke under a mismatched contract.

## Output format
Report findings as:
```
CRITICAL: [file:line] — description
WARNING: [file:line] — description
SUGGESTION: [file:line] — description
POSITIVE: [what was done well]
```
Cite the file and line for every finding. If you verified a candidate and it
turned out NOT to be an issue, do not report it — only report confirmed
findings. State when the diff *appears* to fix something but a live read
shows it didn't (the `GetTextStyleID` case) — that's the highest-value finding
because it looks done to a casual reader.
