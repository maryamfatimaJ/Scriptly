import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";

type RequestPart = "body" | "query" | "params";

// Validates & replaces req[part] with the parsed (and therefore typed +
// trimmed of unknown keys) data. Validation errors are thrown as ZodErrors
// and handled centrally by error.middleware.ts.
export function validate(schema: ZodSchema, part: RequestPart = "body") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.parse(req[part]);
    (req as unknown as Record<string, unknown>)[part] = parsed;
    next();
  };
}
