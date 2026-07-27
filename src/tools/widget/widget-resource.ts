// MCP Apps UI resource of the route widget (ui://metro/routes.<hash>.html).
//
// The widget is a self-contained HTML file (routes-widget.html) served to MCP Apps hosts via
// resources/read. The build copies it next to the compiled module in dist/ (scripts/copy-assets.js);
// when running from sources (tsx) the file is read from the module directory itself, so both layouts
// resolve to the same relative path.
//
// The URI is versioned by the widget's content hash: `ui://metro/routes.<hash>.html`. Hosts that
// cache HTML by URI indefinitely (the universal mem-bot host) re-read it only when the widget really
// changes. The HTML is therefore read synchronously at module initialization — the URI must be ready
// before the tool definition (which advertises it in `_meta.ui.resourceUri`) is formed.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { IResourceData, MCP_APPS_RESOURCE_MIME_TYPE } from 'fa-mcp-sdk';

import { getPublicBaseUrl } from './widget-data-link.js';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Widget HTML locations: next to the compiled module (dist) and the source tree fallback */
const WIDGET_CANDIDATES = [
  path.join(THIS_DIR, 'routes-widget.html'),
  path.join(THIS_DIR, '..', '..', '..', '..', 'src', 'tools', 'widget', 'routes-widget.html'),
];

/** Reads the widget HTML synchronously from the first existing candidate location */
const readWidgetHtmlSync = (): string => {
  for (const candidate of WIDGET_CANDIDATES) {
    try {
      return fs.readFileSync(candidate, 'utf-8');
    } catch {
      // try the next location
    }
  }
  throw new Error(`Route widget HTML not found; looked in: ${WIDGET_CANDIDATES.join('; ')}`);
};

const WIDGET_HTML = readWidgetHtmlSync();

/** Short content hash (first 8 hex of sha256) — the version segment of the ui:// URI */
const WIDGET_HASH = createHash('sha256').update(WIDGET_HTML).digest('hex').slice(0, 8);

/** Versioned ui:// URI the metro_info tool advertises in its `_meta.ui.resourceUri` */
export const ROUTES_WIDGET_URI = `ui://metro/routes.${WIDGET_HASH}.html`;

/**
 * `connect-src` source for the sandbox CSP: the widget's only network request is a fetch to the
 * public base origin. Spec hosts (Claude Desktop) build the iframe CSP from this, so without it the
 * single data fetch would be blocked.
 */
const connectSrc = new URL(getPublicBaseUrl()).origin;

const widgetMeta = {
  ui: {
    csp: { 'connect-src': [connectSrc] },
    preferredFrameSize: ['100%', '520px'] as [string, string],
  },
};

/** The ui:// resource entry for customResources[] */
export const routesWidgetResource: IResourceData = {
  uri: ROUTES_WIDGET_URI,
  name: 'metro-routes-widget',
  description:
    'MCP Apps widget that renders Moscow or Saint Petersburg Metro route variants returned by the metro_info tool.',
  mimeType: MCP_APPS_RESOURCE_MIME_TYPE,
  content: () => WIDGET_HTML,
  _meta: widgetMeta,
};
