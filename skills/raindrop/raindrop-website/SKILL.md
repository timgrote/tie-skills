---
name: raindrop-website
description: "Edit the Raindrop marketing website in Raindrop-Website."
triggers:
  - Working on the Raindrop-Website repo (timgrote/Raindrop-Website)
  - Editing HTML/CSS/JS in C:\Users\tim\Raindrop-Website\docs\
  - Adding screenshots, logos, or assets to the Raindrop website
  - Updating nav, footer, favicon, or branding across site pages
---

# Raindrop Website

Static marketing site for Raindrop Irrigation Design Software. Hosted on GitHub Pages at `raindropirrigationsoftware.com`.

- **Repo:** `C:\Users\tim\Raindrop-Website\` (GitHub: timgrote/Raindrop-Website, private)
- **Site root:** `docs/` (GitHub Pages serves from `docs/`)
- **CNAME:** `docs/CNAME` → `raindropirrigationsoftware.com`
- **Status:** GitHub Pages enabled and serving (as of 2026-07-28); custom domain not yet pointed (still on WordPress)

## Site Structure

```
docs/
├── index.html       — Landing page (hero, features grid, testimonials, Enki coming-soon, CTA)
├── features.html    — Feature detail (6 feature rows with screenshot placeholders)
├── download.html    — Free trial download (steps, system requirements)
├── pricing.html     — $400/yr pricing card, "what's not included", FAQ
├── contact.html     — Contact form (mailto-based, no backend)
├── css/style.css     — Single stylesheet, CSS variables, ~610 lines
├── js/main.js       — Mobile nav toggle, contact form handler
├── assets/          — Images (logos, icons, screenshots)
└── CNAME            — raindropirrigationsoftware.com
```

## Critical: No Templating — All Shared Markup is Duplicated

**There are no includes, templates, or build steps.** The nav bar, footer, favicon, and brand mark are copy-pasted into all 5 HTML files. Any change to a shared element must be applied to **every page** in sync.

### Pages and their shared elements

| Element | Appears in | Count |
|---------|-----------|-------|
| `<link rel="icon">` (favicon) | All 5 pages, in `<head>` | 5 |
| Nav bar (`<nav class="nav">`) | All 5 pages | 5 |
| Footer (`<footer class="footer">`) | All 5 pages | 5 |
| Brand mark (`.brand-mark`) | Nav + footer on each page | 10 total |

### Workflow for shared-element changes

1. Read one page to find the exact string to replace.
2. Use `patch` with `replace_all=true` for identical instances within a single file.
3. **Check each page individually** — index.html sometimes has different whitespace formatting than the other 4 pages (e.g., nav brand mark spread across multiple lines vs. single line).
4. After patching, verify with `grep -rn` that zero old references remain and the expected count of new references exists.
5. Preview with `open_preview` on `docs/index.html`.

### Pitfall: index.html formatting differs

The nav brand mark in `index.html` was originally multi-line (SVG on its own indented line), while the other 4 pages had it on a single line. When doing replace_all, index.html may need a separate patch with different old_string whitespace. Always check before assuming all pages match.

## Assets

Assets live in `docs/assets/`. The folder was empty (just `.gitkeep`) until 2026-07-28.

### Logo files

Source logos are in `D:\Dropbox\Raindrop\Marketing\Logo\`:
- `Icon.png` — icon only (droplet + leaves, no text), 88 KB, white background
- `LogoWide.png` — horizontal lockup (icon + "Raindrop Irrigation Software" text), 17 KB
- `raindrop.ico` — favicon, 17 KB
- `Icon.psd`, `Banner Logo.psd`, `RD_LOGO_Black.psd` — PSD sources
- `MOCKUP_...ai/.eps` — original vector art

Currently in `docs/assets/`:
- `raindrop-icon.png` — the icon (copied from `Marketing/Logo/Icon.png`)
- `raindrop-icon-alt.png` — alternate icon (copied from `Marketing/Raindrop Icon.png`)
- `favicon.ico` — favicon (copied from `Marketing/Logo/raindrop.ico`)

**Note:** Logo PNGs have white (non-transparent) backgrounds. If a transparent version is needed for dark headers, extract from the PSD source.

## CSS Design System

`docs/css/style.css` uses CSS custom properties:
- `--accent`, `--accent-2` — brand blue/teal gradients
- `--border` — hairline border color
- `--text` — body text color
- Component classes: `.btn`, `.btn--primary`, `.btn--ghost`, `.btn--lg`, `.brand`, `.brand-mark`, `.feature`, `.shot`, `.testimonial`, `.faq-item`, `.price-card`, etc.

### Blueprint graph-paper background

The body has a two-layer grid texture giving a CAD / engineering-graph-paper feel:
```css
body {
  background-color: var(--bg);
  background-image:
    linear-gradient(rgba(43, 179, 192, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(43, 179, 192, 0.035) 1px, transparent 1px),
    linear-gradient(rgba(43, 179, 192, 0.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(43, 179, 192, 0.07) 1px, transparent 1px);
  background-size: 24px 24px, 24px 24px, 120px 120px, 120px 120px;
  background-position: -1px -1px;
}
```
Fine grid every 24px (3.5% opacity), bold grid every 120px (7% opacity). Subtle enough not to distract from content.

### Irrigation design watermark (hero only)

`index.html` has a decorative SVG watermark in the hero section showing pipe networks, sprinkler coverage arcs, sprinkler head markers, and POC/valve symbols — the kind of layout you'd see in an irrigation plan. It sits behind the hero content at 15% opacity.

Key CSS for the watermark to work behind a solid screenshot placeholder:
- `.hero-watermark` — `position: absolute; opacity: 0.15; z-index: 0; pointer-events: none;`
- `.hero-grid` — `position: relative; z-index: 1;` (content above watermark)
- `.shot` — `background: rgba(22,36,61,0.85); backdrop-filter: blur(2px);` (semi-transparent so watermark bleeds through)

The watermark SVG is inline in `index.html` (not a separate file) and hidden on mobile (`@media max-width: 900px`).

### .brand-mark styling

**Important:** Do NOT put the logo inside a badge/box. Tim specifically rejected the rounded badge background behind the logo — it was too close to the logo and looked wrong. The logo icon should sit cleanly on the page background with no background tile, no border-radius, no overflow:hidden clipping.

Current (after 2026-07-28 badge removal):
```css
.brand-mark {
  width: 36px; height: 36px;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.brand-mark img {
  width: 100%; height: 100%;
  object-fit: contain;
  border-radius: 0;
}
```

The `.brand` gap is 12px between the logo and the "Raindrop" text.

## Screenshot Workflow

Screenshots come from the marketing folder, not the website repo:

- **Source:** `D:\Dropbox\Raindrop Marketing\screenshots\` (Dropbox, shared with agents)
- **Destination:** `docs/assets/` (website repo)

### Process

1. Check what's in the marketing screenshots folder: `ls "D:/Dropbox/Raindrop Marketing/screenshots/"`
2. Check which placeholders remain in the HTML: `grep -n "shot__placeholder\|Replace with" docs/*.html`
3. Copy each screenshot to `docs/assets/` with a web-friendly filename (lowercase, hyphens, no spaces):
   ```bash
   cp "D:/Dropbox/Raindrop Marketing/screenshots/Sprinkler Grid.jpg" "docs/assets/sprinkler-grid.jpg"
   ```
4. Use `vision_analyze` on each new screenshot to understand what it shows — this helps write accurate `alt` text and match it to the right placeholder.
5. Replace the placeholder markup with an `<img>` tag. The placeholder structure is:
   ```html
   <div class="shot shot--hero">  <!-- or shot--tall, shot--wide -->
     <div class="shot__placeholder">
       <div>
         <strong>Screenshot: [Feature Name]</strong>
         [Description]
       </div>
     </div>
     <div class="shot__note">Replace with [description] screenshot</div>
   </div>
   ```
   Replace with:
   ```html
   <div class="shot shot--hero">
     <img class="shot__img" src="assets/[filename].jpg" alt="[descriptive alt text]">
   </div>
   ```
6. The `.shot__img` CSS class (added 2026-07-28) handles sizing: `width:100%; height:100%; object-fit:cover; display:block;`

### Screenshot-to-placeholder mapping (as of 2026-07-28)

| Placeholder | Page | Filled? | Source screenshot |
|-------------|------|---------|-------------------|
| Hero — Raindrop in AutoCAD | index.html | ✅ | `sprinkler-grid.jpg` |
| Sprinkler Grid Layout | features.html (Feature 1) | ✅ | `sprinkler-grid.jpg` |
| Mainline Analysis | features.html (Feature 2) | ❌ | — |
| Uniformity Heat-Map | features.html (Feature 3) | ❌ | — |
| Terrain Model | features.html (Feature 4) | ❌ | — |
| Planting Catalog | features.html (Feature 5) | ❌ | — |
| BOM / Excel Export | features.html (Feature 6) | ✅ | `inventory-bom.jpg` |
| Uniformity Heat-Map (strip) | index.html | ❌ | — |

A single screenshot can fill multiple placeholders if it's a strong match (e.g., the sprinkler grid shot works for both the hero and Feature 1).

### Pitfall: don't assume all placeholders need different images

One good AutoCAD screenshot showing coverage arcs can serve double duty. Match by what the screenshot actually shows, not by trying to find a unique image per slot.

## Known TODOs in the HTML

Search for these comment markers:
- `SCREENSHOT PLACEHOLDER` — some screenshot slots still need real images; see the Screenshot Workflow section above for current status (2 of 7 filled as of 2026-07-28)
- `Replace with screenshot` — `shot__note` divs describing what each screenshot should show (removed when placeholder is filled)
- `[Customer name — Tim to add]` — testimonials need real names (index.html)
- `TODO: Tim — replace this button` — download.html installer link is a placeholder `#` with alert()

## Git Workflow

- Static site, push to `master` to deploy (GitHub Pages)
- No build step needed — `docs/` is served as-is
- Commit message convention: descriptive of what changed across pages
- **Branch:** `master` (not `main`) — this repo uses `master` as its default branch

## GitHub Pages Deployment

Pages is enabled via the GitHub API (the repo is private, so Pages is only visible to collaborators until the custom domain is pointed):
```bash
gh api -X POST repos/timgrote/Raindrop-Website/pages -f source[branch]=master -f source[path]=/docs
```
Check build status:
```bash
gh api repos/timgrote/Raindrop-Website/pages/builds --jq '.[0] | {status, error, duration}'
```
Builds take ~30-60s; status goes `building` → `built`. Verify with `curl -sI https://timgrote.github.io/Raindrop-Website/` (expect `200` from `Server: GitHub.com`).

### Custom domain (CNAME) and the preview catch

`docs/CNAME` contains `raindropirrigationsoftware.com`. While that file is present, GitHub Pages **301-redirects** `timgrote.github.io/Raindrop-Website/` → `http://raindropirrigationsoftware.com/` — and that domain currently points at a **WordPress/Apache** host, not GitHub. This means:
- The github.io URL does NOT show your Pages content while CNAME is present; it bounces to the WordPress site.
- Sub-pages (`/features.html`, etc.) return 404 because they're served by WordPress, which doesn't have those routes.

### Previewing before DNS is pointed

To preview the GitHub Pages build at the github.io URL before the custom domain DNS is flipped:
1. **Temporarily remove CNAME:** `git rm docs/CNAME && git commit -m "Temporarily remove CNAME to allow preview at github.io URL" && git push origin master`
2. Wait for the Pages rebuild (~30-60s) — verify `curl -sI` returns `200` from `Server: GitHub.com` with no `Location` redirect header.
3. Preview at `https://timgrote.github.io/Raindrop-Website/` (or via `open_preview`).
4. **Re-add CNAME when done:** recreate `docs/CNAME` with the single line `raindropirrigationsoftware.com`, commit, push, wait for rebuild.

### Flipping the domain live (when ready)

1. Ensure `docs/CNAME` is present with `raindropirrigationsoftware.com`.
2. Update DNS: A records for the apex domain → GitHub Pages IPs (`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`), OR CNAME `www` → `timgrote.github.io`.
3. Once DNS propagates, GitHub Pages serves the site at the custom domain instead of WordPress.
4. Optionally enforce HTTPS in repo Settings → Pages → Enforce HTTPS (may take a few minutes to issue the cert after DNS resolves).

### Pitfall: curl -L follows the redirect to WordPress
When verifying Pages with `curl`, do NOT use `-L` (follow redirects) while CNAME is present — it will fetch the WordPress site and report `200`, masking the fact that Pages itself is redirecting. Use `curl -sI` (headers only, no follow) and check that `Server: GitHub.com` and there's no `Location:` header.

## List Item Dash Alignment (feature-row__text)

The feature lists on `features.html` use a `::before` pseudo-element to draw a 16×2px teal dash as the list marker (instead of a standard bullet). Getting it vertically centered on the first line of text was tricky — Tim pushed back on pixel-based and `vertical-align: middle` approaches.

### What does NOT work
- `position: absolute; top: Npx` — fragile, breaks when font size changes, and Tim specifically rejected it ("is there any way to align it without specifying pixels").
- `vertical-align: middle` on an `inline-block` `::before` — aligns to the middle of the *line box*, not the text's x-height. The dash sits too high (at cap height).

### What works
Use `vertical-align` with a **positive `em` value** to nudge the dash down to the text's x-height center. `em` scales with the font size, so no pixel values:

```css
.feature-row__text li {
  padding: 8px 0 8px 0;
  color: var(--text-dim);
}
.feature-row__text li::before {
  content: "";
  display: inline-block;
  vertical-align: 0.35em;   /* shifts down 35% of font size → centers on x-height */
  width: 16px; height: 2px;
  background: var(--accent);
  margin-right: 12px;
}
```

**Key insight:** `vertical-align` accepts length values (including `em`), not just keywords. A positive `em` value raises the baseline of the inline box, which effectively moves the dash *down* relative to the surrounding text. `0.35em` was the sweet spot for this font/line-height combination. Always verify visually with the browser tool after changing — the "right" value depends on the font's metrics.

## Pitfalls

### Forgetting to update all 5 pages
The most common mistake is updating a shared element (nav link, footer text, favicon) on one page and forgetting the other 4. Always grep-verify after patching shared elements.

### Windows path quirks in search_files
`search_files` may fail with "cannot find the path" on Windows paths. Use `terminal` with `grep -rn` as a fallback when search_files fails on this repo.

### Browser preview needs a local server
`browser_navigate` blocks `file://` URLs ("URL targets a private or internal address"). To preview the site in the browser tool, start a local HTTP server:
```bash
cd "C:/Users/tim/Raindrop-Website/docs" && python -m http.server 8765
```
Then navigate to `http://localhost:8765/index.html`. Kill the server process when done. `open_preview` (the in-app preview pane) does work with file paths directly and is fine for quick checks.
