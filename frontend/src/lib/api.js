import axios from "axios";

const baseURL = import.meta.env.VITE_API_BASE || "/api";

export const api = axios.create({
  baseURL,
  timeout: 60000,
});

export async function fetchConfig() {
  const { data } = await api.get("/config/");
  return data;
}

export async function geocode(q) {
  const { data } = await api.get("/geocode/", { params: { q } });
  return data.results || [];
}

export async function analyze(payload) {
  const { data } = await api.post("/routes/analyze/", payload);
  return data;
}

export async function listAnalyses() {
  const { data } = await api.get("/routes/");
  return data;
}

export async function getAnalysis(id) {
  const { data } = await api.get(`/routes/${id}/`);
  return data;
}

export function errorMessage(err) {
  return (
    err?.response?.data?.detail ||
    err?.message ||
    "Request failed"
  );
}
