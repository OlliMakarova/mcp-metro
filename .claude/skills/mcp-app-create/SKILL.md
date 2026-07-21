---
name: mcp-app-create
description: This skill should be used when the user asks to "create an MCP App", "add a UI to an MCP tool", "build an interactive MCP View", "scaffold an MCP App", or needs guidance on MCP Apps SDK patterns, UI-resource registration, MCP App lifecycle, or host integration. Provides comprehensive guidance for building MCP Apps with interactive UIs.
---

# Create MCP App

Build interactive UIs that run inside MCP-enabled hosts like Claude Desktop. An MCP App combines an MCP tool with an HTML resource to display rich, interactive content.

## Core Concept: Tool + Resource

Every MCP App requires two parts linked together:

1. **Tool** - Called by the LLM/host, returns data
2. **Resource** - Serves the bundled HTML UI that displays the data

The tool's `_meta.ui.resourceUri` references the resource's URI.

Host calls tool → Host renders resource UI → Server returns result → UI receives result.

## Quick Start Decision Tree

### Framework Selection

| Framework | `@modelcontextprotocol/ext-apps` Support | Best For |
|-----------|-------------|----------|
| React | `useApp` hook provided | Teams familiar with React |
| Vanilla JS | Manual lifecycle | Simple apps, no build complexity |
| Vue/Svelte/Preact/Solid | Manual lifecycle | Framework preference |

### Project Context

**Adding to existing MCP server:**
- Import `registerAppTool`, `registerAppResource` from `@modelcontextprotocol/ext-apps`
- Add tool registration with `_meta.ui.resourceUri`
- Add resource registration serving bundled HTML

**Creating new MCP server:**
- Set up server with transport (stdio or HTTP)
- Register tools and resources
- Configure build system with `vite-plugin-singlefile`

## Getting Reference Code

Clone or update the MCP Apps SDK repository (`@modelcontextprotocol/ext-apps`) using the bundled
helper. The folder `./mcp-ext-apps/` is already in `.gitignore` and is intentionally persistent —
it serves as the long-lived reference checkout that this skill (and the `mcp-app-add-to-server`
skill) read from. Do not delete it after use.

```bash
node scripts/clone-mcp-ext-apps.js --tag latest
```

The script clones into `./mcp-ext-apps/` on first run, pulls the default branch on subsequent
runs, and (with `--tag latest`) checks out the latest released npm tag so the cloned tree
matches the published `@modelcontextprotocol/ext-apps` version. Add `--json` to capture machine-
readable metadata (path, ref, commit) for downstream automation.

### Protocol Specification

The formal MCP Apps spec lives in the same repository — read it for authoritative protocol
semantics that source files and examples only illustrate:

| File | Contents |
|------|----------|
| `./mcp-ext-apps/specification/2026-01-26/apps.mdx` | **SEP-1865** (Stable, 2026-01-26) — `ui://` URI scheme, `_meta.ui` contract, iframe sandboxing, host↔UI JSON-RPC messages, security model |

**Where to look first:**

- For **protocol questions** (wire format, required `_meta` keys, mandatory host/server behaviors,
  message semantics) — consult `./mcp-ext-apps/specification/2026-01-26/apps.mdx`. The spec is the source of
  truth for what MUST happen.
- For **TypeScript API questions** (which helper to call, handler signatures, idiomatic usage) —
  consult `@modelcontextprotocol/ext-apps` sources under `./mcp-ext-apps/src/` and its examples.
  The package is the source of truth for *how* to invoke the protocol from code.

### Framework Templates

Learn and adapt from `./mcp-ext-apps/examples/basic-server-{framework}/`:

| Template | Key Files |
|----------|-----------|
| `basic-server-vanillajs/` | `server.ts`, `src/mcp-app.ts`, `mcp-app.html` |
| `basic-server-react/` | `server.ts`, `src/mcp-app.tsx` (uses `useApp` hook) |
| `basic-server-vue/` | `server.ts`, `src/App.vue` |
| `basic-server-svelte/` | `server.ts`, `src/App.svelte` |
| `basic-server-preact/` | `server.ts`, `src/mcp-app.tsx` |
| `basic-server-solid/` | `server.ts`, `src/mcp-app.tsx` |

Each template includes:
- `server.ts` with `registerAppTool` and `registerAppResource`
- `main.ts` entry point with HTTP and stdio transport setup
- Client-side app (e.g., `src/mcp-app.ts`, `src/mcp-app.tsx`) with lifecycle handlers
- `src/global.css` with global styles and host style variable fallbacks
- `vite.config.ts` using `vite-plugin-singlefile`
- `package.json` with `npm run` scripts and required dependencies
- `.gitignore` excluding `node_modules/` and `dist/`

### Domain-Specific Examples

When the App's UI matches one of these domains, consult the corresponding example for patterns
the basic templates don't cover. All paths are under `./mcp-ext-apps/`:

