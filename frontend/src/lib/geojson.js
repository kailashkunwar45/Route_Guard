import { riskMeta } from "./risk";

/** Build checkpoint FeatureCollection; riskField is 'eta' or hour index 0..48 */
export function checkpointsToGeoJSON(checkpoints, riskMode = "eta", hour = 0) {
  const features = (checkpoints || []).map((cp) => {
    let risk = cp.risk_level;
    if (riskMode === "hour") {
      const arr = cp.risk_by_hour || [];
      risk = arr[hour] != null ? arr[hour] : null;
    }
    return {
      type: "Feature",
      properties: {
        id: cp.id,
        sequence: cp.sequence,
        risk: risk == null ? -1 : Number(risk),
        riskLabel: riskMeta(risk).name,
        eta_local: cp.eta_local || cp.eta_utc || "",
        wind_mph: cp.wind_mph,
        rain_in_hr: cp.rain_in_hr,
        snow_in_hr: cp.snow_in_hr,
        weather_status: cp.weather_status,
        weather_reason: cp.weather_reason || "",
        distance_mi: cp.distance_mi,
        explanation: cp.risk_explanation || "",
      },
      geometry: {
        type: "Point",
        coordinates: [cp.lon, cp.lat],
      },
    };
  });
  return { type: "FeatureCollection", features };
}

/** LineString for a route ([lon, lat] coordinates). */
export function routeLineFeature(route) {
  return {
    type: "Feature",
    properties: { id: route.id, label: route.label },
    geometry: {
      type: "LineString",
      coordinates: route.coordinates || [],
    },
  };
}

function checkpointRisk(cp, riskMode, hour) {
  if (riskMode === "hour") {
    const arr = cp.risk_by_hour || [];
    return arr[hour] != null ? arr[hour] : null;
  }
  return cp.risk_level;
}

/**
 * Build line-gradient stops from segment risks (max of endpoint checkpoints).
 * progress is distance_mi / total_mi (0..1).
 */
export function buildLineGradientExpression(checkpoints, totalMi, riskMode = "eta", hour = 0) {
  const cps = checkpoints || [];
  if (!cps.length || !totalMi) {
    return ["interpolate", ["linear"], ["line-progress"], 0, riskMeta(null).color, 1, riskMeta(null).color];
  }

  const levels = cps.map((cp) => checkpointRisk(cp, riskMode, hour));
  const raw = [];

  if (cps.length === 1) {
    raw.push(0, riskMeta(levels[0]).color, 1, riskMeta(levels[0]).color);
  } else {
    for (let i = 0; i < cps.length - 1; i++) {
      const a = levels[i];
      const b = levels[i + 1];
      let seg = null;
      if (a != null && b != null) seg = Math.max(a, b);
      else if (a != null) seg = a;
      else if (b != null) seg = b;
      const t0 = Math.min(1, Math.max(0, (cps[i].distance_mi || 0) / totalMi));
      const t1 = Math.min(1, Math.max(0, (cps[i + 1].distance_mi || 0) / totalMi));
      const color = riskMeta(seg).color;
      raw.push(t0, color, Math.max(t0, t1 - 0.0001), color);
    }
  }

  // Deduplicate non-increasing progress (Mapbox requires strictly increasing)
  const cleaned = [];
  for (let i = 0; i < raw.length; i += 2) {
    const p = raw[i];
    const c = raw[i + 1];
    if (cleaned.length && p <= cleaned[cleaned.length - 2]) {
      cleaned[cleaned.length - 1] = c;
    } else {
      cleaned.push(p, c);
    }
  }
  if (cleaned[0] !== 0) cleaned.unshift(0, cleaned[1]);
  if (cleaned[cleaned.length - 2] !== 1) cleaned.push(1, cleaned[cleaned.length - 1]);

  return ["interpolate", ["linear"], ["line-progress"], ...cleaned];
}

export function countRisks(checkpoints, riskMode = "eta", hour = 0) {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unavailable: 0 };
  for (const cp of checkpoints || []) {
    let risk = cp.risk_level;
    if (riskMode === "hour") {
      const arr = cp.risk_by_hour || [];
      risk = arr[hour] != null ? arr[hour] : null;
    }
    if (risk == null) counts.unavailable += 1;
    else if (counts[risk] != null) counts[risk] += 1;
    else counts.unavailable += 1;
  }
  return counts;
}

export function fitBoundsPadding() {
  return { top: 48, bottom: 48, left: 48, right: 48 };
}
