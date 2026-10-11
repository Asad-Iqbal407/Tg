import type { RequestHandler } from 'express';

/** Writes one line to stdout. Lines are JSON, so each one can be parsed by a log shipper. */
export function writeLine(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * One JSON line per request: method, path, status and duration. Bodies, headers, cookies and query
 * strings are never logged, so passwords and session tokens stay out of the logs.
 */
export function requestLogger(log: (line: string) => void): RequestHandler {
  return (req, res, next) => {
    // Express rewrites req.path inside mounted routers (/api), so the path is taken before that happens.
    const path = (req.originalUrl.split('?')[0] ?? '/').slice(0, 200);
    const started = performance.now();
    res.on('finish', () => {
      log(
        JSON.stringify({
          time: new Date().toISOString(),
          method: req.method,
          path,
          status: res.statusCode,
          durationMs: Math.round((performance.now() - started) * 10) / 10,
        }),
      );
    });
    next();
  };
}
