# `[CommandMethod]` Dead-Command Audit — Raindrop (issue #654)

Investigation-only audit of every `[CommandMethod("...")]` in
`src/raindrop/CAD Commands/*.cs` (15 files, **171** attributes). Session:
2026-07-30. No files edited.

Classification rules:
- **LIVE** — wired to a UI entry point: ribbon `MakeButton(...)` in
  `Ribbon/RibbonFactory.cs`, `<Command>` entry in
  `Raindrop.bundle/PackageContents.xml`, context-menu tuple in
  `RaindropDrawingContextMenu.cs` / `NonRaindropDrawingContextMenu.cs`,
  `Commands.Send("...")` (or `Commands.Send(Commands.Interface.X)`) from a
  palette/presentation `.xaml.cs` button handler, OR `SendStringToExecute(...)`.
- **INTERNAL** — called only programmatically via `Commands.ExecuteCommand(...)`
  (or `SendStringToExecute(...)`) by live (non-commented) code. NOT dead.
- **DEAD** — zero UI entry points AND zero live programmatic callers. Only docs,
  comments, or incidental string mentions remain.

Result: **LIVE 103 / INTERNAL 17 / DEAD 51**.

## The 51 DEAD commands

Sorted by file then line. "doc/comment/mention" = the only references found.

