import { ErrorCodes, type ErrorCode } from '@amora/shared';

/** Domain error carrying a canonical code. Thrown anywhere; rendered by the global exception filter. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? code);
    this.status = ErrorCodes[code];
  }
}
