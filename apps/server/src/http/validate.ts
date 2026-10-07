import type { ZodType, ZodTypeDef } from 'zod';
import { AppError } from './errors';

/** Validate untrusted input with Zod; throws a 400 with field-level details. */
export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      result.error.issues[0]?.message ?? 'Invalid request',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}
