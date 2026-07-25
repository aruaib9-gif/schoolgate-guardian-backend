import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'node:path';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { errorHandler, notFound } from './middleware/error.js';
import { entityNames } from './lib/registry.js';
import { buildOpenApiSpec } from './lib/openapi.js';

import authRoutes from './routes/auth.routes.js';
import entityRoutes from './routes/entities.routes.js';
import integrationRoutes from './routes/integrations.routes.js';
import functionRoutes from './routes/functions.routes.js';
import userRoutes from './routes/users.routes.js';
import superadminRoutes from './routes/superadmin.routes.js';

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: env.corsOrigin.includes('*') ? true : env.corsOrigin,
      credentials: true,
    })
  );
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));
  if (env.nodeEnv !== 'test') app.use(morgan('dev'));

  // Serve uploaded files.
  app.use('/uploads', express.static(path.resolve(env.uploadDir)));

  // Interactive API docs (Swagger UI) at /docs, raw spec at /docs.json
  const openApiSpec = buildOpenApiSpec();
  app.get('/docs.json', (_req, res) => res.json(openApiSpec));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, { customSiteTitle: 'SchoolGate Guardian API Docs' }));

  // Health + discovery
  app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
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

  // 404 + error handling
  app.use((req, _res, next) => next(notFound(`No route for ${req.method} ${req.path}`)));
  app.use(errorHandler);

  return app;
}
