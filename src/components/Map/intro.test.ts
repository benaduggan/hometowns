import { SHAPES } from "../../lib/geo/model";
import { FLIGHT_MS, easeInOut, planIntro } from "./intro";

// 919 Raleigh and 212 Manhattan are on the main map; 808 Hawaii is an inset.
const counts = new Map([
  ["919", 12],
  ["212", 3],
  ["415", 1],
  ["808", 2],
]);
const colorFor = (n: number) => `c${Math.min(n, 5)}`;

describe("planIntro", () => {
  it("flies from a home on the main map", () => {
    const plan = planIntro({ counts, colorFor, numbers: 18, homeShapeId: "919" });
    if (plan.kind !== "flights") throw new Error("expected flights");
    const byId = new Map(plan.flights.map((f) => [f.shapeId, f]));
    expect(byId.get("919")).toMatchObject({ depart: 0, land: 0 });
    expect(byId.get("919")?.arc).toBeUndefined();
    expect(byId.get("212")?.arc).toMatch(/^M[\d.]+,[\d.]+ Q/);
    // No arc can leave the main map for an inset; Hawaii just lights.
    expect(byId.has("808")).toBe(true);
    expect(byId.get("808")?.arc).toBeUndefined();
    for (const f of plan.flights)
      expect(f.land - f.depart).toBe(f.depart === 0 && !f.arc ? 0 : FLIGHT_MS / 2);
    expect(plan.duration).toBe(Math.max(...plan.flights.map((f) => f.depart)) + FLIGHT_MS);
  });

  it("takes longer for bigger maps rather than crowding the arcs", () => {
    // Past ~27 places the arcs hit their minimum spacing and the intro stretches.
    const many = new Map(
      SHAPES.filter((s) => s.inset === "main")
        .slice(0, 80)
        .map((s) => [s.id, 1] as const),
    );
    const few = new Map([...many].slice(0, 20));
    const big = planIntro({ counts: many, colorFor, numbers: 10, homeShapeId: "919" });
    const small = planIntro({ counts: few, colorFor, numbers: 3, homeShapeId: "919" });
    expect(small.duration).toBe(1200 + 1100);
    expect(big.duration).toBeGreaterThan(79 * 45);
  });

  it("plays the same way every time", () => {
    const a = planIntro({ counts, colorFor, numbers: 18, homeShapeId: "919" });
    const b = planIntro({ counts, colorFor, numbers: 18, homeShapeId: "919" });
    expect(a).toEqual(b);
  });

  it("tallies without a home, or with one in an inset", () => {
    expect(planIntro({ counts, colorFor, numbers: 18 }).kind).toBe("tally");
    expect(planIntro({ counts, colorFor, numbers: 18, homeShapeId: "808" }).kind).toBe("tally");
  });

  it("deepens each place in order and ends on its final color", () => {
    const plan = planIntro({ counts, colorFor, numbers: 18 });
    if (plan.kind !== "tally") throw new Error("expected tally");
    expect(plan.numbers).toBe(18);
    const raleigh = plan.steps.get("919")!;
    expect(raleigh.map((s) => s.color)).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    for (let i = 1; i < raleigh.length; i++)
      expect(raleigh[i]!.at).toBeGreaterThan(raleigh[i - 1]!.at);
    expect(plan.steps.get("415")!.map((s) => s.color)).toEqual(["c1"]);
    for (const steps of plan.steps.values()) {
      for (const s of steps) {
        expect(s.at).toBeGreaterThan(0);
        expect(s.at).toBeLessThanOrEqual(plan.duration);
      }
    }
  });
});

describe("easeInOut", () => {
  it("runs from 0 to 1 through the midpoint", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(0.5)).toBe(0.5);
    expect(easeInOut(1)).toBe(1);
  });
});
