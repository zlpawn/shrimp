/**
 * Trend Intelligence Engine - Trend Velocity & Lifecycle State Machine
 */

export const TREND_STATES = ["NEW", "RISING", "RAPID_RISING", "PEAK", "DECLINING", "DEAD"];

/**
 * Calculates multi-platform spread and platform coverage.
 * @param {Array<{platform: string}>} itemMatches 
 * @returns {{ platformCount: number, platforms: string[], spreadScore: number }}
 */
export function calculateMultiPlatformSpread(itemMatches = []) {
  if (!Array.isArray(itemMatches)) {
    return { platformCount: 0, platforms: [], spreadScore: 0 };
  }

  const platforms = [...new Set(
    itemMatches
      .map(item => item && item.platform)
      .filter(p => typeof p === "string" && p.trim().length > 0)
  )];

  const platformCount = platforms.length;
  const spreadScore = platformCount <= 1 ? platformCount : (platformCount * 1.5);

  return {
    platformCount,
    platforms,
    spreadScore
  };
}

/**
 * Calculates velocity and lifecycle state from chronological rank snapshots.
 * 
 * @param {Array<{rank: number, score?: number, recorded_at: string}>} rawSnapshots 
 * @param {Object} [options]
 * @param {number} [options.platformCount] - Multi-platform presence count
 * @returns {{
 *   velocity: number,
 *   state: "NEW" | "RISING" | "RAPID_RISING" | "PEAK" | "DECLINING" | "DEAD",
 *   deltaRank: number,
 *   currentRank: number | null,
 *   previousRank: number | null,
 *   peakRank: number | null,
 *   durationHours: number,
 *   snapshotCount: number
 * }}
 */
export function calculateVelocityAndState(rawSnapshots = [], options = {}) {
  if (!Array.isArray(rawSnapshots) || rawSnapshots.length === 0) {
    return {
      velocity: 0,
      state: "NEW",
      deltaRank: 0,
      currentRank: null,
      previousRank: null,
      peakRank: null,
      durationHours: 0,
      snapshotCount: 0
    };
  }

  // Filter valid snapshots and sort chronologically (oldest first)
  const snapshots = rawSnapshots
    .filter(s => s && Number.isFinite(Number(s.rank)))
    .map(s => ({
      rank: Number(s.rank),
      score: s.score !== undefined && s.score !== null ? Number(s.score) : null,
      recorded_at: s.recorded_at ? new Date(s.recorded_at).toISOString() : new Date().toISOString(),
      timestamp: s.recorded_at ? new Date(s.recorded_at).getTime() : Date.now()
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  if (snapshots.length === 0) {
    return {
      velocity: 0,
      state: "NEW",
      deltaRank: 0,
      currentRank: null,
      previousRank: null,
      peakRank: null,
      durationHours: 0,
      snapshotCount: 0
    };
  }

  const n = snapshots.length;
  const first = snapshots[0];
  const latest = snapshots[n - 1];
  const previous = n > 1 ? snapshots[n - 2] : first;

  const currentRank = latest.rank;
  const previousRank = previous.rank;
  const firstRank = first.rank;
  const peakRank = Math.min(...snapshots.map(s => s.rank));
  const deltaRank = firstRank - currentRank; // Positive means climbing towards #1

  if (n === 1) {
    return {
      velocity: 0,
      state: "NEW",
      deltaRank: 0,
      currentRank,
      previousRank,
      peakRank,
      durationHours: 0,
      snapshotCount: 1
    };
  }

  const durationMs = Math.max(0, latest.timestamp - first.timestamp);
  const durationHours = durationMs / (1000 * 60 * 60);

  // Linear regression to compute rank slope (ranks per hour)
  // Let y = -rank so that an improvement in rank (e.g. 28 -> 3) corresponds to positive slope.
  let velocity = 0;

  if (durationMs > 0) {
    const xPoints = snapshots.map(s => (s.timestamp - first.timestamp) / (1000 * 60 * 60));
    const yPoints = snapshots.map(s => -s.rank);

    const meanX = xPoints.reduce((acc, v) => acc + v, 0) / n;
    const meanY = yPoints.reduce((acc, v) => acc + v, 0) / n;

    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
      const dx = xPoints[i] - meanX;
      const dy = yPoints[i] - meanY;
      sxx += dx * dx;
      sxy += dx * dy;
    }

    if (sxx > 0) {
      velocity = sxy / sxx;
    } else {
      const effectiveHours = Math.max(durationHours, 1 / 60);
      velocity = deltaRank / effectiveHours;
    }
  } else {
    velocity = deltaRank;
  }

  velocity = Number(velocity.toFixed(2));

  // Determine state
  const platformCount = Math.max(1, Number(options.platformCount) || 1);
  let state = "NEW";

  if (currentRank > 50 && (velocity <= 0 || currentRank >= 80 || durationHours > 6)) {
    state = "DEAD";
  } else if (
    (currentRank <= 5 && peakRank <= 3 && Math.abs(velocity) <= 3) ||
    (currentRank <= 3 && Math.abs(velocity) <= 5)
  ) {
    state = "PEAK";
  } else if (
    velocity >= 10 ||
    (velocity >= 5 && platformCount >= 2) ||
    (deltaRank >= 15 && durationHours <= 2)
  ) {
    state = "RAPID_RISING";
  } else if (
    velocity >= 2 ||
    (deltaRank > 0 && currentRank < previousRank && velocity > 0)
  ) {
    state = "RISING";
  } else if (
    velocity <= -3 ||
    (deltaRank < 0 && currentRank > previousRank && velocity < -1)
  ) {
    state = "DECLINING";
  } else if (durationHours < 0.25 || n <= 1) {
    state = "NEW";
  } else {
    if (velocity > 0.5) {
      state = "RISING";
    } else if (velocity < -0.5) {
      state = "DECLINING";
    } else if (currentRank <= 10) {
      state = "PEAK";
    } else {
      state = "NEW";
    }
  }

  return {
    velocity,
    state,
    deltaRank,
    currentRank,
    previousRank,
    peakRank,
    durationHours: Number(durationHours.toFixed(3)),
    snapshotCount: n
  };
}

/**
 * Basic velocity calculator wrapper.
 * @param {Array<{rank: number, recorded_at: string}>} snapshots 
 * @returns {{ velocity: number, state: string, deltaRank: number }}
 */
export function calculateVelocity(snapshots) {
  const result = calculateVelocityAndState(snapshots);
  return {
    velocity: result.velocity,
    state: result.state,
    deltaRank: result.deltaRank,
    currentRank: result.currentRank,
    previousRank: result.previousRank,
    peakRank: result.peakRank,
    durationHours: result.durationHours,
    snapshotCount: result.snapshotCount
  };
}
