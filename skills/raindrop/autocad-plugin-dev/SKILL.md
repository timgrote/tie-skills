---
name: autocad-plugin-dev
description: Use when building or debugging AutoCAD .NET plugins.
triggers:
  - Working on C# code that targets AutoCAD or BricsCAD (ACAD_APP / BRX_APP ifdefs)
  - Building, deploying, or debugging an AutoCAD .NET plugin
  - Transaction lifecycle issues in CAD database operations
  - IMessageFilter or keypress-during-prompt conflicts
---

# AutoCAD / BricsCAD .NET Plugin Development

## Build Configurations

Different CAD versions use different build configs. The output DLL name and target CAD version vary:

| Config | AssemblyName | OutputPath | Target |
|--------|-------------|------------|--------|
| `AutoCAD_Debug` | `Raindrop_AutoCAD` | `bin/AutoCAD_Debug/` | AutoCAD 2024 |
| `AutoCAD25_Debug` | `Raindrop_AutoCAD25` | `bin/AutoCAD25_Debug/` | AutoCAD 2025+ |
| `BricsCAD_Debug` | `Raindrop_BricsCAD` | `bin/BricsCAD_Debug/` | BricsCAD V24 |

**PITFALL**: Building `AutoCAD_Debug` when the running CAD is AutoCAD 2025+ produces `Raindrop_AutoCAD.dll` but the bundle expects `Raindrop_AutoCAD25.dll`. The old DLL stays loaded and changes are invisible. Always match the config to the running CAD version.

## Deploy to Bundle

The post-build step copies DLLs to the ApplicationPlugins bundle. If it fails silently:

```bash
# Manual deploy via the repo's copy script
bash scripts/copy-binaries.sh AutoCAD25_Debug
```

Bundle locations:
- AutoCAD: `%APPDATA%/Autodesk/ApplicationPlugins/Raindrop.bundle/Contents/<year>/`
- BricsCAD: `%APPDATA%/Bricsys/BricsCAD/V24/en_US/Applications/Raindrop.bundle/Contents/V24/`

**PITFALL**: The DLL is locked while CAD is running (`Device or resource busy`). Close CAD before deploying.

## Transaction Lifecycle

AutoCAD transactions use a nesting model. Key rules:

1. **Don't call methods that open their own transactions inside a `using (Transaction tr = ...)` block** — even after `tr.Commit()`, the outer transaction object is still alive and can interfere with nested transactions. Move the call outside the `using` block.

2. **Hoist variables** that need to survive past the `using` block:
   ```csharp
   Sprinkler insertedSpk;          // declared outside
   ObjectId blockId = ObjectId.Null;
   using (Transaction tr = ...)
   {
       insertedSpk = InsertSprinklerBlockAtPoint(tr, ...);
       blockId = insertedSpk.ObjID;
       tr.Commit();
   }
   // Now safe to call methods that open their own transactions
   TweakOneHead(insertedSpk);
   ```

3. **Lock the document** before modifying entities outside a command context: `using (Active.Document.LockDocument())`

## IMessageFilter Stacking

When multiple `IMessageFilter` implementations are registered via `Application.AddMessageFilter`, they run in registration order. If the first filter returns `true` for a key, later filters never see it.

**PITFALL**: Calling `TweakOneHead` (which registers `ArcTweakKeyFilter` for Q/A/W/S/E) from inside `UserPlaceSprinkler` (which already has `SprinkKeyFilter` active for Q/A) causes Q/A to be swallowed by the placement filter. Fix: temporarily remove the outer filter before calling, re-add in `finally`:

```csharp
Application.RemoveMessageFilter(outerFilter);
try
{
    Commands.TweakOneHead(spk);  // installs its own filter
}
finally
{
    Application.AddMessageFilter(outerFilter);
}
```

## Debug Logging

`Debug.WriteLine` output goes to:
1. **Visual Studio Output window** (when debugging)
2. **Debug log file** at `~/Documents/Raindrop/Logs/` (when `EnableDebugFileLogging` config is on, via `AsyncDebugFileLogger`)

Use bracketed prefixes for grepping: `[InsSprinkler] #686 message`.

## Patch Tool + C# Tabs

The `patch` tool can corrupt C# brace structure when the file uses tabs for indentation. Incremental patches fight over tab alignment, producing code that compiles (C# ignores indentation) but has misleading indentation that hides logic errors.

**Strategy**: When a multi-edit patch sequence goes wrong, `git checkout dev -- <file>` to reset and redo as a single clean edit with full context lines. Don't chase indentation fixes one brace at a time.

## Conditional Compilation

AutoCAD vs BricsCAD code is selected via `#if BRX_APP / #elif ACAD_APP` preprocessor directives. Usings differ:
```csharp
#if BRX_APP
using Teigha.DatabaseServices;
#elif ACAD_APP
using Autodesk.AutoCAD.DatabaseServices;
#endif
```

## See Also

- `references/raindrop-build-deploy.md` — Raindrop-specific build config → CAD version mapping and deploy commands

## Auditing `[CommandMethod]` for dead commands

Every `[CommandMethod("X")]` registers command `X` for command-line typing via reflection, so a naive source grep showing zero callers does NOT by itself confirm dead. But a command is dead **for UI/triage purposes** when it has zero UI entry points AND zero programmatic callers. UI entry points to search the whole repo tree for:

- Ribbon buttons: `MakeButton("Label", "X ", ...)` in a Ribbon factory (note the trailing space in the command arg).
- Command table: `<Command Local="X" Global="X" />` in the `.bundle/PackageContents.xml`.
- Context menus: tuple entries like `new("Label", "X")` in a `*ContextMenu.cs`.
- Palette/presentation buttons: `Commands.Send("X")` or `Commands.Send(Commands.Interface.ConstantName)` from `.xaml.cs` button handlers.
- Programmatic: `Commands.ExecuteCommand(...)` / `SendStringToExecute(...)` from live (non-commented) code.

**Constant-based commands:** when `[CommandMethod(Interface.ShowPalette)]` references a `public const string ShowPalette = Prefix + "Palette"`, resolve the constant to its full string and search BOTH the literal string AND the constant field name — UI wiring often uses `Commands.Send(Commands.Interface.ShowPalette)`, which contains neither the resolved literal nor the bare field name alone.

**Verdict:** LIVE (any UI invocation) / INTERNAL (only live `ExecuteCommand`/`SendStringToExecute` callers — NOT dead) / DEAD (only docs, comments, or incidental mentions).

**Pitfalls:**
- Multi-line `SendStringToExecute(\n  Commands.Internal.X + " ",\n ...)` — the command is on the *argument* line, which does NOT contain `SendStringToExecute(`. Search `rg -A2 SendStringToExecute` and scan the following lines.
- A `[CommandMethod]` wrapper that calls a same-named plain method is NOT alive just because the plain method is called elsewhere. Check callers of the *command string*, not the method name.
- Commented-out `ExecuteCommand(...)` callers do NOT make a command INTERNAL. Verify the call line isn't preceded by `//`.
- A `command == "X"` whitelist in a command-categorization routine is NOT an invocation — it's a category lookup for logging/tracking. Don't count it as live.
- For attribute-instantiated CLASSES (`[TypeConverter]`, `[Editor]`, IXDataWriter impls resolved by type), you still cannot source-grep-confirm dead — reflection instantiates them. That rule does NOT extend to `[CommandMethod]`s, which CAN be confirmed dead by exhaustive UI-wiring + ExecuteCommand search.

For the full worked example (171 attributes audited, 51 dead), see the `raindrop-development` skill's `references/command-method-dead-audit.md`.
