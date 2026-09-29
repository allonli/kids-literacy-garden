"use client";

import { useState } from "react";

type Props = {
  access: "checking" | "login-required" | "needs-original-device" | "ready";
  message: string | null;
  onLogin: (code: string) => Promise<boolean>;
  onCreateFresh: (code: string) => Promise<boolean>;
};

export function FamilyAccessGate({ access, message, onLogin, onCreateFresh }: Props) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (access === "checking") {
    return <main className="main-stage"><section className="panel access-panel"><div className="empty-icon">🌱</div><h1>正在检查永久保存状态…</h1><p>马上就好，旧学习进度不会被清除。</p></section></main>;
  }

  async function submitLogin() {
    if (!/^\d{6}$/.test(code)) return;
    setSubmitting(true);
    await onLogin(code);
    setSubmitting(false);
  }

  async function createFresh() {
    if (!/^\d{6}$/.test(code)) return;
    if (!window.confirm("服务器还没有学习进度。确定创建全新进度吗？此操作只适用于没有旧设备进度的家庭。")) return;
    setSubmitting(true);
    await onCreateFresh(code);
    setSubmitting(false);
  }

  return <main className="main-stage">
    <section className="panel access-panel">
      <div className="empty-icon">🔐</div>
      <h1>{access === "needs-original-device" ? "请先保存原设备进度" : "输入家庭码"}</h1>
      {access === "needs-original-device"
        ? <p>服务器还是空的。请先在原来学习的设备上登录并保存进度，避免从空白设备开始。</p>
        : <p>每台设备只需输入一次，之后学习进度会自动永久保存。</p>}
      {message && <p className="access-message" role="status">{message}</p>}
      <div className="access-form">
        <label htmlFor="family-code">六位数字家庭码</label>
        <input id="family-code" aria-label="六位数字家庭码" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="请输入家庭码" />
        {access === "needs-original-device"
          ? <button className="btn btn-again" type="button" disabled={submitting || code.length !== 6} onClick={createFresh}>确认没有旧进度，创建全新进度</button>
          : <button className="btn btn-primary" type="button" disabled={submitting || code.length !== 6} onClick={submitLogin}>{submitting ? "正在验证…" : "登录并保存进度"}</button>}
      </div>
    </section>
  </main>;
}
