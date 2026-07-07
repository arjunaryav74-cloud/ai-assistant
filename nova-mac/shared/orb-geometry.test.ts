import { describe, it, expect } from "vitest";
import {
  ORB_MINI_SIZE,
  ORB_PANEL_WIDTH,
  MINI_ORB_VISUAL_SIZE,
  PANEL_ORB_VISUAL_SIZE,
  orbCenterOffset,
  orbBoxPosition,
} from "./orb-geometry";

describe("orbCenterOffset", () => {
  it("mini state is the window's exact center", () => {
    expect(orbCenterOffset(false)).toEqual({ x: ORB_MINI_SIZE / 2, y: ORB_MINI_SIZE / 2 });
  });

  it("panel state is horizontally centered in the panel width", () => {
    expect(orbCenterOffset(true).x).toBe(ORB_PANEL_WIDTH / 2);
  });

  it("panel state sits below the wrapper padding and icon strip", () => {
    const { y } = orbCenterOffset(true);
    // Must be far enough down to clear the icon strip, not centered in the
    // whole 520px panel — that was the original teleport bug.
    expect(y).toBeGreaterThan(40);
    expect(y).toBeLessThan(150);
  });
});

describe("orbBoxPosition", () => {
  it("mini orb box is centered within the mini window", () => {
    const pos = orbBoxPosition(false);
    expect(pos.left).toBe((ORB_MINI_SIZE - MINI_ORB_VISUAL_SIZE) / 2);
    expect(pos.top).toBe((ORB_MINI_SIZE - MINI_ORB_VISUAL_SIZE) / 2);
    expect(pos.left).toBeGreaterThanOrEqual(0); // orb must fit inside its window
  });

  it("panel orb box top-left is center minus half the visual size", () => {
    const center = orbCenterOffset(true);
    const pos = orbBoxPosition(true);
    expect(pos.left).toBe(center.x - PANEL_ORB_VISUAL_SIZE / 2);
    expect(pos.top).toBe(center.y - PANEL_ORB_VISUAL_SIZE / 2);
  });
});
