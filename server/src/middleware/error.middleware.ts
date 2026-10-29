import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { MulterError } from "multer";
import { AppError } from "@/utils/AppError";
import { UnsupportedFileTypeError } from "@/middleware/upload.middleware";
import { isProduction } from "@/config/env";

// Central error handler. Deliberately avoids echoing stack traces, raw
// database errors, or file-system paths back to the client — those can
// leak details about a medical record system we do not want exposed.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  if (err instanceof UnsupportedFileTypeError) {
    return res.status(400).json({ error: { code: "UNSUPPORTED_FILE_TYPE", message: err.message } });
  }

  if (err instanceof MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE" ? "File is too large." : "Could not process the uploaded file.";
    return res.status(400).json({ error: { code: `UPLOAD_ERROR_${err.code}`, message } });
  }

  // csrf-csrf throws an http-errors instance with code "EBADCSRFTOKEN" (the
  // same convention the older `csurf` package used) rather than a custom
  // class we can `instanceof`-check — match on the code instead. Without
  // this, a legitimate client sending a missing/stale/mismatched CSRF
  // token (e.g. a stale tab, or the token-fetch/request racing in a client
  // bug) would see an opaque 500 instead of an actionable 403.
  if (isCsrfError(err)) {
    return res.status(403).json({
      error: {
        code: "INVALID_CSRF_TOKEN",
        message: "Your session's security token is invalid or expired. Please refresh the page and try again.",
      },
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "One or more fields are invalid.",
        details: err.flatten(),
      },
    });
  }

  // Log server-side with enough context to debug, but never log request
  // bodies/files here — prescription payloads may contain medical data.
  console.error(`[unhandled error] ${req.method} ${req.path}:`, isProduction ? (err as Error)?.message : err);

  return res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Something went wrong. Please try again.",
    },
  });
}

function isCsrfError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "EBADCSRFTOKEN";
}

export function notFoundMiddleware(req: Request, res: Response) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` } });
}
