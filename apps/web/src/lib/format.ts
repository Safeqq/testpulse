const dateTime = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" });

/** Tanggal dan jam dalam format Indonesia; teks aslinya dikembalikan bila bukan tanggal yang valid. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTime.format(date);
}
