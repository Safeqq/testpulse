const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Bentuk UUID (8-4-4-4-12 hex, tanpa peduli huruf besar). Dipakai sebelum query dengan parameter path/cursor:
 * nilai lain akan ditolak Postgres saat bind (500), jadi rute menjawab 404/400 lebih dulu.
 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
