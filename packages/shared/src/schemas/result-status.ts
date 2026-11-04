// Dipisah dari results.ts agar bugs.ts (testHint) dan results.ts (bugs pada DTO) tidak saling mengimpor.
export const RESULT_STATUSES = ["passed", "failed", "skipped"] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];
