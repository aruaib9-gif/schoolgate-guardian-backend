import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import path from 'node:path';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { errorHandler, notFound } from './middleware/error.js';
import { entityNames } from './lib/registry.js';
import { buildOpenApiSpec } from './lib/openapi.js';

import authRoutes from './routes/auth.routes.js';
import entityRoutes from './routes/entities.routes.js';
import integrationRoutes from './routes/integrations.routes.js';
import functionRoutes from './routes/functions.routes.js';
import userRoutes from './routes/users.routes.js';
import superadminRoutes from './routes/superadmin.routes.js';
import qrRoutes from './routes/qr.routes.js';
import billingRoutes, { paystackWebhook } from './routes/billing.routes.js';

export function createApp() {
  const app = express();

  // Behind Render/most PaaS the client IP arrives via X-Forwarded-For; without
  // this, rate limiting would count the load balancer as one very busy client.
  app.set('trust proxy', 1);

  // crossOriginResourcePolicy relaxed so /uploads files can be embedded by the
  // web apps on their own origins.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  app.use(
    cors({
      origin: env.corsOrigin.includes('*') ? true : env.corsOrigin,
      credentials: true,
    })
  );

  // Credential endpoints get a tight lid (brute force); functions get a modest
  // one (each call can fan out email); everything else a generous backstop.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true, // normal logins don't eat the budget; only failures count
    message: { error: 'Too many attempts, try again later.' },
  });
  const functionsLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many function calls, slow down.' },
  });
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 600,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded.' },
  });
  app.use('/auth/login', authLimiter);
  app.use('/auth/register', authLimiter);
  app.use('/auth/forgot-password', authLimiter);
  app.use('/functions', functionsLimiter);
  app.use('/api', apiLimiter);
  // Paystack signs the RAW request body — this route must see it before the
  // JSON parser consumes the stream.
  app.post('/api/billing/paystack/webhook', express.raw({ type: '*/*' }), (req, res, next) => {
    paystackWebhook(req, res).catch(next);
  });

  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));
  if (env.nodeEnv !== 'test') app.use(morgan('dev'));

  // Serve uploaded files.
  app.use('/uploads', express.static(path.resolve(env.uploadDir)));

  // Interactive API docs (Swagger UI) at /docs, raw spec at /docs.json
  const openApiSpec = buildOpenApiSpec();
  app.get('/docs.json', (_req, res) => res.json(openApiSpec));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, { customSiteTitle: 'SchoolGate Guardian API Docs' }));

  // Health + discovery. /health answers 503 when the database is unreachable
  // so the platform's health check restarts/alerts instead of routing traffic
  // to an instance that will 500 every real request.
  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', db: 'up', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded', db: 'down', time: new Date().toISOString() });
    }
  });
  app.get('/', (_req, res) =>
    res.json({
      name: 'SchoolGate Guardian API',
      version: '1.0.0',
      entities: entityNames(),
      docs: '/docs',
    })
  );

  // Routes
  app.use('/auth', authRoutes);
  app.use('/api/entities', entityRoutes);
  app.use('/api/superadmin', superadminRoutes);
  app.use('/integrations', integrationRoutes);
  app.use('/functions', functionRoutes);
  app.use('/users', userRoutes);
  app.use('/qr', apiLimiter, qrRoutes);
  app.use('/api/billing', apiLimiter, billingRoutes);

  // 404 + error handling
  app.use((req, _res, next) => next(notFound(`No route for ${req.method} ${req.path}`)));
  app.use(errorHandler);

  return app;
}
