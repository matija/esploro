import { cn } from "../../lib/utils";
import { COL_WIDTH, HEADER_HEIGHT, ROW_HEIGHT_BY_DENSITY } from "../data-grid/constants";

const SKELETON_COL_WIDTHS = [140, 100, 80, 160, 120];
const SKELETON_ROW_WIDTHS = [
  [120, 80, 70, 140, 110],
  [100, 90, 60, 120, 100],
  [130, 70, 75, 150, 115],
  [110, 85, 65, 130, 105],
  [125, 75, 80, 145, 120],
  [95,  95, 70, 125,  90],
  [135, 80, 60, 155, 115],
  [115, 70, 75, 135, 100],
];

export function SkeletonGrid() {
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="shrink-0 flex border-b-2 border-separator bg-sidebar overflow-x-hidden">
        <div className="flex divide-x divide-separator" style={{ minWidth: "100%" }}>
          {SKELETON_COL_WIDTHS.map((w, i) => (
            <div
              key={i}
              className="flex items-center px-2 shrink-0"
              style={{ width: COL_WIDTH, minWidth: COL_WIDTH, height: HEADER_HEIGHT }}
            >
              <div
                className="h-2.5 rounded bg-control animate-pulse"
                style={{ width: w }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {SKELETON_ROW_WIDTHS.map((widths, ri) => (
          <div
            key={ri}
            className={cn(
              "flex divide-x divide-separator/50 border-b border-separator/50",
              ri % 2 === 1 && "bg-subtle/30",
            )}
            style={{ height: ROW_HEIGHT_BY_DENSITY.compact }}
          >
            {SKELETON_COL_WIDTHS.map((_, ci) => (
              <div
                key={ci}
                className="flex items-center px-2 shrink-0"
                style={{ width: COL_WIDTH, minWidth: COL_WIDTH }}
              >
                <div
                  className="h-2 rounded bg-control animate-pulse"
                  style={{
                    width: widths[ci] ?? 80,
                    animationDelay: `${(ri * SKELETON_COL_WIDTHS.length + ci) * 30}ms`,
                  }}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
