import { render, screen } from "@testing-library/react";
import type { CellValue } from "../table-viewer/types";
import { CellRenderer, cellRendererPropsAreEqual } from "./CellRenderer";

describe("CellRenderer", () => {
  it("renders the truncation affordance for a truncated cell", () => {
    const cell: CellValue = {
      t: "truncated",
      v: { value: "a".repeat(300), truncated: true, originalBytes: 5000 },
    };

    render(<CellRenderer cell={cell} />);

    expect(screen.getByText("… (truncated)")).toBeDefined();
  });

  it("does not render the truncation affordance for a normal cell", () => {
    const cell: CellValue = { t: "text", v: "hello" };

    render(<CellRenderer cell={cell} />);

    expect(screen.queryByText(/truncated/)).toBe(null);
  });

  // These exercise the exact comparator passed to React.memo(), which is what
  // actually decides whether CellRenderer bails out of re-rendering.
  describe("cellRendererPropsAreEqual (the React.memo comparator)", () => {
    it("treats a new but value-equal cell object, with the same isEnum, as unchanged", () => {
      const prev = { cell: { t: "text", v: "hello" } as CellValue, isEnum: false };
      const next = { cell: { t: "text", v: "hello" } as CellValue, isEnum: false };

      expect(cellRendererPropsAreEqual(prev, next)).toBe(true);
    });

    it("treats a truncated cell with identical fields as unchanged", () => {
      const prev = {
        cell: { t: "truncated", v: { value: "abc", truncated: true, originalBytes: 10 } } as CellValue,
      };
      const next = {
        cell: { t: "truncated", v: { value: "abc", truncated: true, originalBytes: 10 } } as CellValue,
      };

      expect(cellRendererPropsAreEqual(prev, next)).toBe(true);
    });

    it("flags a change when the cell value differs", () => {
      const prev = { cell: { t: "text", v: "hello" } as CellValue };
      const next = { cell: { t: "text", v: "world" } as CellValue };

      expect(cellRendererPropsAreEqual(prev, next)).toBe(false);
    });

    it("flags a change when isEnum differs", () => {
      const prev = { cell: { t: "text", v: "hello" } as CellValue, isEnum: false };
      const next = { cell: { t: "text", v: "hello" } as CellValue, isEnum: true };

      expect(cellRendererPropsAreEqual(prev, next)).toBe(false);
    });
  });
});
