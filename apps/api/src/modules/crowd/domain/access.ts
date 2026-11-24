import type { CycleStatus, MeState, ParticipantStatus } from "@testpulse/shared";

// Spec Tahap 5 §4: siapa yang boleh bergabung dan mengirim laporan.

export interface AccessInput {
  authenticated: boolean;
  /** Anggota project pemilik cycle (role apa pun). */
  isMember: boolean;
  /** Status peserta pengguna di cycle ini; `null` bila belum pernah bergabung. */
  participantStatus: ParticipantStatus | null;
  /** Status efektif cycle (lihat `effectiveCycleStatus`). */
  effectiveStatus: CycleStatus;
}

/**
 * Keadaan pengunjung di halaman cycle publik. Urutan menentukan pesan yang paling berguna: dikeluarkan dan anggota
 * project selalu dijelaskan apa adanya, lalu cycle yang tidak open, lalu anonim, lalu status peserta.
 */
export function participantState(input: AccessInput): MeState {
  if (input.participantStatus === "removed") return "removed";
  if (input.isMember) return "member";
  if (input.effectiveStatus !== "open") return "closed";
  if (!input.authenticated) return "anonymous";
  if (input.participantStatus === "active") return "joined";
  if (input.participantStatus === "left") return "left";
  return "can_join";
}

export type JoinError = "UNAUTHENTICATED" | "MEMBER_CANNOT_JOIN" | "PARTICIPANT_REMOVED" | "CYCLE_NOT_OPEN";

/** Alasan pengguna tidak boleh bergabung, atau `null`. Bergabung lagi saat sudah aktif diizinkan (idempoten). */
export function canJoin(input: AccessInput): JoinError | null {
  if (!input.authenticated) return "UNAUTHENTICATED";
  if (input.isMember) return "MEMBER_CANNOT_JOIN";
  if (input.participantStatus === "removed") return "PARTICIPANT_REMOVED";
  if (input.effectiveStatus !== "open") return "CYCLE_NOT_OPEN";
  return null;
}

export type SubmitError = JoinError | "NOT_PARTICIPANT";

/** Alasan pengguna tidak boleh mengirim laporan, atau `null` (spec §4, syarat kirim laporan). */
export function canSubmit(input: AccessInput): SubmitError | null {
  if (!input.authenticated) return "UNAUTHENTICATED";
  if (input.isMember) return "MEMBER_CANNOT_JOIN";
  if (input.participantStatus === "removed") return "PARTICIPANT_REMOVED";
  if (input.participantStatus !== "active") return "NOT_PARTICIPANT";
  if (input.effectiveStatus !== "open") return "CYCLE_NOT_OPEN";
  return null;
}

/** Status setelah keluar, atau `null` bila tidak berubah. Peserta yang dikeluarkan tetap `removed` (Review Focus 2). */
export function leaveTransition(current: ParticipantStatus | null): ParticipantStatus | null {
  return current === "active" ? "left" : null;
}

/** Status setelah bergabung, atau `null` bila ditolak karena pengguna pernah dikeluarkan. */
export function joinTransition(current: ParticipantStatus | null): ParticipantStatus | null {
  return current === "removed" ? null : "active";
}
