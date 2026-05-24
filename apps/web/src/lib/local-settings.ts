export type AiProviderCapability = "text" | "image";

export type LocalAiProvider = {
  id: string;
  name: string;
  type: "openai_compatible";
  baseUrl: string;
  apiKey: string;
  capabilities: AiProviderCapability[];
  models: string[];
  testStatus?: "unknown" | "success" | "failed";
  testedAt?: string;
  testDetail?: string;
  createdAt: string;
  updatedAt: string;
};

export type AiPurpose = string;

export type LocalAiRoute = {
  purpose: AiPurpose;
  providerId: string;
  model: string;
  params?: Record<string, unknown>;
};

const KEY_PROVIDERS = "ai-caiji.settings.ai.providers.v1";
const KEY_ROUTES = "ai-caiji.settings.ai.routes.v1";
const PREFERRED_TEXT_PURPOSES: AiPurpose[] = [
  "title",
  "title_package_lite",
  "title_package",
  "product_info",
  "image_prompt_package",
  "dimension_extract",
];
const PREFERRED_IMAGE_PURPOSES: AiPurpose[] = ["image_4grid", "image_generate"];

function safeJsonParse<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

export function loadLocalAiProviders(): LocalAiProvider[] {
  const raw = safeJsonParse<unknown>(typeof window === "undefined" ? null : window.localStorage.getItem(KEY_PROVIDERS));
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is LocalAiProvider => !!x && typeof x === "object") as LocalAiProvider[];
}

export function saveLocalAiProviders(items: LocalAiProvider[]): void {
  window.localStorage.setItem(KEY_PROVIDERS, JSON.stringify(items || []));
}

export function upsertLocalAiProvider(input: Omit<LocalAiProvider, "createdAt" | "updatedAt"> & Partial<Pick<LocalAiProvider, "createdAt">>): LocalAiProvider {
  const providers = loadLocalAiProviders();
  const existing = providers.find((p) => p.id === input.id);
  const next: LocalAiProvider = {
    ...existing,
    ...input,
    createdAt: input.createdAt || existing?.createdAt || nowIso(),
    updatedAt: nowIso(),
  } as LocalAiProvider;
  const merged = existing ? providers.map((p) => (p.id === next.id ? next : p)) : [next, ...providers];
  saveLocalAiProviders(merged);
  return next;
}

export function deleteLocalAiProvider(id: string): void {
  const providers = loadLocalAiProviders().filter((p) => p.id !== id);
  saveLocalAiProviders(providers);
  const routes = loadLocalAiRoutes().filter((r) => r.providerId !== id);
  saveLocalAiRoutes(routes);
}

export function loadLocalAiRoutes(): LocalAiRoute[] {
  const raw = safeJsonParse<unknown>(typeof window === "undefined" ? null : window.localStorage.getItem(KEY_ROUTES));
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is LocalAiRoute => {
    if (!x || typeof x !== "object") return false;
    const purpose = (x as { purpose?: unknown }).purpose;
    const providerId = (x as { providerId?: unknown }).providerId;
    const model = (x as { model?: unknown }).model;
    return typeof purpose === "string" && typeof providerId === "string" && typeof model === "string";
  }) as LocalAiRoute[];
}

export function saveLocalAiRoutes(items: LocalAiRoute[]): void {
  window.localStorage.setItem(KEY_ROUTES, JSON.stringify(items || []));
}

export function setLocalAiRoute(route: LocalAiRoute): void {
  const routes = loadLocalAiRoutes();
  const next = [route, ...routes.filter((r) => r.purpose !== route.purpose)];
  saveLocalAiRoutes(next);
}

export function ensureDefaultAiRoutes(): void {
  const routes = loadLocalAiRoutes();
  const cleaned = routes.filter(
    (route) =>
      typeof route.purpose === "string" &&
      typeof route.providerId === "string" &&
      typeof route.model === "string",
  );
  if (cleaned.length !== routes.length) {
    saveLocalAiRoutes(cleaned);
  }
}

export type LocalTextRuntime = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type LocalImageRuntime = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export function resolveLocalTextRuntime(preferredPurposes: AiPurpose[] = PREFERRED_TEXT_PURPOSES): LocalTextRuntime | null {
  const providers = loadLocalAiProviders();
  const routes = loadLocalAiRoutes();

  for (const purpose of preferredPurposes) {
    const route = routes.find((r) => r.purpose === purpose);
    if (!route?.providerId) continue;
    const provider = providers.find((p) => p.id === route.providerId);
    if (!provider) continue;
    if (!provider.capabilities.includes("text")) continue;
    if (!provider.apiKey.trim() || !provider.baseUrl.trim()) continue;
    return {
      apiKey: provider.apiKey.trim(),
      baseUrl: provider.baseUrl.trim(),
      model: (route.model || provider.models?.[0] || "").trim(),
    };
  }

  const fallback = providers.find((p) => p.capabilities.includes("text") && p.apiKey.trim() && p.baseUrl.trim());
  if (!fallback) return null;
  return {
    apiKey: fallback.apiKey.trim(),
    baseUrl: fallback.baseUrl.trim(),
    model: (fallback.models?.[0] || "").trim(),
  };
}

export function resolveLocalImageRuntime(preferredPurposes: AiPurpose[] = PREFERRED_IMAGE_PURPOSES): LocalImageRuntime | null {
  const providers = loadLocalAiProviders();
  const routes = loadLocalAiRoutes();

  for (const purpose of preferredPurposes) {
    const route = routes.find((r) => r.purpose === purpose);
    if (!route?.providerId) continue;
    const provider = providers.find((p) => p.id === route.providerId);
    if (!provider) continue;
    if (!provider.capabilities.includes("image")) continue;
    if (!provider.apiKey.trim() || !provider.baseUrl.trim()) continue;
    return {
      apiKey: provider.apiKey.trim(),
      baseUrl: provider.baseUrl.trim(),
      model: (route.model || provider.models?.[0] || "").trim(),
    };
  }

  const fallback = providers.find((p) => p.capabilities.includes("image") && p.apiKey.trim() && p.baseUrl.trim());
  if (!fallback) return null;
  return {
    apiKey: fallback.apiKey.trim(),
    baseUrl: fallback.baseUrl.trim(),
    model: (fallback.models?.[0] || "").trim(),
  };
}