| Domain | Example | What it shows |
|---|---|---|
| Charts / dashboards | `examples/scenario-modeler-server/` | Chart.js with structured React (`hooks/`, `lib/`, `components/`); multi-scenario comparison |
| Analytics drill-down | `examples/cohort-heatmap-server/` | Heatmap with hover tooltips and click drilldown (React) |
| 3D visualization | `examples/threejs-server/` | Three.js + streaming tool input into canvas, OrbitControls, post-processing |
| WebGL / shaders | `examples/shadertoy-server/` | GLSL live compilation, fullscreen mode, `vendor/` pattern for custom JS libs |
| Graph visualization | `examples/wiki-explorer-server/` | 3D force-directed graph (`force-graph`), web scraping with `cheerio` |
| Audio / music | `examples/sheet-music-server/` | ABC notation → SVG render + MIDI synthesis (`abcjs`) |
| Streaming + audio | `examples/say-server/` | `ontoolinputpartial` + async audio queue + multi-view lock (**Python FastMCP**) |
| Browser APIs | `examples/transcript-server/` | Web Speech API for live transcription |
| Binary / media resources | `examples/video-resource-server/` | Base64 video blobs, `ResourceTemplate`, large-payload limits |
| SDK surface reference | `examples/debug-server/` | All content types in one place — PNG/WAV blobs, structured output, stateful counter, resource downloads |

### API Reference (Source Files)

Read JSDoc documentation directly from `./mcp-ext-apps/src/`:

| File | Contents |
|------|----------|
| `src/app.ts` | `App` class, handlers (`ontoolinput`, `ontoolresult`, `onhostcontextchanged`, `onteardown`, etc.), lifecycle |
| `src/server/index.ts` | `registerAppTool`, `registerAppResource`, helper functions |
| `src/spec.types.ts` | All type definitions: `McpUiHostContext`, `McpUiStyleVariableKey` (CSS variable names), `McpUiResourceCsp` (CSP configuration), etc. |
| `src/styles.ts` | `applyDocumentTheme`, `applyHostStyleVariables`, `applyHostFonts` |
| `src/react/useApp.tsx` | `useApp` hook for React apps |

### Advanced Patterns

See `./mcp-ext-apps/docs/patterns.md` for detailed recipes:

- **App-only tools** — `visibility: ["app"]`, hiding tools from model
- **Polling** — real-time dashboards, interval management
- **Chunked responses** — large files, pagination, base64 encoding
- **Error handling** — `isError`, informing model of failures
- **Binary resources** — audio/video/etc via `resources/read`, blob field
- **Network requests** — assets, fetch, CSP, `_meta.ui.csp`, CORS, `_meta.ui.domain`
- **Host context** — theme, styling, fonts, safe area insets
- **Fullscreen mode** — `requestDisplayMode`, display mode changes
- **Model context** — `updateModelContext`, `sendMessage`, keeping model informed
- **View state** — `viewUUID`, localStorage, state recovery
- **Visibility-based pause** — IntersectionObserver, pausing animations/WebGL
- **Streaming input** — `ontoolinputpartial`, progressive rendering

### Reference Host Implementation

`./mcp-ext-apps/examples/basic-host/` shows one way an MCP Apps-capable host could be implemented. Real-world hosts like Claude Desktop are more sophisticated—use basic-host for local testing and protocol understanding, not as a guarantee of host behavior.

## Critical Implementation Notes

### Adding Dependencies

**Always** use `npm install` to add dependencies rather than manually writing version numbers:

```bash
npm install @modelcontextprotocol/ext-apps @modelcontextprotocol/sdk zod express cors
npm install -D typescript vite vite-plugin-singlefile concurrently cross-env @types/node @types/express @types/cors
```

This lets npm resolve the latest compatible versions. **Never** specify version numbers from memory.

### TypeScript Server Execution

Unless the user has specified otherwise, use `tsx` for running TypeScript server files. For example:

```bash
npm install -D tsx

npm pkg set scripts.dev="cross-env NODE_ENV=development concurrently 'cross-env INPUT=mcp-app.html vite build --watch' 'tsx --watch main.ts'"
```

> [!NOTE]
> The `@modelcontextprotocol/ext-apps` examples use `bun` but generated projects should default to `tsx` for broader compatibility.

### Handler Registration Order

Register ALL handlers BEFORE calling `app.connect()`:

```typescript
const app = new App({ name: "My App", version: "1.0.0" });

// Register handlers first
app.ontoolinput = (params) => { /* handle input */ };
app.ontoolresult = (result) => { /* handle result */ };
app.onhostcontextchanged = (ctx) => { /* handle context */ };
app.onteardown = async () => { return {}; };
// etc.

// Then connect
await app.connect();
```

## Common Mistakes to Avoid

1. **No text fallback** - Always provide `content` array for non-UI hosts
2. **Missing CSP configuration** - MCP Apps HTML is served as an MCP resource with no same-origin server; ALL network requests—even to `localhost`—require a CSP configuration
3. **CSP or CORS config in wrong _meta object** - `_meta.ui.csp` and `_meta.ui.domain` go in the `contents[]` objects returned by `registerAppResource()`'s read callback, not in `registerAppResource()`'s config object
4. **Handlers after app.connect()** - Register ALL handlers BEFORE calling `app.connect()`
5. **No streaming for large inputs** - Use `ontoolinputpartial` to show progress during input generation

## Testing

### Using basic-host

Test MCP Apps locally with the basic-host example:

```bash
# Terminal 1: Build and run your server
npm run build && npm run serve

# Terminal 2: Run basic-host (from cloned repo)
cd ./mcp-ext-apps/examples/basic-host
npm install
SERVERS='["http://localhost:3001/mcp"]' npm run start
# Open http://localhost:8080
```

Configure `SERVERS` with a JSON array of your server URLs (default: `http://localhost:3001/mcp`).

### Debug with sendLog

Send debug logs to the host application (rather than just the iframe's dev console):

```typescript
await app.sendLog({ level: "info", data: "Debug message" });
await app.sendLog({ level: "error", data: { error: err.message } });
```
