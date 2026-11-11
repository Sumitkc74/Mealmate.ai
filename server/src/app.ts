import express, { type Express, type Request, type Response } from 'express';
import path from 'node:path';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { logger } from './config/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { correlationId } from './middleware/correlationId';
import { metricsHandler, metricsMiddleware } from './middleware/metrics';
import { installSwagger } from './utils/swagger';
import authRoutes from './routes/authRoutes';
import recipeRoutes from './routes/recipeRoutes';
import mealPlanRoutes from './routes/mealPlanRoutes';
import groceryRoutes from './routes/groceryRoutes';
import nutritionRoutes from './routes/nutritionRoutes';
import aiRoutes from './routes/aiRoutes';

export function createApp(): Express {
  const app = express();

  // Trust first-hop reverse proxy (Kubernetes Ingress / Nginx) for accurate client IP resolution in rateLimit
  app.set('trust proxy', 1);

  // Security & infra middleware
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
      credentials: true,
      exposedHeaders: ['X-Correlation-ID'],
    })
  );
  app.use(compression());
  // Scoped body parsing: 10mb limit reserved strictly for fridge photo vision analysis; 1mb globally to prevent memory exhaustion DoS
  app.use('/api/ai/pantry/vision', express.json({ limit: '10mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Observability: correlation IDs first so logs + metrics can reference them.
  app.use(correlationId());
  if (env.NODE_ENV !== 'test') {
    app.use(metricsMiddleware());
  }

  // Serve cached recipe images and other static assets.
  app.use('/static', express.static(path.resolve(__dirname, '..', 'static')));

  // Logging (skip during tests)
  if (env.NODE_ENV !== 'test') {
    app.use(
      morgan(':method :url :status :response-time ms :res[x-correlation-id]', {
        stream: { write: (msg) => logger.info(msg.trim()) },
      })
    );
  }

  // Rate limiter on all /api routes
  app.use(
    '/api',
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  // Health check
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      success: true,
      service: 'mealmate-server',
      version: '0.3.0',
      env: env.NODE_ENV,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // Prometheus metrics (no auth — same convention as cAdvisor/kube-state).
  app.get('/metrics', metricsHandler);

  // OpenAPI documentation UI
  installSwagger(app);

  // Feature routes
  app.use('/api/auth', authRoutes);
  app.use('/api/recipes', recipeRoutes);
  app.use('/api/mealplans', mealPlanRoutes);
  app.use('/api/grocery', groceryRoutes);
  app.use('/api/nutrition', nutritionRoutes);
  app.use('/api/ai', aiRoutes);

  // 404 + error handler (always last)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
