import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { AppError } from '../utils/AppError';
import { env } from '../config/env';
import { logger } from '../config/logger';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let statusCode = 500;
  let message = 'Internal server error';
  let details: unknown;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    statusCode = 400;
    message = 'Validation error';
    details = err.flatten();
  } else if (err instanceof mongoose.Error.ValidationError) {
    statusCode = 400;
    message = 'Database validation error';
    details = Object.fromEntries(
      Object.entries(err.errors).map(([k, v]) => [k, (v as { message: string }).message])
    );
  } else if (err instanceof mongoose.Error.CastError) {
    statusCode = 400;
    message = `Invalid ${err.path}: ${String(err.value)}`;
  } else if (err instanceof Error) {
    message = env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  }

  if (statusCode >= 500) {
    logger.error({ err, path: req.originalUrl, method: req.method }, 'Unhandled error');
    if (env.NODE_ENV === 'production') {
      message = 'Internal server error';
    }
  } else {
    logger.warn({ err: (err as Error)?.message, path: req.originalUrl }, 'Request error');
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(details !== undefined ? { details } : {}),
    ...(env.NODE_ENV !== 'production' && err instanceof Error ? { stack: err.stack } : {}),
  });
}
