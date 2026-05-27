import { apiBaseUrl } from "@/lib/api";

export type DefaultRuleOption = {
  id: number;
  name: string;
  platform: string | null;
  site: string | null;
  fulfillment_mode: string | null;
  category_path: string | null;
  conditions_json?: Record<string, unknown>;
};

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: string };
    if (payload?.detail) return payload.detail;
  } catch {
    // ignore parse errors
  }
  return `HTTP ${response.status}`;
}

export async function listEnabledDefaultRules(): Promise<DefaultRuleOption[]> {
  const response = await fetch(`${apiBaseUrl}/api/default-rules?enabled=true&limit=200&offset=0`, { cache: "no-store" });
  if (!response.ok) throw new Error(await readError(response));
  const payload = (await response.json()) as { items?: DefaultRuleOption[] };
  return (payload.items || []).filter((item) => item.platform === "Temu" || item.platform == null);
}

export async function applyTaskDefaultRule(taskId: number, defaultRuleId: number | null): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/product-tasks/${taskId}/apply-default-rules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ default_rule_id: defaultRuleId }),
  });
  if (!response.ok) throw new Error(await readError(response));
}
