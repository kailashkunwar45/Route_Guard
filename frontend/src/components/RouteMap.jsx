import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import {
  buildLineGradientExpression,
  checkpointsToGeoJSON,
  fitBoundsPadding,
  routeLineFeature,
} from "../lib/geojson";
import { formatLocal, RISK, riskMeta, ROUTE_COLORS, UNKNOWN } from "../lib/risk";

const CIRCLE_COLORS = [
  "case",
  ["==", ["get", "risk"], 1],
  RISK[1].color,
  ["==", ["get", "risk"], 2],
  RISK[2].color,
  ["==", ["get", "risk"], 3],
  RISK[3].color,
  ["==", ["get", "risk"], 4],
  RISK[4].color,
  ["==", ["get", "risk"], 5],
  RISK[5].color,
  UNKNOWN.color,
];

function popupHtml(props) {
  const wind = props.wind_mph != null ? `${Number(props.wind_mph).toFixed(0)} mph` : "—";
  const rain = props.rain_in_hr != null ? `${Number(props.rain_in_hr).toFixed(2)} in/hr` : "—";
  const snow = props.snow_in_hr != null ? `${Number(props.snow_in_hr).toFixed(2)} in/hr` : "—";
  const riskLabel = props.riskLabel || riskMeta(props.risk === -1 ? null : props.risk).name;
  return `
    <div>
      <div style="font-weight:600;margin-bottom:4px">Checkpoint ${props.sequence} · ${riskLabel}</div>
      <div>ETA: ${formatLocal(props.eta_local)}</div>
      <div>Wind: ${wind}</div>
      <div>Rain: ${rain}</div>
      <div>Snow: ${snow}</div>
      ${
        props.weather_status && props.weather_status !== "ok"
          ? `<div style="margin-top:4px;color:#64748b">${props.weather_reason || "Weather unavailable"}</div>`
          : ""
      }
    </div>
  `;
}

/**
 * Mapbox map for routes + checkpoints, with optional heatmap mode.
 * Heatmap hour updates mutate a single GeoJSON source (no recreate / no network).
 */
