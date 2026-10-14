const API_PATH = "/api/";

type HostWindow = typeof globalThis & { backendApiBase?: string };

// The aXet host exposes the backend origin as window.backendApiBase; relative API paths must be prefixed with it.
export function resolveApiUrl(url: string): string {
  if (!url.startsWith(API_PATH)) return url;

  const backendApiBase = (globalThis as HostWindow).backendApiBase?.replace(/\/$/, "");
  return backendApiBase ? `${backendApiBase}${url}` : url;
}
