/**
 * Generate a unique identifier with optional prefix.
 *
 * @param prefix - Optional string prefix.
 * @returns A unique string ID.
 */
export function generateId(prefix = ''): string {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).substring(2, 9);
  return `${prefix}${ts}-${rnd}`;
}

export default generateId;
