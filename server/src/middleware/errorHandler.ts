import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { AppError } from '../utils/AppError';
import { env } from '../config/env';
import { logger } from '../config/logger';

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  // Do not echo the requested URL back: it lets an attacker confirm which
  // paths exist and reflects arbitrary input in the response.
  next(AppError.notFound('Route not found'));
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
    // Do not echo the offending value: it reflects user input in the response.
    message = `Invalid ${err.path}`;
  } else if (err instanceof Error) {
    message = env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  }

  if (statusCode >= 500) {
    logger.error({ err, path: req.originalUrl, method: req.method }, 'Unhandled error');
    // Operational AppErrors carry a deliberate user-facing message (e.g. the
    // 503 "Password reset is not available right now"). Keep it. Only
    // unexpected errors get the generic message in production.
    if (!(err instanceof AppError) && env.NODE_ENV === 'production') {
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
