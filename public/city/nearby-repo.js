// Pick by distance to the ground footprint, not the tower's centre or height.
export function pickNearbyRepo(candidates, position, forward, current = null, range = 12, aimed = null) {
  let best = null, bestScore = Infinity;
  for (const c of candidates) {
    const dx = c.x - position.x, dz = c.z - position.z;
    const distance = Math.hypot(Math.max(0, Math.abs(dx) - c.half), Math.max(0, Math.abs(dz) - c.half));
    if (distance > range) continue;
    const length = Math.hypot(dx, dz) || 1;
    const facing = (dx * forward.x + dz * forward.z) / length;
    if (facing < 0.05 && distance > 2) continue;
    const score = c.building === aimed ? -1 : distance + (1 - facing) * 4 - (c.building === current ? 1.2 : 0);
    if (score < bestScore) { bestScore = score; best = { building: c.building, distance }; }
  }
  return best;
}
