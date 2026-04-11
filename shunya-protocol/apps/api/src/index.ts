import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { env } from './env';
import { sessionsRouter }     from './routes/v1/sessions';
import { attestationsRouter } from './routes/v1/attestations';
import { otpRouter }          from './routes/internal/otp';
import { nullifierRouter }    from './routes/internal/nullifier';
import { proofRouter }        from './routes/internal/proof';
import { statusRouter }       from './routes/internal/status';
import { startAllWorkers }    from './workers/index';

const app = new Hono();

app.use('*', logger());
app.use('*', cors({
  origin: [env.POPUP_URL, env.DASHBOARD_URL],
  allowHeaders: ['Authorization', 'Content-Type'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

// Health check
app.get('/healthz', (c) => c.json({ ok: true, ts: Date.now() }));

// Public API routes (sk_ auth)
app.route('/v1/sessions',     sessionsRouter);
app.route('/v1/attestations', attestationsRouter);

// Internal popup routes (JWT session auth)
app.route('/internal/sessions/:id/otp',       otpRouter);
app.route('/internal/sessions/:id/nullifier', nullifierRouter);
app.route('/internal/sessions/:id/proof',     proofRouter);
app.route('/internal/sessions/:id',           statusRouter);

// Start background workers (same process)
startAllWorkers();

export default {
  port: 3000,
  fetch: app.fetch,
};
