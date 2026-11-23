import { syncRecipesToRag } from './services/ragSync';
import { reverifyPendingRecipes } from './controllers/recipeController';
import { createApp } from './app';
import { connectDB, disconnectDB } from './config/db';
import { env } from './config/env';
import { logger } from './config/logger';
import { initRealtime } from './services/realtime';

async function bootstrap() {
  await connectDB();
  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(`🚀 MealMate server listening on http://localhost:${env.PORT} [${env.NODE_ENV}]`);
  });

  initRealtime(server);

  // Sync MongoDB recipes into RAG index after startup
  // Small delay to ensure AI service is ready
  setTimeout(() => void syncRecipesToRag(), 8000);

  // Re-verify recipes published while the AI check was unavailable. Runs
  // every 10 minutes; a no-op when nothing is pending, and a no-op while the
  // AI service is still down (recipes stay pending). Unref'd so it never
  // keeps the process alive, and skipped in tests.
  if (env.NODE_ENV !== 'test') {
    setInterval(
      () =>
        void reverifyPendingRecipes().catch((err) =>
          logger.error({ err }, 'Pending recipe re-verification failed')
        ),
      10 * 60 * 1000
    ).unref();
  }

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal} — shutting down gracefully`);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
// Reloaded with AI service on port 8001

