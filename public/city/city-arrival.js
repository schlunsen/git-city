const smooth = (x, a, b) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Let the loading overlay fade before the light slit opens onto the city.
// Levels feed the existing island-travel shader; no building transforms change.
export function cityArrivalLevels(elapsed, reducedMotion = false) {
  const t = Math.max(0, elapsed - 300) / 1400;
  if (t >= 1) return null;
  if (reducedMotion) return { amt: 0, white: 1 - smooth(t, 0, 1), opening: 1 };
  return {
    amt: 0.85 * (1 - smooth(t, 0.15, 1)),
    white: 0.18 * (1 - smooth(t, 0.1, 0.65)),
    opening: smooth(t, 0.08, 0.85),
  };
}
