import type { ApiErrorCode, ApiFailure, ApiSuccess } from '@taazastream/shared';

/** An error that maps 1:1 to an API error response. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Forbidden') => new AppError(403, 'FORBIDDEN', message);
export const conflict = (message: string) => new AppError(409, 'CONFLICT', message);

export function ok<T>(data: T): ApiSuccess<T> {
  return { ok: true, data };
}

export function failure(code: ApiErrorCode, message: string, details?: unknown): ApiFailure {
  return {
    ok: false,
    error: details === undefined ? { code, message } : { code, message, details },
  };
}

/** Map low-level Node filesystem errors to friendly API errors. */
export function fsError(err: unknown, what = 'File'): AppError {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  switch (code) {
    case 'ENOENT':
    case 'ENOTDIR':
      return new AppError(404, 'MEDIA_MISSING', `${what} is missing from disk`);
    case 'EACCES':
    case 'EPERM':
      return new AppError(403, 'MEDIA_UNREADABLE', `${what} cannot be read (permission denied)`);
    case 'ENOSPC':
      return new AppError(507, 'DISK_FULL', 'The server disk is full');
    case 'EBUSY':
      return new AppError(503, 'MEDIA_UNREADABLE', `${what} is locked by another program`);
    default:
      return new AppError(500, 'INTERNAL_ERROR', `${what} could not be accessed`);
  }
}
