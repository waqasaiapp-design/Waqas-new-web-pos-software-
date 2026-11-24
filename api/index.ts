import type { IncomingMessage, ServerResponse } from 'http';
import { createApiApp, flushPendingKvWrites } from '../serverApp.ts';

export const config = {
  maxDuration: 30,
};

type VercelRequest = IncomingMessage & {
  body?: any;
  query?: Record<string, string | string[] | undefined>;
  _body?: boolean;
  complete?: boolean;
  _readableState?: { ended?: boolean };
};

function normalizeVercelApiUrl(req: VercelRequest): void {
  const rawUrl = req.url || '/api';
  try {
    const parsed = new URL(rawUrl, 'https://localhost');

    if (parsed.searchParams.has('__api_path')) {
      const apiPath = (parsed.searchParams.get('__api_path') || '').replace(/^\/+/, '');
      parsed.searchParams.delete('__api_path');
      const qs = parsed.searchParams.toString();
      const targetPath = apiPath ? `/api/${apiPath}` : '/api';
      req.url = qs ? `${targetPath}?${qs}` : targetPath;
      return;
    }

    if (req.query && typeof req.query.__api_path === 'string') {
      const apiPath = req.query.__api_path.replace(/^\/+/, '');
      parsed.searchParams.delete('__api_path');
      const qs = parsed.searchParams.toString();
      const targetPath = apiPath ? `/api/${apiPath}` : '/api';
      req.url = qs ? `${targetPath}?${qs}` : targetPath;
      return;
    }

    if (parsed.pathname === '/api/index' || parsed.pathname === '/api/index.ts') {
      const qs = parsed.searchParams.toString();
      req.url = qs ? `/api?${qs}` : '/api';
    }
  } catch {
    if (!rawUrl.startsWith('/api')) {
      req.url = `/api${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
    }
  }
}

export default function handler(req: VercelRequest, res: ServerResponse): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = async () => {
      if (settled) return;
      settled = true;
      res.removeListener('finish', done);
      res.removeListener('close', done);
      try {
        await flushPendingKvWrites();
      } catch {}
      resolve();
    };
    res.once('finish', done);
    res.once('close', done);

    try {
      normalizeVercelApiUrl(req);

      const streamEnded = Boolean(req.readableEnded || req._readableState?.ended || req.complete);
      if (req.body !== undefined && streamEnded) {
        req._body = true;
      } else if (streamEnded && req.method && !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) {
        if (req.body === undefined) {
          req.body = {};
        }
        req._body = true;
      }

      const apiApp = createApiApp();
      apiApp(req as any, res as any);
    } catch (err: any) {
      console.error('[Vercel API Handler Error]', err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            success: false,
            error: 'SERVERLESS_HANDLER_ERROR',
            message: err?.message || 'Unexpected serverless API initialization failure.',
          })
        );
      }
      void done();
    }
  });
}
