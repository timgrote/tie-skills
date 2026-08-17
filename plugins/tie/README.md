# TIE Desktop Plugin

Live Conductor web view for the Hermes desktop app. Adds a "TIE" item to the
left sidebar (directly below Kanban) that opens the live Conductor site in a
browser pane beside the chat.

## Source of truth

This file (`plugins/tie/plugin.js`) is the canonical source. The live copy
lives at:

```
$HERMES_HOME/desktop-plugins/tie/plugin.js
```

Hermes loads plugins from that directory only — there's no config option to
point at a repo path. So after editing here, copy the file to the live location:

```bash
cp plugins/tie/plugin.js "$HERMES_HOME/desktop-plugins/tie/plugin.js"
```

Then ⌘K → **Reload desktop plugins** (or restart the app).

## Features

- **Persistent webview** — the `<webview>` is created once at `document.body`
  level and kept alive across route changes. Navigating away hides the overlay;
  coming back restores it. No page reload, so URL, scroll position, form input,
  and session all survive.
- **Shared session** — uses the same `persist:hermes-preview` partition as the
  app's preview pane, so login cookies persist across restarts.
- **Toolbar** — Reload current page, Open current page in browser.
