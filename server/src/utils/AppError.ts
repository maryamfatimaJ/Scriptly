// A typed application error so the error-handling middleware can map
// known failure modes to the right HTTP status without leaking internals
// (stack traces, Prisma error details, file paths) to the client.
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, "BAD_REQUEST", message, details);
  }

  static unauthorized(message = "Authentication required") {
    return new AppError(401, "UNAUTHORIZED", message);
  }

  static forbidden(message = "You do not have access to this resource") {
    return new AppError(403, "FORBIDDEN", message);
  }

  static notFound(message = "Resource not found") {
    return new AppError(404, "NOT_FOUND", message);
  }

  static conflict(message: string) {
    return new AppError(409, "CONFLICT", message);
  }

  static unprocessable(message: string, details?: unknown) {
    return new AppError(422, "UNPROCESSABLE", message, details);
  }

  static internal(message = "Something went wrong") {
    return new AppError(500, "INTERNAL_ERROR", message);
  }
}
