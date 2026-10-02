import { ValidationError } from "./errors";

// Shared input-shape guards used across all service entry points.
// Deliberately minimal — this is not a generalized validation
// framework, just the checks needed so malformed client input produces
// a controlled ValidationError (-> HTTP 400) instead of an uncaught
// TypeError, NaN propagating into a Decimal column, or a raw Prisma
// foreign-key error leaking to the caller.

// Matches an optionally-signed decimal number with no more than 18
// integer digits and 4 fractional digits — must stay in sync with the
// `@db.Decimal(18, 4)` columns in prisma/schema.prisma. Rejects "NaN",
// "Infinity", empty strings, and anything non-numeric outright, rather
// than relying on `Number(x) <= 0` (which treats "abc" as NaN and lets
// it slip past a naive `<= 0` check).
const DECIMAL_PATTERN = /^-?\d{1,18}(\.\d{1,4})?$/;

export function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${fieldName} must be a non-empty string.`);
  }
  return value;
}

export function requireId(value: unknown, fieldName: string): string {
  return requireNonEmptyString(value, fieldName);
}

// Accepts string or number (as the rest of the codebase does for
// decimal-ish fields) but always validates via its string form so
// "100000000000000000000" (too large / loses precision as a JS number)
// and "abc"/"NaN"/"Infinity" are rejected rather than silently coerced.
export function requirePositiveDecimal(value: unknown, fieldName: string): string {
  if (value === null || value === undefined || (typeof value !== "string" && typeof value !== "number")) {
    throw new ValidationError(`${fieldName} must be a number or numeric string.`);
  }
  const asString = typeof value === "number" ? value.toString() : value.trim();
  if (!DECIMAL_PATTERN.test(asString)) {
    throw new ValidationError(
      `${fieldName} must be a valid decimal with up to 18 integer digits and 4 fractional digits (got: ${JSON.stringify(value)}).`
    );
  }
  if (Number(asString) <= 0) {
    throw new ValidationError(`${fieldName} must be greater than zero.`);
  }
  return asString;
}

const CURRENCY_PATTERN = /^[A-Z]{3}$/;
export function requireCurrency(value: unknown): string {
  const str = requireNonEmptyString(value, "currency").trim();
  if (!CURRENCY_PATTERN.test(str)) {
    throw new ValidationError(`currency must be a 3-letter ISO 4217 code (got: ${JSON.stringify(value)}).`);
  }
  return str;
}

// V1 does not implement unit conversion (Q3/Q3-CV scope), so unit is
// validated only as a non-empty, reasonably-bounded token — not against
// a fixed enumeration, since introducing one would be inventing
// business semantics beyond this task's scope.
export function requireUnit(value: unknown): string {
  const str = requireNonEmptyString(value, "unit").trim();
  if (str.length > 16) {
    throw new ValidationError(`unit must be 16 characters or fewer (got: ${JSON.stringify(value)}).`);
  }
  return str;
}
