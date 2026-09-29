"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CharacterDialog } from "./CharacterDialog";

type Account = { id: string; name: string };
type Props = {
  accountId: string;
  blocked: boolean;
  canSwitch?: boolean;
  onSelect: (id: string) => void;
};

export function AccountMenu({ accountId, blocked, canSwitch = true, onSelect }: Props) {
  const inputId = useId();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    async function loadAccounts() {
      try {
        const response = await fetch("/api/accounts", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "暂时无法读取学习账户，请重试。");
        if (!Array.isArray(payload.accounts)) throw new Error("学习账户信息异常，请重试。");
        if (!controller.signal.aborted) setAccounts(payload.accounts);
      } catch (reason) {
        if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : "暂时无法读取学习账户，请重试。");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadAccounts();
    return () => controller.abort();
  }, [reload]);

  function retry() {
    setLoadError("");
    setLoading(true);
    setReload((value) => value + 1);
  }

  function close() {
    if (!submittingRef.current) setAdding(false);
  }

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || blocked || !canSwitch) return;
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 20) {
      setError("请填写 1–20 个字的账户名称。");
      return;
    }
    // 用同步标记挡住连续提交，避免按钮状态更新前重复创建账户。
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/accounts", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmedName, sourceAccountId: accountId }),
      });
      const payload = await response.json();
      if (response.status === 409 && payload.code === "ACCOUNT_NAME_EXISTS") {
        throw new Error("名称已存在，可取消后在账户列表选择，或换一个名称。");
      }
      if (!response.ok) throw new Error(payload.error || "添加失败，请重试。");
      if (!payload.account?.id || !Array.isArray(payload.accounts)) throw new Error("账户信息异常，请关闭弹窗后刷新账户列表。");
      setAccounts(payload.accounts);
      setAdding(false);
      onSelect(payload.account.id);
    } catch (reason) {
      setError(reason instanceof TypeError || reason instanceof SyntaxError
        ? "暂时无法确认是否添加成功。请取消后查看账户列表；若没有新账户，可检查网络后重试。"
        : reason instanceof Error ? reason.message : "添加失败，请检查网络后重试。");
      // 请求失败也可能已在服务器创建成功，只刷新目录，让用户自行选择，避免重复新建。
      retry();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const currentAccount = accounts.find((account) => account.id === accountId);
  const currentName = currentAccount?.name ?? (accountId === "default" ? "原有账户" : "当前账户");
  const unavailable = blocked || loading || Boolean(loadError) || submitting;

  return <section className="account-menu" aria-label="学习账户">
    <div className="account-menu-controls">
      {canSwitch ? <div className="account-menu-select">
        <label htmlFor={`${inputId}-select`}>当前学习账户</label>
        <select id={`${inputId}-select`} aria-label="切换学习账户" value={accountId} disabled={unavailable} onChange={(event) => onSelect(event.target.value)}>
          {!currentAccount && <option value={accountId}>{currentName}</option>}
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select>
      </div> : <div className="account-menu-current"><span>当前学习账户</span><strong>{currentName}</strong></div>}
      {canSwitch && <button className="btn btn-secondary" type="button" disabled={unavailable} onClick={() => { setName(""); setError(""); setAdding(true); }}>添加学习账户</button>}
    </div>
    {loading && <p className="account-menu-note" role="status">正在读取学习账户…</p>}
    {loadError && <div className="account-menu-error" role="alert"><span>{loadError}</span><button className="btn btn-small btn-ghost" type="button" onClick={retry}>重试读取</button></div>}
    {!canSwitch && <p className="account-menu-note">返回首页可切换账户。</p>}
    {blocked ? <p className="account-menu-note" role="status">请先完成当前进度的同步，再切换或添加学习账户。</p> : canSwitch && <p className="account-menu-note">每个账户的学习进度和周末清单独立保存。</p>}
    {adding && <CharacterDialog title="添加学习账户" onClose={close}>
      <form className="account-create-form" onSubmit={createAccount}>
        <p id={`${inputId}-help`}>沿用当前账户的字库和组词，新账户从零开始学习。两个账户的学习进度、今日学习和周末清单分别保存。</p>
        <div className="field">
          <label htmlFor={`${inputId}-name`}>账户名称</label>
          <input id={`${inputId}-name`} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：妹妹" required maxLength={20} autoComplete="off" aria-describedby={`${inputId}-help`} disabled={submitting || !canSwitch} />
          <small>填写 1–20 个字，方便区分学习账户。</small>
        </div>
        {error && <p className="character-error" role="alert">{error}</p>}
        {blocked && <p className="account-menu-note" role="status">请先完成当前进度的同步，再添加学习账户。</p>}
        {!canSwitch && <p className="account-menu-note">请关闭弹窗，返回首页后再添加学习账户。</p>}
        {submitting && <p className="account-menu-note" role="status">正在创建账户，请稍候…</p>}
        <div className="account-create-actions">
          <button className="btn btn-ghost" type="button" onClick={close} disabled={submitting}>取消</button>
          <button className="btn btn-primary" type="submit" disabled={blocked || submitting || !canSwitch || !name.trim()}>{submitting ? "正在添加…" : "添加并开始学习"}</button>
        </div>
      </form>
    </CharacterDialog>}
  </section>;
}