| Command string | File:Line (attr) | Only references |
|---|---|---|
| `IR_AssignPumpProperties` | Commands.Irrigation.cs:1617 | docs (command-manifest, enki/commands.md). **#654 candidate.** |
| `IR_ClearPumpProperties` | Commands.Irrigation.cs:1640 | docs only. **#654 candidate.** |
| `IR_AssignValvePressureDrop` | Commands.Irrigation.cs:1598 | docs (manifest, mainline-analysis-user-guide, enki). **#654 candidate.** |
| `IR_ExpSettings` | Commands.Irrigation.cs:46 | docs only. (`IR_Settings` is the live one.) |
| `IR_SelectPipeSize` | Commands.Irrigation.cs:562 | docs only. (`IR_SetPipeSize` is live.) |
| `IR_WriteEPANETDemands` | Commands.Irrigation.cs:581 | docs only. |
| `IR_ClearAnalysis` | Commands.Irrigation.cs:661 | docs + release-notes. |
| `IR_WeightedArea_old` | Commands.Irrigation.cs:777 | docs + 2 comments. Superseded by `IR_WeightedArea` (live). |
| `IR_SizeSeq` | Commands.Irrigation.cs:897 | docs + 1 comment. |
| `IR_AggressiveSizeValves` | Commands.Irrigation.cs:920 | docs only. `IR_SizeValves` is live. |
| `IR_LayoutOnPolyline` | Commands.Irrigation.cs:1022 | docs + comments. Live equivalents: `IR_LayoutOnBoundary`, `IR_PolylineLayout`. |
| `IR_ColorPipesBySize` | Commands.Irrigation.cs:1125 | docs only. |
| `IR_ColorLinksByVelocity` | Commands.Irrigation.cs:1144 | docs only. |
| `IR_RefreshElevationPoints` | Commands.Irrigation.cs:1417 | docs only. `IR_ElevationModel` is live. |
| `IR_About` | Commands.Irrigation.cs:1483 | docs only. No About button found. |
| `IR_CheckUpdates` | Commands.Irrigation.cs:1500 | docs only. No Check-Updates button found. |
| `IR_ExportMainlineNetwork` | Commands.Irrigation.cs:1663 | docs + 1 test README. |
| `IR_CZA` | Commands.Irrigation.cs:1682 | docs only. |
| `IR_ResetPalettes` | Commands.Interface.cs:78 | docs only. `AID_Palettes.ResetPalettes()` is a DIFFERENT method called directly; command never invoked. |
| `IR_ToolsLegacy` | Commands.Interface.cs:94 | docs only (enki notes "none yet" for UI). |
| `Internal_SaveIrrigationSettings` | Commands.Internal.cs:44 | No caller. `AID_Application.SaveIrrigationSettings()` is a different method called directly. |
| `Internal_ZoomAndHighlight` | Commands.Internal.cs:87 | ExecuteCommand caller COMMENTED OUT (ZoomAndHighlightEntityHandler.cs:27); live code calls `ZoomAndHighlight()` extension method. |
| `Internal_PublishNodeChangedEvent` | Commands.Internal.cs:128 | Only caller COMMENTED OUT: `//Commands.ExecuteCommand("PublishNodeChangedEvent")` @ ControlValveViewModel.cs:48. |
| `IR_CalcArcByCurve` | Commands.ArcInference.cs:52 | docs + comments + DebugBridge error-string mentions. No UI button. |
| `IR_CalcArcByRadius` | Commands.ArcInference.cs:61 | Same. (Called by `IR_CalcArcByCurve`'s body, but that command is itself dead.) |
| `IR_ClearArcPreview` | Commands.ArcInference.cs:70 | docs + 1 comment. |
| `RDTRACKINGON` | Commands.cs:258 | No UI; only Commands.cs categorization/help-text. Command-line dev toggle. |
| `RDTRACKINGOFF` | Commands.cs:273 | Same. |
| `RDTRACKINGMODE` | Commands.cs:288 | No UI, no references outside own def. |
| `RDTRACKINGSTATUS` | Commands.cs:320 | No UI, no references outside own def. |
| `RDSCOPE` | Commands.cs:349 | No UI; 1 doc + 1 self-help-text. |
| `RDSTATUS` | Commands.cs:419 | No UI; 1 doc + 1 self-help-text. |
| `RD_DEBUGBRIDGE` | Commands.DebugBridge.cs:22 | DEBUG-only. No UI button; bridge auto-starts on load (DebugBridgeService.AutoStart). |
| `ENKI` | Commands.Enki.cs:18 | No UI button, no Commands.Send. Enki launched via palette/EnkiChat, not this command string. |
| `IR_MakeLayer` | Commands.Layers.cs:24 | docs + own method-def. No UI button. |
| `LS_MakeLayer` | Commands.Layers.cs:33 | docs + own method-def. No UI button. |
| `TestDynamicArc` | Commands.Tests.cs:42 | Dev/test. Categorization whitelist Commands.cs:150 + own def. |
| `NormalizeBlocks` | Commands.Tests.cs:48 | Dev/test. Categorization Commands.cs:140. |
| `testRDError` | Commands.Tests.cs:143 | Dev/test. Zero external references. |
| `testBoundaryProtected` | Commands.Tests.cs:162 | Dev/test. Own def + 1 comment. |
| `Test_SetPipeSize` | Commands.Tests.cs:179 | Dev/test. Zero external references. |
| `PFT` | Commands.Tests.cs:195 | Dev/test. Categorization Commands.cs:141. |
| `totalArea` | Commands.Tests.cs:266 | Dev/test. Categorization Commands.cs:143. ("totalArea" also a common local-var name → false positives.) |
| `measp` | Commands.Tests.cs:308 | Dev/test. Categorization Commands.cs:144. |
| `TestYesNo` | Commands.Tests.cs:626 | Dev/test. Categorization Commands.cs:151. |
| `PipeRightClick` | Commands.Tests.cs:781 | Dev/test. Categorization Commands.cs:145. |
| `ListXdata` | Commands.Tests.cs:813 | Dev/test. Categorization Commands.cs:146. |
| `TestSplineJig3` | Commands.Tests.cs:1190 | Dev/test. Categorization Commands.cs:147. Also redeclared in ZSplineTest.cs:168 (duplicate). |
| `TestMleader` | Commands.Tests.cs:1199 | Dev/test. Categorization Commands.cs:148. |
| `MoveAbove` | Commands.Tests.cs:1282 | Dev/test. Categorization Commands.cs:149. |
| `DumpXData` | Commands.Tests.cs:1393 | Dev/test. Docs + comments + DebugBridge shared-helper comment. |

## The 17 INTERNAL commands (NOT dead) + their live callers

| Command string | File:Line | Live caller(s) |
|---|---|---|
| `Internal_InitializeIrrigationDrawing` | Commands.Internal.cs:38 | `SendStringToExecute(Commands.Internal.InitializeIrrigationDrawing+" ")` @ AID_Palettes.cs:787-788 |
| `Internal_WritePropertiesToDrawing` | Commands.Internal.cs:50 | `ExecuteCommand` @ CollectionViewModel.cs:38; InlineDripGridCollectionViewModel.cs:50 |
| `Internal_UpdateControlValve` | Commands.Internal.cs:56 | `ExecuteCommand` @ ControlValveViewModel.cs:289 |
| `Internal_UpdateValvesDesignator` | Commands.Internal.cs:62 | `ExecuteCommand` @ ControlValveDesignatorModifier.cs:15 |
| `Internal_UpdateHydraulicNode` | Commands.Internal.cs:69 | `ExecuteCommand` @ HydraulicNodeViewModel.cs:79 |
| `Internal_UpdateActivePipesClass` | Commands.Internal.cs:75 | `ExecuteCommand` @ PipeClassModifier.cs:25 |
| `Internal_UpdateDripTypes` | Commands.Internal.cs:81 | `ExecuteCommand` @ DripLineModifier.cs:27 |
| `Internal_RefreshNetwork` | Commands.Internal.cs:95 | `ExecuteCommand` @ MainLineAnalysisView.xaml.cs:198 |
| `Internal_SolveNetwork` | Commands.Internal.cs:101 | `ExecuteCommand` @ MainLineAnalysisView.xaml.cs:239 |
| `Internal_SizeAllZones` | Commands.Internal.cs:107 | `ExecuteCommand` @ MainLineAnalysisView.xaml.cs:402 |
| `Internal_PublishMainlineNetworkEvent` | Commands.Internal.cs:116 | `ExecuteCommand` @ ReservoirCollectionViewModel.cs:23,62,74,91; PumpCollectionViewModel.cs:211; PipeCollectionViewModel.cs:44,75; HydraulicLinkCollectionViewModel.cs:49,80; BaseValveCollectionViewModel.cs:58,80 |
| `Internal_PublishControllerEvent` | Commands.Internal.cs:122 | `ExecuteCommand` @ HydraulicNodeViewModel.cs:71; ControlValveViewModel.cs:225,270; ControlValveCollectionViewModel.cs:34,45,64,77 |
| `InternalQuantities_SelectSomeProducts` | Commands.InternalQuantities.cs:24 | `ExecuteCommand` @ QuantitiesViewModel.cs:89 |
| `InternalQuantities_RefreshProducts` | Commands.InternalQuantities.cs:30 | `ExecuteCommand` @ QuantitiesViewModel.cs:66,73,85,143,275 |
| `InternalQuantities_SelectIncludedBoundary` | Commands.InternalQuantities.cs:36 | `ExecuteCommand` @ QuantitiesViewModel.cs:65 |
| `InternalQuantities_SelectExcludedBoundary` | Commands.InternalQuantities.cs:42 | `ExecuteCommand` @ QuantitiesViewModel.cs:72 |
| `InternalQuantities_SelectAndZoomToProduct` | Commands.InternalQuantities.cs:48 | `ExecuteCommand` @ QuantitiesViewModel.cs:92 |

## Audit technique (reusable for any `[CommandMethod]`-based CAD plugin)

1. **Enumerate every `[CommandMethod]` attribute.** `grep -rn 'CommandMethod' "src/raindrop/CAD Commands/" --include="*.cs"`. Parse out the literal string OR the constant reference (`[CommandMethod(Interface.ShowX)]`).
2. **Resolve constant-based commands to their full strings.** Find the `public const string X = Prefix + "Y"` declarations. In Raindrop: `Interface.*` → `IR_` prefix, `Internal.*` → `Internal_` prefix, `InternalQuantities.*` → `InternalQuantities_` prefix, `Plants.*` → `LS_` prefix. You MUST search both the full literal string AND the constant field name — UI wiring often uses `Commands.Send(Commands.Interface.ShowWarningsPalette)` which contains neither `IR_Warnings` nor `ShowWarningsPalette` alone in a naive search.
3. **For each command, search the WHOLE repo tree** (`src/`, `data/`, `*.bundle/`, `docs/`) for the command string, excluding `obj/`, `bin/`, `.git/`, and your own audit output files. Use `rg -n --fixed-strings -i` (case-insensitive fixed-string — command strings are mostly `IR_*`/`Internal_*` so `-w` word boundary is safe for those but NOT for short names like `PP`, `SZ`, `Hop`, `ENKI`, `FS`, `measp` which match common substrings; for short names prefer `-w` plus manual review of each hit).
4. **Classify each hit** as one of:
   - **UI invocation**: `Commands.Send(...)`, `SendStringToExecute(...)`, `MakeButton(...)` (ribbon), `<Command Local="X" Global="X"/>` (PackageContents.xml), context-menu tuple `new("Label", "X")`.
   - **Programmatic**: `Commands.ExecuteCommand(...)` (or `Commands.Internal.X` / `InternalQuantities.X` constants passed to it).
   - **Doc/comment**: anything under `docs/`, `.md` files, `command-manifest.txt`, or lines starting with `//` / `///`.
   - **Mention**: anything else (string in an error message, a `//`-comment that names the command, a property description). These do NOT make a command live.
5. **Verdict**: LIVE if any UI invocation; else INTERNAL if any live (non-commented) `ExecuteCommand`/`SendStringToExecute` caller; else DEAD.

## Pitfalls that bit during this audit

1. **Constant-based commands hide UI wiring from literal-string search.**
   `IR_Warnings` looked DEAD on a literal-string search, but it's wired via
   `Commands.Send(Commands.Interface.ShowWarningsPalette)` in `ToolBarView.xaml.cs:40`.
   The constant `ShowWarningsPalette` resolves to `IR_Warnings` but neither
   string appears in the call site as the literal `IR_Warnings`. **Fix:** always
   search the constant field name too, excluding the defining file's
   `const string` line.

2. **Multi-line `SendStringToExecute` hides the command on the arg line.**
   `Internal_InitializeIrrigationDrawing` is invoked via:
   ```csharp
   e.Document.SendStringToExecute(
       Commands.Internal.InitializeIrrigationDrawing + " ",
       activate: true, ...);
   ```
   The hit line (788) is `Commands.Internal.InitializeIrrigationDrawing + " ",`
   — it contains the constant but NOT `SendStringToExecute(`. A classifier that
   only flags lines containing `SendStringToExecute(` misses it. **Fix:** search
   `rg -A2 SendStringToExecute` and scan the following lines for command constants.

3. **Same-name-different-method: a `[CommandMethod]` wrapper whose body calls a
   same-named plain method is NOT alive just because the plain method is called.**
   `Internal_SaveIrrigationSettings` is a `[CommandMethod]` that calls
   `AID_Application.SaveIrrigationSettings()`. The plain method IS called
   directly from `AID_Application.cs:851`, but the *command* itself has no caller.
   Don't conflate the command string with the method name it wraps.

4. **Commented-out `ExecuteCommand` callers do NOT make a command INTERNAL.**
   `Internal_ZoomAndHighlight`: `//Commands.ExecuteCommand(Commands.Internal.ZoomAndHighlight)`
   is commented out; live code calls the `ZoomAndHighlight()` extension method
   instead. `Internal_PublishNodeChangedEvent`: `//Commands.ExecuteCommand("PublishNodeChangedEvent")`
   is the only reference and it's commented. **Fix:** check whether the
   `ExecuteCommand` line is preceded by `//`.

5. **The `command == "X"` whitelist in `Commands.cs` is categorization, not
   invocation.** `Commands.cs` lines 140-151 list `command == "NORMALIZEBLOCKS"`,
   `command == "PFT"`, etc. These are a command *category* lookup for the
   tracking/log system — they do not invoke the commands. A test command that
   appears ONLY in this whitelist (plus its own method def) is still DEAD by the
   UI-wiring definition.

6. **`MakeButton` passes the command string with a trailing space** (e.g.
   `"IR_DrawMainline "`, `"HOP "`). A `--fixed-strings` search for `IR_DrawMainline`
   still matches (substring), so this is fine — but be aware the trailing space
   is there if you ever exact-match.

7. **The "reflection-loaded, cannot confirm dead" rule from the broad audit
   applies to attribute-instantiated CLASSES, NOT to `[CommandMethod]`s.**
   AutoCAD does register every `[CommandMethod]` for command-line typing, but
   for an issue-triage / dead-UI audit, a command with zero UI entry point and
   zero programmatic caller IS dead. The earlier `broad-dead-code-audit.md`
   step 6 over-generalized this to all `[CommandMethod]`s; that's corrected
   here. (A `[CommandMethod]` is only "softer-dead" in the sense that a user
   who knows its name can still type it at the CAD command line — which is why
   `IR_WeightedArea_old` and the dev/test commands stay KEEP-INVESTIGATE rather
   than DEAD-REMOVE, even though they have no UI wiring.)

8. **`rg` on the whole repo with binary files can throw UnicodeDecodeError in
   Python subprocess.** Pass `errors="replace"` to `subprocess.run` and exclude
   binary globs (`epanet2.dll*`). Otherwise a single binary hit crashes the whole
   batch and returns `None` for `.stdout`.

9. **Exclude your own audit output from subsequent searches.** Writing a
   `_audit.json` and then re-searching the repo for command strings will match
   your own file. Add `--glob '!**/_audit*.json'` (and clean up the temp file
   when done).
