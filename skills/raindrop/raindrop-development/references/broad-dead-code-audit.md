# Broad Dead-Code Audit — src/raindrop/ (Track 3)

Investigation-only audit of `src/raindrop/` for dead/superseded code **beyond**
Property Wrappers and CAD Commands. Session: 2026-07-30. No files edited.

Scope: `src/raindrop/` only (excluded `src/Logging`, `src/RaindropTests`,
and `obj/` generated files). Findings below are HIGH-CONFIDENCE dead code only —
reflection-loaded `[CommandMethod]`s, XData handlers, and DI/instantiated-via-
reflection classes were kept as KEEP-INVESTIGATE.

## Findings (DEAD-REMOVE = high confidence)

| File | Symbol/Region | Evidence (why dead) | Verdict |
|---|---|---|---|
| `Properties/AssemblyInfo - Copy.cs` | whole file | Explicitly excluded from compile (`<Compile Remove="Properties\AssemblyInfo - Copy.cs"/>`); duplicate; zero refs. | DEAD-REMOVE |
| `Property Wrappers/DriplineTypeConverter - Copy.cs` | `DriplineTypeConverter` | " - Copy" filename; zero references anywhere (already in property-wrappers-audit.md row 9). | DEAD-REMOVE |
| `ZSplineTest.cs` | `SplineJig3` class | `<Compile Remove="ZSplineTest.cs"/>`; `class SplineJig3` defined ONLY here; zero refs (the `TestSplineJig3_Method` referenced elsewhere lives in `SplinePolyJig`, a different class). | DEAD-REMOVE |
| `zz Dictionary.cs` | `Extension` static class + nested `Assert` | `<Compile Remove="zz Dictionary.cs"/>`; all members (`GetTopTransaction`, `TryGetExtensionDictionary`, `GetOrCreateExtensionDictionary`, `GetXrecordData`, `SetXrecordData`) zero refs. | DEAD-REMOVE |
| `Properties/Annotations.cs` | whole file (namespace `Raindrop.Properties`) | Duplicate JetBrains-annotations file; live one is `Annotations1.cs` (namespace `AID.Annotations`, `using`-ed by 4 files). `using Raindrop.Properties` nowhere; zero refs to that namespace. | DEAD-REMOVE |
| `ElevationModel.cs` (root) | whole file | Entire class body commented out (`//public class ElevationModel ...`); only empty namespace block + comments. Active impl lives in `ElevationModel/` subfolder. | DEAD-REMOVE |
| `CAD Extensions/TransactionManagerExtensions.cs` | `TransactionManagerExtensions` static class | Class body entirely commented out; empty shell, zero refs. | DEAD-REMOVE |
| `Hydraulic/HydraulicTank.cs` | `HydraulicTank` internal class | Zero refs anywhere (only `HydraulicReservoir` is used; EPANET tank representation migrated there). | DEAD-REMOVE |
| `CAD Utility/CommandHandlers.cs` | `CommandHandlersX` static class | Zero refs; file named `CommandHandlers` but class is `CommandHandlersX`; dead COPY/PASTECLIP event experiment, never wired. | DEAD-REMOVE |
| `CAD Utility/TypedValueExtensions.cs` | `TypedValueExtensions` static class | ~~Flagged DEAD-REMOVE~~ **FALSE POSITIVE — LIVE.** Extension methods on `TypedValue[]` (`ReadString`/`ReadDecimal`/`ReadDouble`/`ReadInt`) are called by `ProductService.cs:100-112` via `using AID.CAD_Utility`. Class-name grep found zero hits because extension methods are resolved by namespace, not by the class name at the call site. **Do not delete.** | **KEEP** (was DEAD-REMOVE, corrected after build error CS1061) |
| `ListWrappers/SprinklerDefinitionSummary.cs` | `SprinklerDefinitionSummary` class | Zero refs; `ToString()` body is `throw new NotImplementedException()`. Whole `AID.ListWrappers` namespace has no external `using`. | DEAD-REMOVE |
| `Activation/DiskInfoService.cs` | `DiskInfoService` static class | Zero refs; `GetDiskSerialNumber()` called nowhere. Superseded by `SystemInfoHelper.GetDiskId()` used by `MachineFingerprintService`. | DEAD-REMOVE |
| `CAD Utility/DocumentReactor.cs` | `DocumentReactor` static class | Zero refs; no event wiring anywhere; no `[CommandMethod]`. Plain static class, never subscribed. | DEAD-REMOVE |
| `Jigs/Plinejig.cs` | `PlineJig` internal class | Zero refs; jig requiring `new PlineJig(...)` — no instantiation anywhere; no `[CommandMethod]`. | DEAD-REMOVE |
| `Jigs/PolylineLayoutJig.cs` | `PolylineLayoutJig` class | Zero refs; DrawJig subclass, never instantiated; no `[CommandMethod]`. | DEAD-REMOVE |
| `Jigs/PaintPolylineEntityJig.cs` | `PaintPolylineEntityJig` internal class | Zero refs; EntityJig subclass never instantiated (live paint-polyline jig is `PaintPolylineDrawJig`, which IS referenced). | DEAD-REMOVE |

