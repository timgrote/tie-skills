# Raindrop Build & Deploy Reference

## Project Structure

- `src/raindrop/` — main CAD plugin (C#)
- `src/Logging/` — logging library
- `src/RaindropTests/` — NUnit tests
- `scripts/copy-binaries.sh` — manual deploy to bundle

## Build Config → CAD Version → Bundle Path

| VS Config | Output DLL | Bundle Subdir | CAD Version |
|-----------|-----------|---------------|-------------|
| `AutoCAD_Debug` | `Raindrop_AutoCAD.dll` | `Contents/` (root) | AutoCAD 2024 |
| `AutoCAD25_Debug` | `Raindrop_AutoCAD25.dll` | `Contents/2025/` | AutoCAD 2025+ |
| `BricsCAD_Debug` | `Raindrop_BricsCAD.dll` | BricsCAD bundle | BricsCAD V24 |

Tim's machine runs **AutoCAD 2027**, which uses the `AutoCAD25_Debug` config.

## Manual Deploy

```bash
# Close AutoCAD first (DLL is locked)
bash scripts/copy-binaries.sh AutoCAD25_Debug
```

## Key Source Files (Sprinkler Insert Flow)

| File | Purpose |
|------|---------|
| `Factories/SprinklerFactory.cs` | `UserPlaceSprinkler` — main insert loop |
| `Jigs/SprinklerJig.cs` | Placement drag jig |
| `CAD Commands/Commands.TweakCoverage.cs` | `TweakOneHead` — interactive aim/arc tweak |
| `Jigs/ArcTweakKeyFilter.cs` | IMessageFilter for Q/A/W/S/E during tweak |
| `Irrigation/Uniformity/CoverageTweak.cs` | Aim/radius math helpers |

## Key Source Files (Plant Labels)

| File | Purpose |
|------|---------|
| `Landscape/Planting/PlantDefinition.cs` | Plant definition + XData serialization |
| `Presentation/Settings/Planting/PlantingSettingsViewModel.cs` | `SaveChangesToActiveDrawing` |
| `Factories/PlantFactory.cs` | `LabelPlants` — creates MLeader labels |
| `Landscape/LandscapeLegend.cs` | Plant legend table |

## Git Branch Naming

- Feature: `feat/<issue#>-short-description`
- Base branch: `dev`
