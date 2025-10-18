// src/utils/generateId.ts

/**
 * Generate a unique identifier with optional prefix.
 */
export function generateId(prefix = ''): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 9);
  return `${prefix}${ts}-${rand}`;
}

export default generateId;
