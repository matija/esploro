// Returns 0 (no match), 1 (fuzzy match: all chars present in order), 2 (substring match)
export function fuzzyScore(str: string, query: string): number {
  if (!query) return 2;
  const s = str.toLowerCase();
  const q = query.toLowerCase();
  if (s.includes(q)) return 2;
  let si = 0;
  for (const ch of q) {
    si = s.indexOf(ch, si);
    if (si === -1) return 0;
    si++;
  }
  return 1;
}
