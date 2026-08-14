# Raindrop Codebase Reference

Irrigation design CAD plugin (AutoCAD/BricsCAD). Source at `~/Raindrop/`.

## Build

```
dotnet build src/raindrop/Raindrop.csproj -c AutoCAD_Debug    # AutoCAD debug
dotnet build src/raindrop/Raindrop.csproj -c AutoCAD_Release  # AutoCAD release
dotnet build src/raindrop/Raindrop.csproj -c BricsCAD_Debug   # BricsCAD
dotnet build src/raindrop/Raindrop.csproj -c AutoCAD25_Debug  # AutoCAD 2025
```

## Structure

- `src/raindrop/` — core plugin
  - `CAD Commands/` — `[CommandMethod]` entry points (Commands.Plants.cs, Commands.Irrigation.cs, Commands.TweakCoverage.cs, etc.)
  - `CAD Utility/` — helpers (Blocks.cs, Styles.cs, Utililty.cs)
  - `Factories/` — domain logic (SprinklerFactory.cs, PlantFactory.cs, ValveFactory.cs, ControllerFactory.cs)
  - `Jigs/` — DrawJig/EntityJig subclasses (SprinklerJig.cs, PlantJig.cs, etc.)
  - `Landscape/` — plant model (Planting/Plant.cs, PlantDefinition.cs, LandscapeLegend.cs)
  - `Presentation/` — ViewModels, Settings, XAML views
  - `Services/` — DebugBridgeService, ProductService, etc.
  - `Irrigation/` — hydraulic model, coverage, uniformity
- `src/RaindropTests/` — NUnit tests
- `AGENTS.md` — repo guidelines (tabs, naming, build configs, commit style)

## Key Patterns

- **Dual-platform**: `#if BRX_APP` / `#elif ACAD_APP` at top of most files for Teigha vs Autodesk usings
- **Tabs** for indentation (per AGENTS.md)
- **XData/XRecords**: CAD entity metadata via `XData.ReadXData`/`WriteXData` with app names defined in `AID_AppName.cs`
- **Transaction model**: All DB reads/writes inside `using (Transaction tr = ...)`. Lock the document first for write operations: `Active.Document.LockDocument()`
- **Transient graphics**: `TransientManager` for live previews during jigs (group IDs: 128 for pipes, 137 for tweak coverage)
- **Plant labels**: MLeaders with text `"{abbreviation} ({qty})"`, created by `PlantFactory.LabelPlants()`
- **Symbol redefine**: `Blocks.RedefineBlockFromSymbol()` updates all block instances when geometry changes

## Style Notes

- Settings via `SettingsFactory.Settings.General.*` (not the obsolete `AID_Settings`)
- `Active.Database`, `Active.Editor`, `Active.Document` — static accessors to the current CAD context
- `Sprinkler`, `SprinklerDefinition`, `Plant`, `PlantDefinition` — core domain types
