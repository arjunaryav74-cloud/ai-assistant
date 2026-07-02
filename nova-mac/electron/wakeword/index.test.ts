import { describe, it, expect } from "vitest";
import { wakeSensitivityToThreshold } from "./index";

describe("wakeSensitivityToThreshold", () => {
  it("is monotonically decreasing — higher sensitivity means a lower (easier-to-fire) threshold", () => {
    const strict = wakeSensitivityToThreshold(0.35);
    const mid = wakeSensitivityToThreshold(0.5);
    const sensitive = wakeSensitivityToThreshold(0.85);
    expect(strict).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(sensitive);
  });

  it("stays within a sane range across the slider's actual 0.35..0.85 domain", () => {
    for (const s of [0.35, 0.5, 0.65, 0.85]) {
      const t = wakeSensitivityToThreshold(s);
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(0.1);
    }
  });

  it("clamps out-of-range input instead of inverting", () => {
    expect(wakeSensitivityToThreshold(-1)).toBe(wakeSensitivityToThreshold(0));
    expect(wakeSensitivityToThreshold(5)).toBe(wakeSensitivityToThreshold(1));
  });
});