export default function RouteMap({
  token,
  routes = [],
  selectedRouteId,
  onSelectRoute,
  selectedCheckpointSeq,
  onSelectCheckpoint,
  mapMode = "checkpoints",
  hour = 0,
  riskMode = "eta",
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const fittedRef = useRef(false);
  const rafRef = useRef(0);
  const pendingRef = useRef({ hour, riskMode });
  const routesRef = useRef(routes);
  const selectedRef = useRef(selectedRouteId);
  const onSelectRef = useRef(onSelectRoute);
  const onCpRef = useRef(onSelectCheckpoint);
  const routesKey = (routes || []).map((r) => r.id).join(",");

  routesRef.current = routes;
  selectedRef.current = selectedRouteId;
  onSelectRef.current = onSelectRoute;
  onCpRef.current = onSelectCheckpoint;
  pendingRef.current = { hour, riskMode };

  useEffect(() => {
    if (!token || !containerRef.current || mapRef.current) return;

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: [-98.5, 39.8],
      zoom: 3.5,
      attributionControl: true,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    popupRef.current = new mapboxgl.Popup({ closeButton: true, maxWidth: "240px" });
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("routes", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("checkpoints", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("heatmap-corridor", {
        type: "geojson",
        lineMetrics: true,
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "routes-dim",
        type: "line",
        source: "routes",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 3,
          "line-opacity": 0.25,
        },
        filter: ["!=", ["get", "selected"], true],
      });

      map.addLayer({
        id: "routes-selected",
        type: "line",
        source: "routes",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 5,
          "line-opacity": 1,
        },
        filter: ["==", ["get", "selected"], true],
      });

      map.addLayer({
        id: "cp-heatmap",
        type: "heatmap",
        source: "checkpoints",
        layout: { visibility: "none" },
        paint: {
          "heatmap-weight": [
            "interpolate",
            ["linear"],
            ["max", ["get", "risk"], 0],
            0,
            0.05,
            1,
            0.2,
            3,
            0.6,
            5,
            1,
          ],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 10, 1.2],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 4, 14, 10, 28],
          "heatmap-opacity": 0.75,
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0,
            "rgba(0,0,0,0)",
            0.2,
            RISK[1].color,
            0.4,
            RISK[2].color,
            0.6,
            RISK[3].color,
            0.8,
            RISK[4].color,
            1,
            RISK[5].color,
          ],
        },
      });

      map.addLayer({
        id: "corridor-gradient",
        type: "line",
        source: "heatmap-corridor",
        layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
        paint: {
          "line-width": 6,
          "line-opacity": 0.9,
          "line-gradient": [
            "interpolate",
            ["linear"],
            ["line-progress"],
            0,
            UNKNOWN.color,
            1,
            UNKNOWN.color,
          ],
        },
      });

      map.addLayer({
        id: "cp-circles",
        type: "circle",
        source: "checkpoints",
        paint: {
          "circle-radius": 6,
          "circle-color": CIRCLE_COLORS,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.95,
        },
      });

      const pickRoute = (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id != null && onSelectRef.current) onSelectRef.current(Number(id) || id);
      };
      map.on("click", "routes-dim", pickRoute);
      map.on("click", "routes-selected", pickRoute);
      map.on("click", "cp-circles", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const seq = f.properties?.sequence;
        if (seq != null && onCpRef.current) onCpRef.current(Number(seq));
        popupRef.current.setLngLat(f.geometry.coordinates).setHTML(popupHtml(f.properties)).addTo(map);
      });
      map.on("mouseenter", "cp-circles", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "cp-circles", () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("mouseenter", "routes-dim", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "routes-dim", () => {
        map.getCanvas().style.cursor = "";
      });

      syncRoutes(map, routesRef.current, selectedRef.current);
      syncCheckpoints(map, routesRef.current, selectedRef.current, pendingRef.current);
    });

    return () => {
      cancelAnimationFrame(rafRef.current);
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
      fittedRef.current = false;
    };
  }, [token]);

  useEffect(() => {
    fittedRef.current = false;
  }, [routesKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    syncRoutes(map, routes, selectedRouteId);
    applyModeVisibility(map, mapMode);
    syncCheckpoints(map, routes, selectedRouteId, { hour, riskMode });
    syncCorridor(map, routes, selectedRouteId, { hour, riskMode }, mapMode);
    emphasizeCheckpoint(map, selectedCheckpointSeq);
  }, [routes, selectedRouteId, mapMode, hour, riskMode, routesKey, selectedCheckpointSeq]);

  useEffect(() => {
    if (mapMode !== "heatmap") return;
    const map = mapRef.current;
    if (!map) return;

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (!map.isStyleLoaded()) return;
      syncCheckpoints(map, routesRef.current, selectedRef.current, { hour, riskMode });
      syncCorridor(map, routesRef.current, selectedRef.current, { hour, riskMode }, "heatmap");
    });
  }, [hour, riskMode, mapMode]);

  function syncRoutes(map, routeList, selectedId) {
    const features = (routeList || []).map((route, idx) => {
      const f = routeLineFeature(route);
      f.properties.color = ROUTE_COLORS[idx % ROUTE_COLORS.length];
      f.properties.selected = route.id === selectedId;
      return f;
    });
    const src = map.getSource("routes");
    if (src) src.setData({ type: "FeatureCollection", features });

    if (!fittedRef.current && features.length) {
      const bounds = new mapboxgl.LngLatBounds();
      for (const f of features) {
        for (const c of f.geometry.coordinates) bounds.extend(c);
      }
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: fitBoundsPadding(), maxZoom: 10, duration: 600 });
        fittedRef.current = true;
      }
    }
  }

  function selectedRoute(routeList, selectedId) {
    return (routeList || []).find((r) => r.id === selectedId) || routeList?.[0] || null;
  }

  function syncCheckpoints(map, routeList, selectedId, { hour: h, riskMode: mode }) {
    const route = selectedRoute(routeList, selectedId);
    const fc = checkpointsToGeoJSON(route?.checkpoints, mode, h);
    const src = map.getSource("checkpoints");
    if (src) src.setData(fc);
  }

  function syncCorridor(map, routeList, selectedId, { hour: h, riskMode: mode }, modeName) {
    const route = selectedRoute(routeList, selectedId);
    const corridorSrc = map.getSource("heatmap-corridor");
    if (!corridorSrc || !route) return;

    const feature = routeLineFeature(route);
    corridorSrc.setData({ type: "FeatureCollection", features: [feature] });

    if (modeName === "heatmap" && map.getLayer("corridor-gradient")) {
      const expr = buildLineGradientExpression(
        route.checkpoints,
        route.metrics?.total_mi || route.distance_mi,
        mode,
        h
      );
      map.setPaintProperty("corridor-gradient", "line-gradient", expr);
    }
  }

  function applyModeVisibility(map, mode) {
    if (!map.getLayer("cp-heatmap")) return;
    const heat = mode === "heatmap";
    map.setLayoutProperty("cp-heatmap", "visibility", heat ? "visible" : "none");
    map.setLayoutProperty("corridor-gradient", "visibility", heat ? "visible" : "none");
    map.setLayoutProperty("routes-dim", "visibility", heat ? "none" : "visible");
    map.setLayoutProperty("routes-selected", "visibility", heat ? "none" : "visible");
  }

  function emphasizeCheckpoint(map, seq) {
    if (!map.getLayer("cp-circles")) return;
    if (seq == null) {
      map.setPaintProperty("cp-circles", "circle-radius", 6);
      return;
    }
    map.setPaintProperty("cp-circles", "circle-radius", [
      "case",
      ["==", ["get", "sequence"], seq],
      9,
      6,
    ]);
  }

  if (!token) {
    return (
      <div className="grid h-full place-items-center bg-slate-100 p-6 text-center text-sm text-slate-500">
        Mapbox public token not configured. Set MAPBOX_PUBLIC_TOKEN on the backend.
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}
