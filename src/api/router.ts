// REST API of the metro MCP server.
//
// Three endpoints (routes) on top of the same data layer used by the MCP tool:
//   GET /api/stations/search  — fuzzy station search by name;
//   GET /api/stations/info     — exhaustive station details;
//   GET /api/routes            — up to 4 shortest routes between stations.
//
// Each route is protected by rate limiting based on RateLimiterMemory from the
// rate-limiter-flexible library — the same one the SDK uses for the MCP endpoint.
// The limit is counted per client IP address; when exceeded, HTTP 429
// (Too Many Requests) is returned with a Retry-After header.

import { Request, Response, Router } from 'express';
import { RateLimiterMemory } from 'rate-limiter-flexible';

import { appConfig, createAuthMW, logger } from 'fa-mcp-sdk';

import { CustomAppConfig } from '../_types_/custom-config.js';
import { getMetroDatasetOrNull } from '../lib/metro-data/cache.js';
import { hideSourceNames } from '../lib/metro-data/public-source.js';
import { findBestRoutes } from '../lib/routing/find-routes.js';
import { resolveStation } from '../lib/station-search/resolve-station.js';
import { fuzzySearchStations } from '../lib/station-search/search-stations.js';
import { getStationClusters } from '../lib/station-search/station-clusters.js';
import { buildStationInfo } from '../lib/station-info.js';

// Real data source names are confidential: internal error texts are scrubbed of them
// before being sent to the client (the original goes to the log above)
const publicErrorText = (error: unknown): string =>
  error instanceof Error ? hideSourceNames(error.message) : 'Unknown error';

export const apiRouter: Router | null = Router();

const authMW = createAuthMW();

// ─── Rate limiting ───────────────────────────────────────────────────────────

const DEFAULT_MAX_REQUESTS = 60;
const DEFAULT_WINDOW_SEC = 60;

const restRateLimitCfg = (appConfig as CustomAppConfig).restApi?.rateLimit ?? {};
const rateLimiter = new RateLimiterMemory({
  points: restRateLimitCfg.maxRequests ?? DEFAULT_MAX_REQUESTS,
  duration: restRateLimitCfg.windowSec ?? DEFAULT_WINDOW_SEC,
});

/** Rate-limit key — the client's IP address */
const clientKey = (req: Request): string => req.ip ?? req.socket.remoteAddress ?? 'unknown';

/** Rate-limiting middleware: consumes one point per request */
const rateLimitMW = async (req: Request, res: Response, next: (err?: unknown) => void): Promise<void> => {
  try {
    await rateLimiter.consume(clientKey(req));
    next();
  } catch (rejection: any) {
    const retryAfterSec = Math.ceil((rejection?.msBeforeNext ?? 1000) / 1000);
    res.setHeader('Retry-After', String(retryAfterSec));
    res.status(429).json({
      success: false,
      error: 'Превышен лимит частоты запросов. Повторите позже.',
      retryAfterSec,
    });
  }
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns the active dataset or responds with 503 when no data is available */
const requireDataset = (res: Response) => {
  const dataset = getMetroDatasetOrNull();
  if (!dataset) {
    res.status(503).json({
      success: false,
      error: 'Данные метро временно недоступны: источники не отвечают и локальной копии нет.',
    });
    return null;
  }
  return dataset;
};

const parseIntParam = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(n)));
};

// ─── Route 1: fuzzy station search ───────────────────────────────────────────

apiRouter.get('/stations/search', rateLimitMW, authMW, (req: Request, res: Response) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) {
      res.status(400).json({ success: false, error: 'Не задан параметр q (название станции).' });
      return;
    }
    const dataset = requireDataset(res);
    if (!dataset) {
      return;
    }
    const limit = parseIntParam(req.query.limit, 8, 1, 50);
    const clusters = getStationClusters(dataset);
    const matches = fuzzySearchStations(dataset, q, { limit }).map((m) => ({
      id: m.station.id,
      name: m.station.name.ru,
      nameEn: m.station.name.en ?? null,
      lineId: m.station.lineId,
      lineName: m.line?.name?.ru ?? null,
      lineKind: m.line?.kind ?? null,
      clusterId: clusters.clusterOf(m.station.id),
      score: Number(m.score.toFixed(4)),
    }));
    res.json({ success: true, query: q, count: matches.length, results: matches });
  } catch (error) {
    logger.error('REST /stations/search error:', error);
    res.status(500).json({ success: false, error: publicErrorText(error) });
  }
});

// ─── Route 2: station details ────────────────────────────────────────────────

apiRouter.get('/stations/info', rateLimitMW, authMW, (req: Request, res: Response) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) {
      res.status(400).json({ success: false, error: 'Не задан параметр q (название станции).' });
      return;
    }
    const dataset = requireDataset(res);
    if (!dataset) {
      return;
    }
    const resolution = resolveStation(dataset, q);
    if (resolution.kind === 'not_found') {
      res.status(404).json({ success: false, resolved: false, reason: 'not_found', query: q });
      return;
    }
    if (resolution.kind === 'ambiguous') {
      // Ambiguity: several stations matched — return the option list for clarification (HTTP 300)
      res
        .status(300)
        .json({ success: false, resolved: false, reason: 'ambiguous', query: q, options: resolution.options });
      return;
    }
    const info = buildStationInfo(dataset, resolution.option.ids);
    res.json({ success: true, resolved: true, station: info });
  } catch (error) {
    logger.error('REST /stations/info error:', error);
    res.status(500).json({ success: false, error: publicErrorText(error) });
  }
});

// ─── Route 3: route search ───────────────────────────────────────────────────

apiRouter.get('/routes', rateLimitMW, authMW, (req: Request, res: Response) => {
  try {
    const from = String(req.query.from ?? '').trim();
    const to = String(req.query.to ?? '').trim();
    if (!from || !to) {
      res.status(400).json({ success: false, error: 'Нужны параметры from и to (названия станций).' });
      return;
    }
    const dataset = requireDataset(res);
    if (!dataset) {
      return;
    }
    const k = parseIntParam(req.query.k, 4, 1, 4);

    const r1 = resolveStation(dataset, from);
    const r2 = resolveStation(dataset, to);
    if (r1.kind !== 'resolved' || r2.kind !== 'resolved') {
      res.status(300).json({
        success: false,
        resolved: false,
        reason: 'clarification_required',
        from: r1.kind === 'resolved' ? { resolved: true, name: r1.option.name } : { resolved: false, ...r1 },
        to: r2.kind === 'resolved' ? { resolved: true, name: r2.option.name } : { resolved: false, ...r2 },
      });
      return;
    }
    if (r1.option.clusterId === r2.option.clusterId) {
      res
        .status(400)
        .json({ success: false, error: 'Станции отправления и прибытия совпадают.', station: r1.option.name });
      return;
    }
    const result = findBestRoutes(dataset, r1.option.ids, r2.option.ids, { k });
    res.json({ success: true, from: r1.option.name, to: r2.option.name, ...result });
  } catch (error) {
    logger.error('REST /routes error:', error);
    res.status(500).json({ success: false, error: publicErrorText(error) });
  }
});
