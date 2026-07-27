// Guards the list of ui:// addresses the route widget has been published under.
//
// A host stores the widget's address in the chat message and re-reads it every time the card is
// displayed. Drop an address and every card already in a user's history breaks — which is exactly
// what happened once and is invisible until users complain. This test derives the full set of
// addresses from the git history of the widget file and fails the moment one of them is missing
// from LEGACY_WIDGET_HASHES, so a forgotten entry surfaces while the change is still being made.
//
// It skips itself where git or the repository is unavailable (a tarball build, a shallow clone).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { LEGACY_WIDGET_HASHES, widgetUri } from '../../src/tools/widget/widget-uri-history.js';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WIDGET_PATH = 'src/tools/widget/routes-widget.html';

const shortHash = (html: string): string => createHash('sha256').update(html).digest('hex').slice(0, 8);

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** Hash of every committed version of the widget, or null when git cannot be consulted */
const publishedHashes = (): string[] | null => {
  try {
    const commits = git('log', '--format=%H', '--', WIDGET_PATH).trim().split('\n').filter(Boolean);
    return commits.map((commit) => shortHash(git('show', `${commit}:${WIDGET_PATH}`)));
  } catch {
    return null;
  }
};

const currentHash = shortHash(readFileSync(path.join(REPO_ROOT, WIDGET_PATH), 'utf-8'));

describe('route widget ui:// address history', () => {
  it('builds the address of a build from its content hash', () => {
    expect(widgetUri(currentHash)).toBe(`ui://mos-metro/routes.${currentHash}.html`);
  });

  it('keeps every previously published address serveable', () => {
    const published = publishedHashes();
    if (!published) {
      // Nothing to compare against — this environment has no git history of the file
      return;
    }
    const missing = published.filter((hash) => hash !== currentHash && !LEGACY_WIDGET_HASHES.includes(hash));
    expect(missing).toEqual([]);
  });

  it('does not list the current address as a legacy one', () => {
    expect(LEGACY_WIDGET_HASHES).not.toContain(currentHash);
  });

  it('has no duplicate entries', () => {
    expect(new Set(LEGACY_WIDGET_HASHES).size).toBe(LEGACY_WIDGET_HASHES.length);
  });
});
