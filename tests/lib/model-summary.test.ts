// Unit tests for the concise model-context summary (buildModelSummary) and the "single source"
// guarantee: the widget-data payload's modelSummary is produced by the very same function, so the
// text the model gets on the first turn (tool content) matches what the widget later pushes via
// ui/update-model-context. The tool-handler wiring (content === summary) is verified end-to-end in
// tests/mcp/test-widget-data.js — handleMetroInfo cannot be loaded under jest (it imports fa-mcp-sdk).

import { describe, expect, it } from '@jest/globals';

import { findBestRoutes } from '../../src/lib/routing/find-routes.js';
import { buildModelSummary } from '../../src/tools/widget/model-summary.js';
import { buildRoutesWidgetData } from '../../src/tools/widget/widget-data.js';
import { AT_FIXTURE_DATE, getMosmetroDataset, stationIdsByName } from './helpers.js';

describe('buildModelSummary', () => {
  const ds = getMosmetroDataset();
  const from = stationIdsByName(ds, 'Университет');
  const to = stationIdsByName(ds, 'Комсомольская');
  const result = findBestRoutes(ds, from, to, { k: 3, at: AT_FIXTURE_DATE });

  it('produces a concise localized summary (ru) with the station names and minutes', () => {
    const summary = buildModelSummary(result, 'Университет', 'Комсомольская', 'ru');
    expect(summary.length).toBeGreaterThan(0);
    expect(summary).toContain('Университет');
    expect(summary).toContain('Комсомольская');
    expect(summary).toContain('мин');
    expect(summary).toContain('Метро Москвы');
    // Concise: one short line, not the full route markdown.
    expect(summary.length).toBeLessThan(400);
    expect(summary.split('\n').length).toBe(1);
  });

  it('localizes the summary (en)', () => {
    const summary = buildModelSummary(result, 'Universitet', 'Komsomolskaya', 'en');
    expect(summary).toContain('Moscow Metro route');
    expect(summary).toContain('min');
  });

  it('adds the walk-to-metro time to the fastest total and calls it out', () => {
    const base = buildModelSummary(result, 'Университет', 'Комсомольская', 'ru');
    const withWalk = buildModelSummary(result, 'Университет', 'Комсомольская', 'ru', 10);
    const baseMin = Number(/быстрейший ~(\d+) мин/.exec(base)![1]);
    const walkMin = Number(/быстрейший ~(\d+) мин/.exec(withWalk)![1]);
    expect(walkMin).toBe(baseMin + 10);
    expect(withWalk).toContain('включая ~10 мин пешком до метро');
    expect(base).not.toContain('пешком до метро');
  });

  it('is the single source: widget-data.modelSummary equals buildModelSummary on the same args', () => {
    const fromName = 'Университет';
    const toName = 'Комсомольская';
    const data = buildRoutesWidgetData(result, fromName, toName, 'ru');
    expect(data.modelSummary).toBe(buildModelSummary(result, fromName, toName, 'ru'));
    expect(data.walkToMetroSec).toBeUndefined();
  });

  it('widget-data carries the walk segment and a matching summary when walkMin is set', () => {
    const data = buildRoutesWidgetData(result, 'Университет', 'Комсомольская', 'ru', 10);
    expect(data.walkToMetroSec).toBe(600);
    expect(data.modelSummary).toBe(buildModelSummary(result, 'Университет', 'Комсомольская', 'ru', 10));
  });
});
