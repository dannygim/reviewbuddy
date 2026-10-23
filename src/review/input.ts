/** A request body that fails validation (HTTP 400). */
export class InputError extends Error {}

export type Body = Record<string, unknown>;

export function text(body: Body, key: string, max: number): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    throw new InputError(`${key} must be 1 to ${max} characters`);
  }
  return value;
}

export function integer(body: Body, key: string): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new InputError(`${key} must be an integer`);
  }
  return value;
}

export function oneOf<T extends string>(
  body: Body,
  key: string,
  values: readonly T[],
): T {
  const value = body[key];
  if (!values.includes(value as T)) {
    throw new InputError(`${key} must be one of ${values.join(", ")}`);
  }
  return value as T;
}
