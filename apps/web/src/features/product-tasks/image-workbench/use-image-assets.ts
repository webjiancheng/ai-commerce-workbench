"use client";

import { getJobStatus, listTaskAssets } from "@/features/product-tasks/image-workbench/api";
import type { AssetsBySlotResponse } from "@/features/product-tasks/types";
import { useCallback, useEffect, useState } from "react";

export function useImageAssets(taskId: number) {
  const [assets, setAssets] = useState<AssetsBySlotResponse>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listTaskAssets(taskId);
      setAssets(data || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载图片资产失败");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  const pollJob = useCallback(async (jobId: number, onDone?: () => Promise<void> | void) => {
    setJobStatus(`job ${jobId}: queued`);
    for (let i = 0; i < 60; i += 1) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const job = await getJobStatus(jobId);
        setJobStatus(`job ${jobId}: ${job.status} (${job.progress}%)${job.error_message ? ` - ${job.error_message}` : ""}`);
        if (job.status === "success" || job.status === "failed") break;
      } catch {
        break;
      }
    }
    await loadAssets();
    await onDone?.();
  }, [loadAssets]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  return {
    assets,
    setAssets,
    loading,
    error,
    setError,
    jobStatus,
    setJobStatus,
    loadAssets,
    pollJob,
  };
}
