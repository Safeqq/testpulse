import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SettingsSectionProps {
  /** Awalan id: judul `<id>-title`, dipakai `aria-labelledby`. */
  id: string;
  title: string;
  description?: ReactNode;
  tone?: "default" | "danger";
  children: ReactNode;
}

/** Bagian pengaturan: kartu dengan judul h2 dan teks bantu singkat. */
export function SettingsSection({ id, title, description, tone = "default", children }: SettingsSectionProps) {
  const danger = tone === "danger";
  return (
    <section aria-labelledby={`${id}-title`}>
      <Card className={cn(danger && "border-destructive/50")}>
        <CardHeader>
          <h2
            id={`${id}-title`}
            className={cn("text-lg font-semibold tracking-tight", danger && "text-destructive")}
          >
            {title}
          </h2>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </section>
  );
}
