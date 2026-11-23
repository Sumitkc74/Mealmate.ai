import type { Request, Response, NextFunction } from 'express';
import type { ZodTypeAny } from 'zod';

type Schema = ZodTypeAny;

interface ValidateOptions {
  body?: Schema;
  query?: Schema;
  params?: Schema;
}

/**
 * Validate `req.body`, `req.query`, `req.params` against Zod schemas.
 * Replaces the parsed values back onto the request for downstream handlers.
 */
export function validate(schemas: ValidateOptions) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) req.body = await schemas.body.parseAsync(req.body);
      if (schemas.query) req.query = (await schemas.query.parseAsync(req.query)) as never;
      if (schemas.params) req.params = (await schemas.params.parseAsync(req.params)) as never;
      next();
    } catch (err) {
      next(err);
    }
  };
}
