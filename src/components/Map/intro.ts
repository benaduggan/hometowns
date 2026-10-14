/**
 * The animation that plays once when contacts are first mapped. With a home
 * on the main map, an arc flies out to each place and lights it on landing
 * ("flights"); without one, the numbers are counted in one at a time and each
 * place deepens in color as its count climbs ("tally").
 *
 * Planning is pure and runs during render; playing drives the shapes with the
 * Web Animations API, so the map does not re-render for every frame.
 */
import { getShape } from "../../lib/geo/model";

/** Each arc draws out and retracts over this long; the place lights halfway. */
export const FLIGHT_MS = 1100;
/** Time between departures. Bigger maps simply take longer. */
const FLIGHT_GAP_MS = 45;
/** Small maps still get spread out over at least this long. */
const MIN_SPREAD_MS = 1200;
/** How long a place takes to brighten and settle when it lights. */
const LAND_MS = 600;
const TALLY_MIN_MS = 2200;
const TALLY_MAX_MS = 6000;
const TALLY_MS_PER_NUMBER = 12;
/** Color changes in a tally fade over this long rather than snapping. */
const TALLY_FADE_MS = 200;

export interface Flight {
  shapeId: string;
  /** When the arc leaves home, in ms from the start. */
  depart: number;
  /** When the place lights. */
  land: number;
  /** SVG path from home; absent for places in an inset, which light without one. */
  arc?: string;
}

export interface TallyStep {
  /** In ms from the start. */
  at: number;
  color: string;
}

export type IntroPlan =
  | { kind: "flights"; duration: number; flights: Flight[] }
  | {
      kind: "tally";
      duration: number;
      /** Per shape, the moments its color changes as its count rises. */
      steps: Map<string, TallyStep[]>;
      /** Phone numbers in the import, for the running total. */
      numbers: number;
    };

export interface IntroInput {
  /** Contacts per shape; shapes without any stay unlit. */
  counts: ReadonlyMap<string, number>;
  colorFor: (count: number) => string;
  /** Phone numbers in the import, for the tally's running total. */
  numbers: number;
  /** The home to fly from. Ignored unless it is on the main map. */
  homeShapeId?: string;
}

/** Stable pseudo-random in [0, 1) per string, so an import always plays the same way. */
function rand(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

/** Slow start, rush through the middle, settle. */
export function easeInOut(p: number): number {
  return p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
}

/** Inverse of easeInOut: the progress at which a given share has been reached. */
function easeInOutInverse(q: number): number {
  return q < 0.5 ? Math.sqrt(q / 2) : 1 - Math.sqrt(2 * (1 - q)) / 2;
}

export function planIntro({ counts, colorFor, numbers, homeShapeId }: IntroInput): IntroPlan {
  const home = homeShapeId ? getShape(homeShapeId) : undefined;
  if (home?.inset === "main") return planFlights(counts, home.id, home.centroid);
  return planTally(counts, colorFor, numbers);
}

function planFlights(
  counts: ReadonlyMap<string, number>,
  homeId: string,
  [hx, hy]: [number, number],
): IntroPlan {
  const targets = [...counts.keys()]
    .filter((id) => id !== homeId && getShape(id))
    .sort((a, b) => rand(a) - rand(b));
  const gap =
    targets.length > 1 ? Math.max(FLIGHT_GAP_MS, MIN_SPREAD_MS / (targets.length - 1)) : 0;
  const flights: Flight[] = [{ shapeId: homeId, depart: 0, land: 0 }];
  targets.forEach((id, i) => {
    const shape = getShape(id)!;
    const depart = i * gap;
    const flight: Flight = { shapeId: id, depart, land: depart + FLIGHT_MS / 2 };
    if (shape.inset === "main") flight.arc = arcPath(hx, hy, shape.centroid[0], shape.centroid[1]);
    flights.push(flight);
  });
  const last = flights[flights.length - 1]!;
  return { kind: "flights", duration: last.depart + FLIGHT_MS, flights };
}

/** A quadratic curve that always bows up the screen, like a flight path on a globe. */
function arcPath(x0: number, y0: number, x1: number, y1: number): string {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const bow = len * 0.3;
  const cx = (x0 + x1) / 2 + nx * bow;
  const cy = (y0 + y1) / 2 + ny * bow;
  const r = (v: number) => Math.round(v * 10) / 10;
  return `M${r(x0)},${r(y0)} Q${r(cx)},${r(cy)} ${r(x1)},${r(y1)}`;
}

function planTally(
  counts: ReadonlyMap<string, number>,
  colorFor: (count: number) => string,
  numbers: number,
): IntroPlan {
  // One token per contact on each shape, shuffled, as if read from the file.
  const tokens: { id: string; r: number }[] = [];
  for (const [id, n] of counts) {
    if (!getShape(id)) continue;
    for (let i = 0; i < n; i++) tokens.push({ id, r: rand(id, i) });
  }
  tokens.sort((a, b) => a.r - b.r);
  const duration = Math.min(
    TALLY_MAX_MS,
    Math.max(TALLY_MIN_MS, tokens.length * TALLY_MS_PER_NUMBER),
  );
  const seen = new Map<string, number>();
  const steps = new Map<string, TallyStep[]>();
  tokens.forEach(({ id }, k) => {
    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    const color = colorFor(count);
    const list = steps.get(id) ?? [];
    if (list[list.length - 1]?.color !== color) {
      list.push({ at: easeInOutInverse((k + 1) / tokens.length) * duration, color });
      steps.set(id, list);
    }
  });
  return { kind: "tally", duration, steps, numbers };
}

/** False where the animation should not run: reduced motion, or no Web Animations (jsdom). */
export function canPlayIntro(): boolean {
  if (typeof Element === "undefined" || typeof Element.prototype.animate !== "function") {
    return false;
  }
  return !(
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Start the shape animations for a plan. Every animation ends on the shape's
 * own fill, so cancelling one at any point simply shows the finished map.
 */
export function playIntro(root: HTMLElement, plan: IntroPlan): Animation[] {
  const anims: Animation[] = [];
  const shape = (id: string) => root.querySelector<SVGElement>(`[data-shape="${CSS.escape(id)}"]`);
  const base = getComputedStyle(root).getPropertyValue("--map-fill").trim();

  if (plan.kind === "flights") {
    for (const f of plan.flights) {
      const el = shape(f.shapeId);
      if (!el) continue;
      const lit = getComputedStyle(el).fill;
      anims.push(
        el.animate(
          [
            { fill: base, filter: "none" },
            { fill: lit, filter: "brightness(1.45)", offset: 0.35 },
            { fill: lit, filter: "none" },
          ],
          { duration: LAND_MS, delay: f.land, easing: "ease-out", fill: "backwards" },
        ),
      );
    }
    return anims;
  }

  const d = plan.duration;
  for (const [id, steps] of plan.steps) {
    const el = shape(id);
    if (!el || steps.length === 0) continue;
    const frames: Keyframe[] = [{ offset: 0, fill: base }];
    let prev = base;
    let lastOffset = 0;
    for (const step of steps) {
      // Hold the old color until just before the change, then fade across.
      const from = Math.max(lastOffset, (step.at - TALLY_FADE_MS) / d);
      const to = Math.max(from, step.at / d);
      frames.push({ offset: from, fill: prev }, { offset: to, fill: step.color });
      prev = step.color;
      lastOffset = to;
    }
    frames.push({ offset: 1, fill: prev });
    anims.push(el.animate(frames, { duration: d }));
  }
  return anims;
}
