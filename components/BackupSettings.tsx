"use client";

import { useState } from "react";

type BackupLink = { path: string; expiresAt: string; exportedAt: string; profiles: { name: string; characters: number }[] };

export function BackupSettings({ blocked }: { blocked: boolean }) {
  const [link, setLink] = useState<BackupLink | null>(null);
  const [active, setActive] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [url, setURL] = useState("");

  async function request(method: string) {
    const response = await fetch("/api/ios-backups", { method, credentials: "same-origin", cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "备份暂时不可用，请重试。");
    return body;
  }
  async function refresh() {
    try { const status = await request("GET"); setActive(status.active); setExpiresAt(status.expiresAt || ""); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "无法读取备份状态，请重试。"); }
  }
  async function generate() {
    setBusy(true); setError(""); setMessage("");
    try {
      const result: BackupLink = await request("POST");
      setLink(result); setURL(new URL(result.path, window.location.origin).href);
      setActive(true); setExpiresAt(result.expiresAt);
      setMessage("备份已生成。可以下载 JSON，或将链接粘贴到 App 的在线导入入口。");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "生成失败，请重试；学习进度没有改变。"); }
    finally { setBusy(false); }
  }
  async function revoke() {
    if (!window.confirm("撤销这份备份链接？已经下载的文件不会被删除，网站和 App 的学习进度不受影响。")) return;
    setBusy(true); setError("");
    try {
      await request("DELETE"); setLink(null); setURL(""); setActive(false); setExpiresAt("");
      setMessage("链接已撤销，网站学习进度保持不变。");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "撤销失败，请重试。"); }
    finally { setBusy(false); }
  }
  async function copy() {
    setError("");
    try { await navigator.clipboard.writeText(url); setMessage("链接已复制，请只交给需要导入的家长。"); }
    catch { setError("浏览器未允许复制，请选中下方链接后手动复制。"); }
  }
  return (
    <section className="subpanel backup-settings">
      <details onToggle={(event) => { if (event.currentTarget.open) void refresh(); }}>
        <summary><h2>备份配置</h2></summary>
        <p>导出当前家庭已保存的全部学习账户，保留汉字资料、学习成绩、历史、今日队列和周末清单。可用于识字小花园 App 导入。</p>
        <p className="warning-note">链接可读取学习资料，有效 24 小时，请勿公开分享。生成新的备份会立即撤销旧链接；这是一份生成时的快照，不是实时同步。</p>
        {blocked && <p role="status">当前进度还未永久保存，请等待同步完成；断网时请先恢复网络再生成备份。</p>}
        <div className="backup-actions">
          <button className="btn btn-primary" type="button" onClick={() => void generate()} disabled={busy || blocked}>{busy ? "正在处理…" : active ? "重新生成备份" : "生成备份"}</button>
          {active && <button className="btn btn-ghost" type="button" onClick={() => void revoke()} disabled={busy}>撤销备份链接</button>}
        </div>
        {expiresAt && <p>链接有效至：{new Date(expiresAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}（北京时间）</p>}
        {link && <div>
          <p>本次包含 {link.profiles.length} 个账户：</p>
          <ul>{link.profiles.map((profile, index) => <li key={index}>{profile.name} · {profile.characters} 个字</li>)}</ul>
          <div className="backup-actions">
            <a className="btn btn-primary" href={link.path} download referrerPolicy="no-referrer">下载 JSON 备份</a>
            <button className="btn btn-ghost" type="button" onClick={() => void copy()}>复制 App 导入链接</button>
          </div>
          <label htmlFor="backup-link">App 导入链接</label>
          <input id="backup-link" name="backup-link" type="text" value={url} readOnly onFocus={(event) => event.currentTarget.select()} aria-describedby="backup-link-help" />
          <p id="backup-link-help">也可选中链接手动复制；离开本页后不会再次显示完整链接，需要时重新生成。</p>
        </div>}
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
      </details>
    </section>
  );
}
