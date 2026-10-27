import type { ComponentProps } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * `<select>` native yang distyle seperti Input. Sengaja bukan Select Radix (menyuntikkan <style> yang diblokir CSP);
 * tetap native agar dapat dipakai dengan keyboard/pembaca layar dan `selectOption` di test.
 */
export function NativeSelect({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <span className="relative inline-flex">
      <select
        data-slot="native-select"
        className={cn(
          "h-9 w-full min-w-0 appearance-none rounded-md border border-input bg-card py-1 pr-9 pl-3 text-base text-foreground md:text-sm shadow-xs transition-colors outline-hidden",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  );
}
