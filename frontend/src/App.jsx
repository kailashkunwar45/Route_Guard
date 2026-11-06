import { lazy, Suspense } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { Map as MapIcon } from "lucide-react";

const Workspace = lazy(() => import("./pages/Workspace"));
const History = lazy(() => import("./pages/History"));

function Shell({ children }) {
  return (
    <div className="h-full flex flex-col">
      <header className="h-12 shrink-0 bg-navy text-white flex items-center justify-between px-4 border-b border-black/20">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <MapIcon size={18} />
          RouteGuard
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link to="/" className="hover:text-blue-200">
            Workspace
          </Link>
          <Link to="/history" className="hover:text-blue-200">
            History
          </Link>
        </nav>
      </header>
      <main className="flex-1 min-h-0">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <Shell>
      <Suspense
        fallback={
          <div className="h-full grid place-items-center text-sm text-slate-500">Loading…</div>
        }
      >
        <Routes>
          <Route path="/" element={<Workspace />} />
          <Route path="/analysis/:id" element={<Workspace />} />
          <Route path="/history" element={<History />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Shell>
  );
}
