import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import {
  buildLineGradientExpression,
  checkpointsToGeoJSON,
  findCheckpoint,
  fitBoundsPadding,
  routeLineFeature,
} from "../lib/geojson";
import { formatLocal, RISK, riskMeta, ROUTE_COLORS, UNKNOWN } from "../lib/risk";
import MapLegend from "./MapLegend";

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
 * Mapbox map for routes + checkpoints.
 * Heatmap hour updates mutate one GeoJSON source via requestAnimationFrame — no network, no map recreate.
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
  hasAnalysis = false,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const fittedRef = useRef(false);
  const rafRef = useRef(0);
  const routesRef = useRef(routes);
  const selectedRef = useRef(selectedRouteId);
  const onSelectRef = useRef(onSelectRoute);
  const onCpRef = useRef(onSelectCheckpoint);
  const hourRef = useRef(hour);
  const riskModeRef = useRef(riskMode);
  const mapModeRef = useRef(mapMode);
  const routesKey = (routes || []).map((r) => r.id).join(",");

  routesRef.current = routes;
  selectedRef.current = selectedRouteId;
  onSelectRef.current = onSelectRoute;
  onCpRef.current = onSelectCheckpoint;
  hourRef.current = hour;
  riskModeRef.current = riskMode;
  mapModeRef.current = mapMode;

  useEffect(() => {
    if (!token || !containerRef.current || mapRef.current) return;

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: [-98.5, 39.8],
      zoom: 3.5,
      attributionControl: true,
      fadeDuration: 0,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    popupRef.current = new mapboxgl.Popup({ closeButton: true, maxWidth: "260px", offset: 12 });
    mapRef.current = map;

    const ro = new ResizeObserver(() => {
      map.resize();
    });
    ro.observe(containerRef.current);

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
          "line-width": 3.5,
          "line-opacity": 0.28,
        },
        filter: ["!=", ["get", "selected"], true],
      });
      map.addLayer({
        id: "routes-selected",
        type: "line",
        source: "routes",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 6,
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
            0.55,
            5,
            1,
          ],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 4, 0.45, 8, 0.85, 11, 1.25],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 4, 16, 8, 24, 11, 32],
          "heatmap-opacity": 0.72,
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0,
            "rgba(0,0,0,0)",
            0.15,
            RISK[1].color,
            0.35,
            RISK[2].color,
            0.55,
            RISK[3].color,
            0.75,
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
          "line-width": 7,
          "line-opacity": 0.92,
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
          "circle-radius": 6.5,
          "circle-color": CIRCLE_COLORS,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.96,
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

      ["cp-circles", "routes-dim", "routes-selected"].forEach((layer) => {
        map.on("mouseenter", layer, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
        });
      });

      paintAll(
        map,
        routesRef.current,
        selectedRef.current,
        mapModeRef.current,
        hourRef.current,
        riskModeRef.current
      );
    });

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
      fittedRef.current = false;
    };
  }, [token]);

  useEffect(() => {
    fittedRef.current = false;
  }, [routesKey]);

  // Structural updates (routes / selection / tab) — immediate
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    paintAll(map, routes, selectedRouteId, mapMode, hour, riskMode);
    emphasizeCheckpoint(map, selectedCheckpointSeq);
  }, [routes, selectedRouteId, mapMode, routesKey, selectedCheckpointSeq]);

  // Slider / mode hour updates — single rAF, mutate sources only
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (!map.isStyleLoaded()) return;
      if (mapMode === "heatmap") {
        syncCheckpoints(map, routesRef.current, selectedRef.current, hour, riskMode);
        syncCorridor(map, routesRef.current, selectedRef.current, hour, riskMode, true);
      } else {
        syncCheckpoints(map, routesRef.current, selectedRef.current, hour, "eta");
      }
    });
    return () => cancelAnimationFrame(rafRef.current);
  }, [hour, riskMode, mapMode]);

  // Ease camera to selected checkpoint
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || selectedCheckpointSeq == null) return;
    const route =
      (routes || []).find((r) => r.id === selectedRouteId) || routes?.[0] || null;
    const cp = findCheckpoint(route, selectedCheckpointSeq);
    if (!cp) return;
    map.easeTo({
      center: [cp.lon, cp.lat],
      zoom: Math.max(map.getZoom(), 7.5),
      duration: 450,
    });
  }, [selectedCheckpointSeq, selectedRouteId, routesKey]);

  function paintAll(map, routeList, selectedId, mode, h, rMode) {
    syncRoutes(map, routeList, selectedId);
    applyModeVisibility(map, mode);
    syncCheckpoints(map, routeList, selectedId, h, mode === "heatmap" ? rMode : "eta");
    syncCorridor(map, routeList, selectedId, h, rMode, mode === "heatmap");
  }

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
        map.fitBounds(bounds, { padding: fitBoundsPadding(), maxZoom: 10, duration: 700 });
        fittedRef.current = true;
      }
    }
  }

  function selectedRoute(routeList, selectedId) {
    return (routeList || []).find((r) => r.id === selectedId) || routeList?.[0] || null;
  }

  function syncCheckpoints(map, routeList, selectedId, h, mode) {
    const route = selectedRoute(routeList, selectedId);
    const src = map.getSource("checkpoints");
    if (src) src.setData(checkpointsToGeoJSON(route?.checkpoints, mode, h));
  }

  function syncCorridor(map, routeList, selectedId, h, mode, enabled) {
    const route = selectedRoute(routeList, selectedId);
    const corridorSrc = map.getSource("heatmap-corridor");
    if (!corridorSrc) return;
    if (!route || !enabled) {
      corridorSrc.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    corridorSrc.setData({
      type: "FeatureCollection",
      features: [routeLineFeature(route)],
    });
    if (map.getLayer("corridor-gradient")) {
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
    map.setPaintProperty(
      "cp-circles",
      "circle-radius",
      seq == null
        ? 6.5
        : ["case", ["==", ["get", "sequence"], seq], 10, 6]
    );
    map.setPaintProperty(
      "cp-circles",
      "circle-stroke-width",
      seq == null
        ? 1.5
        : ["case", ["==", ["get", "sequence"], seq], 2.5, 1.5]
    );
  }

  if (!token) {
    return (
      <div className="grid h-full place-items-center bg-slate-100 p-6 text-center text-sm text-slate-600">
        <div className="max-w-sm space-y-2">
          <p className="font-medium text-slate-800">Map token missing</p>
          <p>
            Set <code className="rounded bg-white px-1 border border-slate-200">MAPBOX_PUBLIC_TOKEN</code>{" "}
            on the backend. Analysis still works without the map.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {hasAnalysis && <MapLegend mode={mapMode} />}
      {!hasAnalysis && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="rounded border border-slate-200 bg-white/95 px-4 py-3 text-center text-sm text-slate-600 shadow-sm">
            Plan a route to plot corridors and checkpoints
          </div>
        </div>
      )}
    </div>
  );
}
