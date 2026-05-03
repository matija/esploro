import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function truncateSmart(title: string, maxLen: number): string {
  if (title.length <= maxLen) return title;

  const dotIdx = title.indexOf(".");
  if (dotIdx === -1) {
    return title.slice(0, maxLen - 1) + "…";
  }

  const schema = title.slice(0, dotIdx);
  const table = title.slice(dotIdx + 1);

  if (table.length >= maxLen - 1) return table.slice(0, maxLen - 1) + "…";

  const schemaBudget = maxLen - table.length - 1;
  if (schemaBudget <= 1) return "…." + table;

  const truncatedSchema = schema.slice(0, schemaBudget - 1) + "…";
  return truncatedSchema + "." + table;
}
