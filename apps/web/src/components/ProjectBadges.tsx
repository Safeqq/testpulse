import type { Role, Visibility } from "@testpulse/shared";
import { Globe, Lock, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABEL } from "../lib/roles";

/** Penanda visibilitas project (Publik/Privat), dipakai di daftar dan ringkasan. */
export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  const isPublic = visibility === "public";
  const Icon = isPublic ? Globe : Lock;
  return (
    <Badge variant="outline">
      <Icon aria-hidden="true" />
      {isPublic ? "Publik" : "Privat"}
    </Badge>
  );
}

/** Penanda peran user di sebuah project. `prefix` mis. "Peran Anda: ". */
export function RoleBadge({ role, prefix = "" }: { role: Role; prefix?: string }) {
  return (
    <Badge variant="secondary">
      <ShieldCheck aria-hidden="true" />
      {prefix}
      {ROLE_LABEL[role]}
    </Badge>
  );
}
