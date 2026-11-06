import { riskMeta } from "./risk";

function checkpointRisk(cp, riskMode, hour) {
  if (riskMode === "hour") {
    const arr = cp.risk_by_hour || [];
    return arr[hour] != null ? arr[hour] : null;
  }
  return cp.risk_level;
}

function weatherAt(cp, riskMode, hour) {
  if (riskMode === "hour") {
    const sample = (cp.hourly_samples || [])[hour];
    if (sample) {
      return {
        wind_mph: sample.wind_mph,
        rain_in_hr: sample.rain_in_hr,
        snow_in_hr: sample.snow_in_hr,
        weather_status: sample.status || "unavailable",
        weather_reason: sample.reason || "",
      };
    }
  }
  return {
    wind_mph: cp.wind_mph,
    rain_in_hr: cp.rain_in_hr,
    snow_in_hr: cp.snow_in_hr,
    weather_status: cp.weather_status,
    weather_reason: cp.weather_reason || "",
  };
}

/** Build checkpoint FeatureCollection; riskMode is 'eta' or 'hour'. */
export function checkpointsToGeoJSON(checkpoints, riskMode = "eta", hour = 0) {
  const features = (checkpoints || []).map((cp) => {
    const risk = checkpointRisk(cp, riskMode, hour);
    const wx = weatherAt(cp, riskMode, hour);
    return {
      type: "Feature",
      properties: {
        id: cp.id,
        sequence: cp.sequence,
        risk: risk == null ? -1 : Number(risk),
        riskLabel: riskMeta(risk).name,
        eta_local: cp.eta_local || cp.eta_utc || "",
        wind_mph: wx.wind_mph,
        rain_in_hr: wx.rain_in_hr,
        snow_in_hr: wx.snow_in_hr,
        weather_status: wx.weather_status,
        weather_reason: wx.weather_reason,
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
      // Unavailable endpoint => unknown (gray), never treat as low
      const color = riskMeta(seg).color;
      const t0 = Math.min(1, Math.max(0, (cps[i].distance_mi || 0) / totalMi));
      const t1 = Math.min(1, Math.max(0, (cps[i + 1].distance_mi || 0) / totalMi));
      raw.push(t0, color, Math.max(t0, t1 - 0.0001), color);
    }
  }

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
  if (cleaned[0] !== 0) cleaned.unshift(0, cleaned[1] ?? riskMeta(null).color);
  if (cleaned[cleaned.length - 2] !== 1) {
    cleaned.push(1, cleaned[cleaned.length - 1] ?? riskMeta(null).color);
  }

  return ["interpolate", ["linear"], ["line-progress"], ...cleaned];
}

export function countRisks(checkpoints, riskMode = "eta", hour = 0) {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unavailable: 0 };
  for (const cp of checkpoints || []) {
    const risk = checkpointRisk(cp, riskMode, hour);
    if (risk == null) counts.unavailable += 1;
    else if (counts[risk] != null) counts[risk] += 1;
    else counts.unavailable += 1;
  }
  return counts;
}

export function fitBoundsPadding() {
  return { top: 56, bottom: 72, left: 56, right: 56 };
}

export function findCheckpoint(route, sequence) {
  return (route?.checkpoints || []).find((c) => c.sequence === sequence) || null;
}
