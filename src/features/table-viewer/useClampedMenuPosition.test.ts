import { createElement } from "react";
import { act, render } from "@testing-library/react";
import { useClampedMenuPosition } from "./useClampedMenuPosition";

// The hook only does something once the menu element is measured, so the tests
// mount a real div, stub its measured size, and read back the position the hook
// settles on. jsdom reports a 0x0 rect for everything otherwise.
const VIEWPORT = { width: 1024, height: 768 };
const MARGIN = 8;

function renderMenu(menu: { width: number; height: number }) {
  let latest: { left: number; top: number } = { left: NaN, top: NaN };

  function Menu({ x, y }: { x: number; y: number }) {
    const { ref, pos } = useClampedMenuPosition(x, y);
    latest = pos;
    return createElement("div", { ref, "data-testid": "menu" });
  }

  const sizeMenu = (el: HTMLElement) => {
    el.getBoundingClientRect = () =>
      ({ width: menu.width, height: menu.height, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  };

  // The size has to be in place before the layout effect measures, so the rect
  // is stubbed on the prototype for the initial mount and pinned to the node
  // afterwards for reruns.
  const protoRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { width: menu.width, height: menu.height, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
  const utils = render(createElement(Menu, { x: 0, y: 0 }));
  HTMLElement.prototype.getBoundingClientRect = protoRect;
  sizeMenu(utils.getByTestId("menu"));

  return {
    at(x: number, y: number) {
      act(() => {
        utils.rerender(createElement(Menu, { x, y }));
      });
      return latest;
    },
  };
}

beforeEach(() => {
  window.innerWidth = VIEWPORT.width;
  window.innerHeight = VIEWPORT.height;
});

describe("useClampedMenuPosition", () => {
  it("leaves a menu that fits at the cursor position", () => {
    const menu = renderMenu({ width: 200, height: 100 });
    expect(menu.at(300, 400)).toEqual({ left: 300, top: 400 });
  });

  it("pulls a menu back inside the right edge", () => {
    const menu = renderMenu({ width: 200, height: 100 });
    expect(menu.at(1000, 400).left).toBe(VIEWPORT.width - 200 - MARGIN);
  });

  it("pulls a menu back inside the bottom edge", () => {
    const menu = renderMenu({ width: 200, height: 100 });
    expect(menu.at(300, 760).top).toBe(VIEWPORT.height - 100 - MARGIN);
  });

  it("clamps both axes at once in the bottom-right corner", () => {
    const menu = renderMenu({ width: 240, height: 160 });
    expect(menu.at(1020, 765)).toEqual({
      left: VIEWPORT.width - 240 - MARGIN,
      top: VIEWPORT.height - 160 - MARGIN,
    });
  });

  it("keeps the margin at the top-left when the cursor is at the origin", () => {
    const menu = renderMenu({ width: 200, height: 100 });
    expect(menu.at(0, 0)).toEqual({ left: MARGIN, top: MARGIN });
  });

  it("clamps negative coordinates up to the margin", () => {
    const menu = renderMenu({ width: 200, height: 100 });
    expect(menu.at(-50, -50)).toEqual({ left: MARGIN, top: MARGIN });
  });

  it("prefers the top-left margin when the menu is larger than the viewport", () => {
    const menu = renderMenu({ width: 2000, height: 2000 });
    // The right/bottom limits go negative here; the lower bound wins so the
    // menu stays anchored and visible rather than being pushed off-screen.
    expect(menu.at(500, 500)).toEqual({ left: MARGIN, top: MARGIN });
  });

  it("sits flush against the margin when the cursor lands exactly on the limit", () => {
    const menu = renderMenu({ width: 200, height: 100 });
    const limitX = VIEWPORT.width - 200 - MARGIN;
    const limitY = VIEWPORT.height - 100 - MARGIN;
    expect(menu.at(limitX, limitY)).toEqual({ left: limitX, top: limitY });
  });

  it("recomputes when the cursor moves", () => {
    const menu = renderMenu({ width: 200, height: 100 });
    expect(menu.at(300, 300)).toEqual({ left: 300, top: 300 });
    expect(menu.at(1000, 700)).toEqual({
      left: VIEWPORT.width - 200 - MARGIN,
      top: VIEWPORT.height - 100 - MARGIN,
    });
  });

  it("uses the current viewport size, not the size at mount", () => {
    const menu = renderMenu({ width: 200, height: 100 });
    window.innerWidth = 500;
    window.innerHeight = 400;
    expect(menu.at(480, 390)).toEqual({
      left: 500 - 200 - MARGIN,
      top: 400 - 100 - MARGIN,
    });
  });
});
