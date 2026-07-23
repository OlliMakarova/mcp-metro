// MCP Apps UI resource of the route widget (ui://mos-metro/routes.html).
//
// The widget is a self-contained HTML file (src/tools/metro/routes-widget.html) served to
// MCP Apps hosts via resources/read. The build copies it next to the compiled module in
// dist/ (scripts/copy-assets.js); when running from sources (tsx) the file is read from
// the module directory itself, so both layouts resolve to the same relative path.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { IResourceData, MCP_APPS_RESOURCE_MIME_TYPE } from 'fa-mcp-sdk';

/** ui:// URI the metro_info tool advertises in its `_meta.ui.resourceUri` */
export const ROUTES_WIDGET_URI = 'ui://mos-metro/routes.html';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Widget HTML locations: next to the compiled module (dist) and the source tree fallback */
const WIDGET_CANDIDATES = [
  path.join(THIS_DIR, 'routes-widget.html'),
  path.join(THIS_DIR, '..', '..', '..', '..', 'src', 'tools', 'metro', 'routes-widget.html'),
];

let cachedHtml: string | null = null;

const readWidgetHtml = async (): Promise<string> => {
  if (cachedHtml !== null) {
    return cachedHtml;
  }
  for (const candidate of WIDGET_CANDIDATES) {
    try {
      cachedHtml = await fs.readFile(candidate, 'utf-8');
      return cachedHtml;
    } catch {
      // try the next location
    }
  }
  throw new Error(`Route widget HTML not found; looked in: ${WIDGET_CANDIDATES.join('; ')}`);
};

/** The ui:// resource entry for customResources[] */
export const routesWidgetResource: IResourceData = {
  uri: ROUTES_WIDGET_URI,
  name: 'mos-metro-routes-widget',
  description: 'MCP Apps widget that renders Moscow Metro route variants returned by the metro_info tool.',
  mimeType: MCP_APPS_RESOURCE_MIME_TYPE,
  content: () => readWidgetHtml(),
  _meta: {
    ui: {
      preferredFrameSize: ['100%', '520px'],
    },
  },
};