## KEEP-INVESTIGATE (do not auto-remove)

| File | Symbol | Why not dead-confirmed |
|---|---|---|
| `Settings/AID_Settings.cs` | `AID_Settings` static class | `[Obsolete("Use SettingsFactory.Settings instead")]` but migration incomplete — still referenced by 19 files. Cannot remove until callers migrate. |
| `Activation/AesEncryptionService.cs` | `AesEncryptionService` class (whole file) | Zero refs to the class anywhere; verify no reflection/DI in activation flow before removing. (`GenerateSecureKey` method inside is `[Obsolete]` + zero refs — that method alone is DEAD-REMOVE.) |
| `CAD Commands/Commands.Irrigation.cs` lines 771–782 | `WeightedAreaOld()` / `IR_WeightedArea_old` | Commented "Legacy … Superseded by IR_WeightedArea … kept for transition period." It's a `[CommandMethod]` so AutoCAD reflection-loads it — cannot source-grep-confirm dead. |

## Execution workflow (issue #654 — what actually got deleted)

The audit identified candidates; the user said "go ahead and implement." The execution followed this sequence:

1. **Check csproj structure** — SDK-style projects glob all `.cs` files by default, so `rm` alone removes from compilation. Verify there are no explicit `<Compile Include>` entries for the file (if there are, the csproj needs editing too). Check for existing `<Compile Remove>` entries — files already excluded but still on disk are the safest deletes.

2. **Delete files in batches by track** — Property Wrappers first (10 files), then Track 3 dead files (15 files), then data/binary files. Use `rm -v` to confirm each.

3. **Remove dead `[CommandMethod]` methods** — these are method-body edits, not file deletions. Use `patch` with enough context to include the full method (summary comment → `[CommandMethod]` attr → method body → closing `}`). For consecutive dead methods, remove them as a block.

4. **Cascade removal** — when a dead command calls a method that's ONLY called by that dead command, the called method is now dead too. Remove it. Example: `IR_ResetPalettes` → `RaindropPalettes.ResetPalettes()` → `DisposePalette()` — all three became dead after the command was removed.

5. **Clean up stale csproj entries** — after deleting files that had `<Compile Remove>` entries, those entries are now stale. Remove them from the csproj.

6. **Build and let the compiler verify** — `dotnet build src/raindrop/Raindrop.csproj -c AutoCAD25_Debug`. The compiler is the safety net:
   - **0 errors** → all deletions confirmed dead. ✅
   - **CS1061/CS0103 errors** → a deleted type/method was still called. `git checkout -- <file>` to restore, then re-examine.

7. **One false positive per audit is normal** — the #654 audit had exactly one: `TypedValueExtensions` (extension-method trap, see below). The build caught it immediately.

## Extension-method trap (critical pitfall)

**`TypedValueExtensions.cs` was flagged DEAD-REMOVE by class-name grep but is LIVE.**

`ProductService.cs:100-112` calls `.ReadString()`, `.ReadDecimal()` etc. as extension methods on `TypedValue[]`. These are invisible to a class-name reference search because:
- Extension methods are resolved by `using` the containing namespace at the call site
- The class name `TypedValueExtensions` never appears at the call site — only the method name does
- `grep -rln "TypedValueExtensions"` returns zero hits outside the defining file, even though the methods are actively used

