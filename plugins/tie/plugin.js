/**
 * TIE — live Conductor web view for Hermes Desktop.
 *
 * Adds a "TIE" row to the left sidebar nav (directly below Kanban) that opens a
 * real browser pane pointed at the live Conductor site.
 *
 * STATE PERSISTENCE: The <webview> is created once and kept alive in a persistent
 * overlay div at the document.body level. When the TIE route unmounts (user navigates
 * away), the overlay is hidden — NOT removed — so the webview retains its full
 * state: current URL, scroll position, form input, and session. When the user
 * navigates back to TIE, the overlay is repositioned and shown again. No reload.
 *
 * The webview uses the same persistent partition as the app's preview pane
 * (`persist:hermes-preview`), so login cookies persist across restarts.
 *
 * Plain ESM, loaded uncompiled — UI is jsx() calls, not JSX syntax.
 * Imports: @hermes/plugin-sdk, react/jsx-runtime, react hooks.
 */

import {
  PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA, host
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useRef } from 'react'

const ID = 'tie'
// Live Conductor site (Tailscale host). Same persistent partition as the
// preview pane so the session is shared and stays logged in.
const SITE_URL = 'http://tie-conductor'
const PREVIEW_PARTITION = 'persist:hermes-preview'

// --- Persistent webview layer ---
// Created on first mount, kept alive at document.body level across route changes.
// The webview element is never removed from the DOM, so Electron keeps its
// guest contents (page state, session, scroll) alive between visits.
let _layer = null     // overlay <div> — positioned over the mount element
let _webview = null   // the <webview> element
let _currentUrl = SITE_URL

function ensureLayer () {
  if (_layer) return _layer

  _layer = document.createElement('div')
  _layer.style.cssText =
    'position:fixed;left:0;top:0;width:0;height:0;z-index:9998;' +
    'pointer-events:none;opacity:0;overflow:hidden;' +
    'transition:opacity 120ms ease;'

  _webview = document.createElement('webview')
  _webview.setAttribute('partition', PREVIEW_PARTITION)
  _webview.setAttribute(
    'webpreferences',
    'contextIsolation=yes,nodeIntegration=no,sandbox=yes'
  )
  _webview.style.cssText = 'width:100%;height:100%;border:0;display:block;'
  _webview.src = _currentUrl

  // Track where the webview is so "Open in browser" opens the right page
  _webview.addEventListener('did-navigate', (e) => { _currentUrl = e.url })
  _webview.addEventListener('did-navigate-in-page', (e) => { _currentUrl = e.url })

  _layer.appendChild(_webview)
  document.body.appendChild(_layer)

  return _layer
}

function reloadWebView () {
  if (_webview) _webview.reload()
}

function TieWebView ({ ctx }) {
  // The mount div is a placeholder — the actual webview lives in the persistent
  // overlay. We use this div only to measure position/size for the overlay.
  const mountRef = useRef(null)

  useEffect(() => {
    const el = mountRef.current
    if (!el) return

    const layer = ensureLayer()

    // Position the overlay to exactly cover the mount element
    const sync = () => {
      const r = el.getBoundingClientRect()
      layer.style.left = r.left + 'px'
      layer.style.top = r.top + 'px'
      layer.style.width = r.width + 'px'
      layer.style.height = r.height + 'px'
    }
    sync()

    // Keep the overlay aligned if the layout shifts (sidebar toggle, resize, etc.)
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    window.addEventListener('resize', sync)

    // Reveal the overlay
    layer.style.pointerEvents = 'auto'
    layer.style.opacity = '1'

    return () => {
      // Hide — do NOT remove. The webview stays alive in the overlay.
      ro.disconnect()
      window.removeEventListener('resize', sync)
      layer.style.pointerEvents = 'none'
      layer.style.opacity = '0'
    }
  }, [])

  return jsxs('div', {
    className: 'flex h-full w-full min-h-0 flex-col',
    children: [
      jsxs('div', {
        className:
          'flex items-center gap-1 border-b border-(--ui-stroke-secondary) px-2 py-1.5',
        children: [
          jsx('span', {
            className: 'text-[11px] font-medium text-(--ui-text-primary)',
            children: 'TIE'
          }),
          jsx('span', {
            className:
              'hidden truncate text-[10px] text-(--ui-text-quaternary) sm:inline',
            children: SITE_URL
          }),
          jsx('div', { className: 'ml-auto' }),
          jsx('button', {
            type: 'button',
            title: 'Reload current page',
            className:
              'rounded px-2 py-1 text-xs text-(--ui-text-secondary) hover:bg-(--chrome-action-hover)',
            onClick: reloadWebView,
            children: 'Reload'
          }),
          jsx('button', {
            type: 'button',
            title: 'Open current page in browser',
            className:
              'rounded px-2 py-1 text-xs text-(--ui-accent) hover:bg-(--chrome-action-hover)',
            onClick: () => { void ctx.os.openExternal(_currentUrl || SITE_URL) },
            children: 'Open in browser ↗'
          })
        ]
      }),
      // Placeholder div — the webview overlay positions itself over this
      jsx('div', { ref: mountRef, className: 'flex h-full w-full flex-1 min-h-0' })
    ]
  })
}

export default {
  id: ID,
  name: 'TIE',
  description: 'Live Conductor web view — remembers where you left off.',
  register (ctx) {
    ctx.register({
      id: 'page',
      area: ROUTES_AREA,
      title: 'TIE',
      data: { path: '/tie' },
      render: () => jsx(TieWebView, { ctx })
    })
    ctx.register({
      id: 'nav',
      area: SIDEBAR_NAV_AREA,
      order: 60,
      data: { codicon: 'globe', label: 'TIE', path: '/tie' }
    })
    ctx.register({
      id: 'open',
      area: PALETTE_AREA,
      data: {
        id: 'tie.open',
        label: 'TIE: Open Conductor web',
        keywords: ['tie', 'conductor', 'business', 'web'],
        run: () => { host.navigate('/tie') }
      }
    })
  }
}
