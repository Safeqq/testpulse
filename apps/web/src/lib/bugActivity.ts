import type { BugEventDto } from "@testpulse/shared";
import { BUG_PRIORITY_LABEL, BUG_RESOLUTION_LABEL, BUG_SEVERITY_LABEL, BUG_STATUS_LABEL } from "./bugs";

type EventText = Pick<BugEventDto, "field" | "oldValue" | "newValue">;

/** Nilai enum → label tampilan; nilai di luar dugaan ditampilkan apa adanya agar teks tidak pernah kosong. */
const labelOf = (labels: Record<string, string>) => (value: string | null) =>
  value === null ? "(kosong)" : (labels[value] ?? value);

const status = labelOf(BUG_STATUS_LABEL);
const resolution = labelOf(BUG_RESOLUTION_LABEL);
const priority = labelOf(BUG_PRIORITY_LABEL);
const severity = labelOf(BUG_SEVERITY_LABEL);
const plain = (value: string | null) => value ?? "(kosong)";

/**
 * Kalimat manusiawi untuk satu event riwayat bug, tanpa nama pelaku dan waktu ("mengubah status Open → In progress").
 * Event assignee membawa nama tampilan; event deskripsi dan link tidak membawa nilai (spec Tahap 3 §3.3).
 */
export function describeEvent({ field, oldValue, newValue }: EventText): string {
  switch (field) {
    case "status":
      return `mengubah status ${status(oldValue)} → ${status(newValue)}`;
    case "resolution":
      if (oldValue === null) return `menetapkan resolusi ${resolution(newValue)}`;
      if (newValue === null) return `menghapus resolusi (${resolution(oldValue)})`;
      return `mengubah resolusi ${resolution(oldValue)} → ${resolution(newValue)}`;
    case "priority":
      return `mengubah prioritas ${priority(oldValue)} → ${priority(newValue)}`;
    case "severity":
      return `mengubah severity ${severity(oldValue)} → ${severity(newValue)}`;
    case "assignee":
      if (oldValue === null) return `menugaskan bug ini ke ${plain(newValue)}`;
      if (newValue === null) return `menghapus assignee (${oldValue})`;
      return `mengganti assignee ${oldValue} → ${newValue}`;
    case "title":
      return `mengubah judul “${plain(oldValue)}” → “${plain(newValue)}”`;
    case "labels":
      return `mengubah label ${plain(oldValue)} → ${plain(newValue)}`;
    case "description":
      return "mengubah deskripsi";
    case "links":
      return "mengubah link";
    default:
      return `mengubah ${field}`;
  }
}