**Rule: never delete a `static class` containing `this`-parameter extension methods based on class-name references alone.** Instead:
- Grep for the method names: `grep -rn "\.ReadString\(\|\.ReadDecimal\(\|\.ReadDouble\(\|\.ReadInt(" --include="*.cs"`
- Or just delete and let the compiler catch it (CS1061: `'TypedValue[]' does not contain a definition for 'ReadString'`)
- The `git checkout -- <file>` restore is a one-second fix; the build is the ground truth

## Audit technique (refined from Track 1 + Track 3 + execution)

1. **List all `.cs` files** in scope: `cd src/raindrop && find . -name "*.cs" -type f | grep -v "/obj/" | sort`. Skip `obj/` (generated) and `*.Designer.cs` (UI boilerplate) for type-sampling.
2. **Filename scan for legacy markers**: `find ... | grep -iE "copy|old|backup|deprecated|legacy|_v1|_v2|v1|v2"`. (Note: `*V2` view files in this repo are LIVE — both V2 and non-V2 palettes are instantiated in `AID_Palettes.cs`. Do not assume V2 = dead.)
3. **Grep markers**: `grep -rn "\[Obsolete" --include="*.cs"` and `grep -rni "TODO: remove\|// DEPRECATED\|// legacy"`.
4. **Check the csproj for `<Compile Remove=...>` entries** — these are the strongest dead-code signal (explicitly excluded = the maintainer already knows it's dead). Grep `Raindrop.csproj` for `Compile Remove`.
5. **Per-symbol reference check**: for each candidate type, `grep -rln "\b<TypeName>\b" --include="*.cs" | grep -v "/obj/" | grep -v "<TypeName>.cs"`. Zero hits outside the defining file = dead candidate.
   - **CASE-SENSITIVE**: C# is case-sensitive. `Plinejig.cs` defines `PlineJig` (capital P in "Jig"); searching `plinejig` misses it; searching `PlineJig` is correct. Also `JigMove.cs` defines class `JiggerMove` (not `JigMove`) — search the declared identifier, not the filename.
   - **Class-name vs filename divergence**: `CommandHandlers.cs` defines `CommandHandlersX` (trailing X). Search the class name, not the filename.
6. **Verify reflection/DI before declaring dead**: a `[CommandMethod("X")]` method is loaded by AutoCAD by name at runtime — source-grep showing zero `X` references does NOT make it dead. Same for `[TypeConverter]`/`[Editor]`-attributed classes (PropertyGrid instantiates by type) and IXDataWriter impls resolved by type. Only call DEAD when there's no `[CommandMethod]`, no attribute-driven instantiation, and zero `new TypeName(` sites.
7. **Commented-out bodies**: a file that compiles but whose entire class body is `//`-commented (e.g. `ElevationModel.cs` root, `TransactionManagerExtensions.cs`) is dead even though the namespace/class decl compiles. `grep -cvE "^\s*//|^\s*$|using|^#" file.cs` returning a tiny number (1–7) is the giveaway.
8. **Superseded-by tracing**: when a type has zero refs, confirm the replacement (e.g. `DiskInfoService` → `SystemInfoHelper.GetDiskId()`; `HydraulicTank` → `HydraulicReservoir`). Finding the replacement confirms intent (superseded, not just temporarily unused).
9. **`ToString() throw NotImplementedException()`** is a strong dead-code smell for display-model classes (`SprinklerDefinitionSummary`) — a live display wrapper would never ship a throwing ToString.
10. **Extension-method classes are invisible to class-name grep** — a `static class` with `this`-parameter methods (extension methods) will show zero class-name references even when the methods are actively called, because the class name never appears at the call site. Search for the *method names* instead (`grep -rn "\.MethodName(" --include="*.cs"`), or just delete and let the compiler catch it (CS1061). This is how `TypedValueExtensions` was wrongly flagged dead in the #654 audit — see the "Extension-method trap" section above.

## csproj cleanup (completed in #654 execution)

The 8 stale `<Compile Remove>` entries (5 for the non-existent `old copies/` directory, plus `AssemblyInfo - Copy.cs`, `ZSplineTest.cs`, `zz Dictionary.cs`) were **removed from the csproj** during the #654 execution. The `old copies/` directory never existed on disk; the other three files were deleted in the same pass.
