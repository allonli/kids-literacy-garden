"use client";

type Props = {
  phase: "checking" | "saving" | "saved" | "offline" | "conflict" | "error";
  message: string | null;
  lastSavedAt: string | null;
  onRetry: () => void;
};

export function SyncStatus({ phase, message, lastSavedAt, onRetry }: Props) {
  if (!message) return null;
  const retryable = phase === "offline" || phase === "error";
  const time = lastSavedAt && phase === "saved"
    ? new Date(lastSavedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : null;
  return <div className={`sync-status sync-${phase}`} role="status">
    <span>{message}{time ? ` · ${time}` : ""}</span>
    {retryable && <button type="button" onClick={onRetry}>重试</button>}
  </div>;
}
