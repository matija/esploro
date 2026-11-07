import { cn } from "../lib/utils";

export function ObjectName({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center", className)} title={name}>
      {name.length > 12 ? (
        <>
          <span className="min-w-0 truncate">{name.slice(0, -8)}</span>
          <span className="max-w-[60%] shrink-0 truncate" dir="rtl"><bdi dir="ltr">{name.slice(-8)}</bdi></span>
        </>
      ) : (
        <span className="truncate">{name}</span>
      )}
    </span>
  );
}
