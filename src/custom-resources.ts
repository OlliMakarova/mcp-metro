import { IResourceData } from 'fa-mcp-sdk';

export const customResources: IResourceData[] = [
  {
    uri: 'custom-resource://resource1',
    name: 'Custom Resource',
    description: 'Custom resource description',
    mimeType: 'text/plain',
    content: 'Custom resource content',
  },
  // Binary resource example (standard §11.4 / §12.2). Declare `content` as
  // { blob: Buffer | base64-string }; the SDK returns it as base64 `contents[0].blob` with the
  // resource's `mimeType` (no `text` field). Here a 1×1 transparent PNG passed as base64
  // (base64: true). To serve raw bytes instead, set `content: { blob: fs.readFileSync(path) }`.
  {
    uri: 'custom-resource://logo.png',
    name: 'Sample binary resource',
    description: 'Example PNG returned as a base64 blob',
    mimeType: 'image/png',
    content: {
      blob: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      base64: true,
    },
  },
];
