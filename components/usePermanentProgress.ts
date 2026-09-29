"use client";

import { useEffect, useState } from "react";
import { createProgressSyncController } from "@/lib/progress-client.mjs";
import type { Dispatch, SetStateAction } from "react";
import type { LiteracyState } from "@/lib/types";

type Access = "checking" | "login-required" | "needs-original-device" | "ready";
type SyncPhase = "checking" | "saving" | "saved" | "offline" | "conflict" | "error";
type Snapshot = {
  state: LiteracyState;
  hydrated: boolean;
  access: Access;
  sync: {
    revision: number;
    pending: boolean;
    phase: SyncPhase;
    lastSavedAt: string | null;
    message: string | null;
  };
};

export function usePermanentProgress(initialState: () => LiteracyState, accountId = "default") {
  const [controller] = useState(() => createProgressSyncController({ initialState, accountId }));
  const [snapshot, setSnapshot] = useState<Snapshot>(() => controller.snapshot() as Snapshot);

  useEffect(() => {
    const unsubscribe = controller.subscribe((next: Snapshot) => setSnapshot(next));
    void controller.start();
    const handleOnline = () => { void controller.retry(); };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void controller.checkLatest();
    };
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      unsubscribe();
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [controller]);

  const setState: Dispatch<SetStateAction<LiteracyState>> = (action) => {
    void controller.update(action);
  };

  return {
    ...snapshot,
    setState,
    login: (code: string) => controller.login(code),
    createFresh: (code: string) => controller.createFresh(code),
    retry: () => controller.retry(),
    stop: () => controller.destroy(),
  };
}
