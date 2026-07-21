# MCP Apps — Canonical Example

The smallest working `fa-mcp-sdk` server that ships an MCP App: one tool, one UI
resource, one self-contained widget. Use it as the reference when adding MCP
Apps to your own server.

## Layout

```
examples/mcp-apps-canonical/
├── server.ts            # registers one tool + one ui:// resource
├── widget/
│   └── index.html       # the View (vanilla HTML+JS, no build step)
└── README.md
```

- **`server.ts` (`tools[]`, `customResources[]`)** — read this first. It shows
  the exact `_meta.ui.resourceUri` link from a tool to its widget and how to
  serve the widget through `customResources` with mime type
  `text/html;profile=mcp-app`.
- **`widget/index.html`** — implements the MCP Apps View handshake
  (`ui/initialize` → `ui/notifications/initialized` → `ui/notifications/tool-result`)
  and a button that triggers `tools/call` from inside the iframe. Everything is
  inlined so the widget runs under the spec's restrictive default CSP.

## Run

```bash
npm install
npm run example:mcp-apps
```

The script starts the server on port **7080** (overriding the parent project's
default via `WS_PORT=7080`).

1. Open <http://localhost:7080/agent-tester>.
2. Toggle the **Apps** checkbox in the header to advertise MCP Apps capability.
3. Ask: `What time is it?`
4. The agent calls `get-time`; the widget appears under the assistant message
   and shows the timestamp. Press **Refresh** to call the tool again from the
   widget without going through the LLM.

## What to copy into your own server

1. **`tools[i]._meta.ui.resourceUri`** — `server.ts`, the `tools` array. Points
   the tool at the widget. Without this, the host renders nothing.
2. **`customResources[i]`** — `server.ts`, the `customResources` array. Serves
   the `ui://` HTML; the `mimeType` MUST be the constant
   `MCP_APPS_RESOURCE_MIME_TYPE`. Use `content: async () => fs.readFile(...)`
   for file-backed widgets or `content: '<html>...</html>'` for tiny inline ones.
3. **Widget handshake** — `widget/index.html`, ~50 lines below the styles. Every
   MCP Apps widget MUST send `ui/initialize` then `ui/notifications/initialized`
   before reading `ui/notifications/tool-result`. Use `tools/call` from the View
   for user-driven server calls.

## Capability fallback

The spec requires a meaningful text response even for hosts that don't render
widgets. `get-time` always returns the timestamp in `structuredContent` /
`content[]` — the widget is a progressive enhancement. Use `getUiCapability`
from `fa-mcp-sdk` to branch handlers when the UI-vs-text divergence is larger
than a couple of formatting tweaks.
