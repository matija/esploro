import { useLayoutEffect, useRef, useState } from "react";

/**
 * Clamp a fixed-position context menu opened at cursor (x, y) so it stays
 * fully inside the viewport. Attach `ref` to the menu element and position
 * it with `pos`.
 */
export function useClampedMenuPosition(x: number, y: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
  }, [x, y]);

  return { ref, pos };
}
