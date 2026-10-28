import type { ResultStatus } from "@testpulse/shared";

/** Batas daftar flaky dari API; di titik ini jumlahnya "50 atau lebih". */
export const FLAKY_API_LIMIT = 50;

/** Label hasil terakhir sebuah test (huruf kecil, untuk dirangkai dalam kalimat). */
export const LAST_STATUS_LABEL: Record<ResultStatus, string> = { passed: "lulus", failed: "gagal", skipped: "dilewati" };
