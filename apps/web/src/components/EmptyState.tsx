import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps extends Omit<ComponentProps<"div">, "title"> {
  icon: LucideIcon;
  title: string;
  /** Tingkat judul agar struktur heading halaman tetap benar (h1 bila ini isi utama halaman). */
  headingLevel?: "h1" | "h2";
  /** Tindakan (mis. tombol) di bawah deskripsi. */
  action?: ReactNode;
}

/** Keadaan kosong: ikon, judul, penjelasan singkat (children), dan tindakan opsional. */
export function EmptyState({
  icon: Icon,
  title,
  headingLevel: Heading = "h2",
  action,
  className,
  children,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "grid justify-items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-12 text-center text-card-foreground",
        className,
      )}
      {...props}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <Heading className="text-lg font-semibold tracking-tight">{title}</Heading>
      <div className="max-w-md text-sm text-muted-foreground">{children}</div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
