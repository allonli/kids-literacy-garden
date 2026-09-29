"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

export function CharacterDialog({ title, onClose, children }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    if (!dialog) return;

    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    // 详情与编辑共用弹窗，切换内容时把焦点带回标题，避免落到已移除的按钮上。
    headingRef.current?.focus();
  }, [title]);

  return (
    <dialog
      ref={dialogRef}
      className="character-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="character-dialog-heading">
        <h2 id={titleId} ref={headingRef} tabIndex={-1}>{title}</h2>
        <button className="btn btn-ghost btn-small" type="button" aria-label="关闭弹窗" onClick={onClose}>关闭</button>
      </div>
      <div className="character-dialog-content">{children}</div>
    </dialog>
  );
}
