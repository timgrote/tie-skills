# Transient / Non-Printing Visual Layers

Raindrop uses a recurring convention for layers that exist only to host transient visual
aids (paint-brush circles, arc-inference previews, uniformity coverage overlays). These
layers are never user-facing drawing content — they are non-plottable, always thawed/on,
and created via `Layers.MakeLayer(name, color, false)` so a frozen layer 0 or an off current
layer cannot hide the visual feedback.

## The pattern

```csharp
// Layer name follows the office-configured irrigation prefix (typically "IR-") so
// user-customized prefixes carry through. Use a static property, not a const, because
// the prefix is read from settings at access time.
private static string VisualLayerName =>
    SettingsFactory.Settings.General.IrrigationLayerPrefix + "<Suffix>";

// Ensure the layer exists and is thawed/on before any draw. Idempotent — safe to call
// in a constructor or at the top of a command. The `false` arg sets IsPlottable = false.
Layers.MakeLayer(VisualLayerName, <colorIndex>, false);

// Assign the layer to every entity drawn via WorldGeometry.Draw() so it does not
// inherit the current drawing layer (which may be frozen/off).
entity.Layer = VisualLayerName;
```

`Layers.MakeLayer` (Layers.cs:29) is the canonical helper. When the layer already exists
it thaws it and turns it on (lines 55-56), so calling it every run is safe and also
self-heals a layer the user previously froze. It returns `bool` (valid name?) but the
return value is rarely checked — the layer is created as a side effect.

## Existing instances (use as templates)

| Layer | Location | Color | Suffix |
|-------|----------|-------|--------|
| `IR-PaintVisual` | `Jigs/PaintPipeJig.cs` (issue #695) | 3 (green) | `PaintVisual` |
| `IRR-ArcInference` | `CAD Commands/Commands.ArcInference.cs:37` | 6 (magenta) | (hardcoded prefix, not from settings) |
| `<prefix>Uniformity` | `Irrigation/Uniformity/UniformityRenderer.cs:32` | 7 (white) | `Uniformity` |

Note: `ARC_INFERENCE_LAYER` is a `const string` with a hardcoded `"IRR-"` prefix rather
than using `IrrigationLayerPrefix` — it predates the settings-driven prefix. New layers
should follow the `PaintVisual` / `Uniformity` pattern (settings-driven prefix) instead.

## When to apply this pattern

- Any `DrawJig.WorldDraw` that calls `wg.Draw(entity)` without setting `entity.Layer` —
  the entity inherits the current layer and disappears if that layer is frozen/off.
- Any preview/overlay that is not drawing content (arcs, circles, text shown during a
  command, removed when the command ends).
- Issue #695 was the canonical case: the paint-pipe brush circle vanished when layer 0
  was frozen because `_brushCircle` had no `Layer` assignment.

## Audit tip

To find other jigs/draw commands with the same latent bug, search for `wg.Draw(` calls
where the drawn entity has no `.Layer =` set and no `Layer =` in its object initializer.
