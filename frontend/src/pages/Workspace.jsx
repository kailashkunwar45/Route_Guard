import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronUp, PanelBottom } from "lucide-react";
import PlannerForm from "../components/PlannerForm";
import RouteCards from "../components/RouteCards";
import CheckpointPanel from "../components/CheckpointPanel";
import RecommendationBanner from "../components/RecommendationBanner";
import HeatmapControls from "../components/HeatmapControls";
import {
  ErrorBanner,
  FixtureBanner,
  ProfileDisclaimer,
  SkeletonBlock,
} from "../components/StatusBanners";
import { analyze, errorMessage, fetchConfig, getAnalysis } from "../lib/api";

const RouteMap = lazy(() => import("../components/RouteMap"));

export default function Workspace() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [config, setConfig] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [selectedSeq, setSelectedSeq] = useState(null);
  const [tab, setTab] = useState("checkpoints");
  const [hour, setHour] = useState(0);
  const [riskMode, setRiskMode] = useState("eta");
  const [loading, setLoading] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(Boolean(id));
  const [error, setError] = useState("");
  const [sheetOpen, setSheetOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchConfig()
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!id) {
      setLoadingExisting(false);
      return;
    }
    let cancelled = false;
    setLoadingExisting(true);
    setError("");
    getAnalysis(id)
      .then((data) => {
        if (cancelled) return;
        applyAnalysis(data);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingExisting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  function applyAnalysis(data) {
    setAnalysis(data);
    const preferred =
      data.recommendation?.recommended_route_id ?? data.routes?.[0]?.id ?? null;
    setSelectedRouteId(preferred);
    setSelectedSeq(data.routes?.[0]?.checkpoints?.[0]?.sequence ?? null);
    setTab("checkpoints");
    setHour(0);
    setRiskMode("eta");
  }

  async function handleAnalyze(payload) {
    setLoading(true);
    setError("");
    try {
      const data = await analyze(payload);
      applyAnalysis(data);
      navigate(`/analysis/${data.id}`, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  const selectedRoute = useMemo(() => {
    if (!analysis?.routes?.length) return null;
    return analysis.routes.find((r) => r.id === selectedRouteId) || analysis.routes[0];
  }, [analysis, selectedRouteId]);

  function handleSelectRoute(routeId) {
    setSelectedRouteId(routeId);
    const route = analysis?.routes?.find((r) => r.id === routeId);
    setSelectedSeq(route?.checkpoints?.[0]?.sequence ?? null);
  }

  const mapToken =
    config?.mapbox_public_token || import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN || "";
  const showFixtures = analysis?.use_fixtures ?? config?.use_fixtures;

  const plannerPanel = (
    <div className="space-y-3">
      <div>
        <h1 className="text-base font-semibold text-slate-900">RouteGuard planner</h1>
        <p className="text-xs text-slate-500">
          Safest corridor by weather, load, and time — map-first, no extra dashboards.
        </p>
      </div>
      <PlannerForm onSubmit={handleAnalyze} loading={loading} />
      <ProfileDisclaimer note={analysis?.profile_note} />
      <FixtureBanner show={showFixtures} />
      <ErrorBanner message={error} onDismiss={() => setError("")} />
      {(loading || loadingExisting) && (
        <div className="space-y-2">
          <SkeletonBlock className="h-16 w-full" />
          <SkeletonBlock className="h-16 w-full" />
        </div>
      )}
      {analysis && !loadingExisting && (
        <>
          <RecommendationBanner
            recommendation={analysis.recommendation}
            routes={analysis.routes}
          />
          {analysis.provider_count_message && (
            <p className="text-xs text-slate-500">{analysis.provider_count_message}</p>
          )}
          <RouteCards
            routes={analysis.routes}
            recommendation={analysis.recommendation}
            selectedId={selectedRoute?.id}
            onSelect={handleSelectRoute}
          />
        </>
      )}
    </div>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col lg:flex-row">
      {/* Desktop left panel */}
      <aside className="hidden w-[380px] shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-4 lg:block">
        {plannerPanel}
      </aside>

      {/* Map + tabs */}
      <section className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-3 py-2">
          {["checkpoints", "heatmap"].map((t) => (
            <button
              key={t}
              type="button"
              disabled={!analysis}
              onClick={() => setTab(t)}
              className={`rounded px-3 py-1.5 text-sm font-medium capitalize disabled:opacity-40 ${
                tab === t ? "bg-navy text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {t}
            </button>
          ))}
          {analysis && (
            <span className="ml-auto hidden truncate text-xs text-slate-500 sm:inline max-w-[45%]">
              {analysis.origin?.name?.split(",")[0]} → {analysis.destination?.name?.split(",")[0]}
              {analysis.timezone ? ` · ${analysis.timezone}` : ""}
            </span>
          )}
        </div>

        <div className="relative min-h-0 flex-1 bg-slate-100">
          {loadingExisting ? (
            <div className="grid h-full place-items-center">
              <SkeletonBlock className="h-8 w-48" />
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="grid h-full place-items-center text-sm text-slate-500">
                  Loading map…
                </div>
              }
            >
              <RouteMap
                token={mapToken}
                routes={analysis?.routes || []}
                selectedRouteId={selectedRoute?.id}
                onSelectRoute={handleSelectRoute}
                selectedCheckpointSeq={selectedSeq}
                onSelectCheckpoint={setSelectedSeq}
                mapMode={tab === "heatmap" ? "heatmap" : "checkpoints"}
                hour={hour}
                riskMode={riskMode}
                hasAnalysis={Boolean(analysis)}
              />
            </Suspense>
          )}
        </div>

        {analysis && tab === "checkpoints" && (
          <div className="hidden max-h-[40%] overflow-auto border-t border-slate-200 bg-canvas p-3 lg:block">
            <CheckpointPanel
              route={selectedRoute}
              selectedSeq={selectedSeq}
              onSelect={setSelectedSeq}
              timezone={analysis.timezone}
            />
          </div>
        )}

        {analysis && tab === "heatmap" && (
          <div className="hidden border-t border-slate-200 bg-canvas p-3 lg:block">
            <HeatmapControls
              hour={hour}
              onHourChange={setHour}
              riskMode={riskMode}
              onRiskModeChange={setRiskMode}
              checkpoints={selectedRoute?.checkpoints}
            />
          </div>
        )}
      </section>

      {/* Mobile bottom sheet */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 lg:hidden">
        <div
          className={`pointer-events-auto rounded-t-lg border border-slate-200 bg-white shadow-sm transition-[max-height] ${
            sheetOpen ? "max-h-[70vh]" : "max-h-12"
          } overflow-hidden`}
        >
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
            onClick={() => setSheetOpen((v) => !v)}
          >
            <span className="inline-flex items-center gap-2">
              <PanelBottom size={16} />
              Planner & results
            </span>
            <ChevronUp
              size={16}
              className={`transition ${sheetOpen ? "rotate-180" : ""}`}
            />
          </button>
          {sheetOpen && (
            <div className="max-h-[calc(70vh-3rem)] space-y-3 overflow-y-auto border-t border-slate-100 px-4 pb-4">
              {plannerPanel}
              {analysis && tab === "checkpoints" && (
                <CheckpointPanel
                  route={selectedRoute}
                  selectedSeq={selectedSeq}
                  onSelect={setSelectedSeq}
                  timezone={analysis.timezone}
                />
              )}
              {analysis && tab === "heatmap" && (
                <HeatmapControls
                  hour={hour}
                  onHourChange={setHour}
                  riskMode={riskMode}
                  onRiskModeChange={setRiskMode}
                  checkpoints={selectedRoute?.checkpoints}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
