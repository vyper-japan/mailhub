"use client";

import { AlertTriangle, CheckCircle, Send, X } from "lucide-react";

export type GmailComposePanelProps = {
  messageId: string;
  fromAlias: string | null;
  fromLabel: string | null;
  to: string | null;
  subject: string;
  bodyText: string;
  unresolvedVars: string[];
  readOnly: boolean;
  sendEnabled: boolean;
  sendDisabledReason:
    | null
    | "read_only"
    | "send_disabled"
    | "resolve_failed"
    | "send_as_unaccepted"
    | "unresolved_template_vars"
    | "empty_body"
    | "maybe_sent";
  isSendingGmailReply: boolean;
  sentStatus: "idle" | "sent" | "sent_and_done" | "sent_but_not_done" | "maybe_sent";
  errorMessage: string | null;
  onBodyChange: (value: string) => void;
  onSend: (postSendAction: "none" | "done") => void;
  onCancel: () => void;
};

type SendDisabledReason = NonNullable<GmailComposePanelProps["sendDisabledReason"]>;

const MAYBE_SENT_MESSAGE =
  "すでに同じ送信が処理されています。送信済みの可能性があるため、受信トレイ/送信済みを確認してください";

function disabledReasonMessage(reason: SendDisabledReason, errorMessage: string | null): string {
  switch (reason) {
    case "read_only":
      return "READ ONLYのため送信できません";
    case "send_disabled":
      return "Gmail送信はまだ有効化されていません";
    case "resolve_failed":
      return errorMessage ?? "返信先を解決できませんでした";
    case "send_as_unaccepted":
      return "このFromはGmail send-asで未承認です";
    case "unresolved_template_vars":
      return "未解決の変数があります";
    case "empty_body":
      return "本文を入力してください";
    case "maybe_sent":
      return MAYBE_SENT_MESSAGE;
  }
}

function sentStatusMessage(status: GmailComposePanelProps["sentStatus"]): string {
  switch (status) {
    case "sent":
      return "送信しました（送信は取り消せません）";
    case "sent_and_done":
      return "送信しました。Doneは元に戻せます";
    case "sent_but_not_done":
      return "送信しましたがDoneにできませんでした。手動で完了してください";
    case "maybe_sent":
      return MAYBE_SENT_MESSAGE;
    case "idle":
      return "";
  }
}

function getEffectiveDisabledReason({
  bodyText,
  readOnly,
  sendDisabledReason,
  sendEnabled,
  sentStatus,
  unresolvedVars,
}: Pick<
  GmailComposePanelProps,
  "bodyText" | "readOnly" | "sendDisabledReason" | "sendEnabled" | "sentStatus" | "unresolvedVars"
>): SendDisabledReason | null {
  if (readOnly) return "read_only";
  if (sentStatus === "maybe_sent") return "maybe_sent";
  if (sentStatus !== "idle") return null;
  if (!sendEnabled) return "send_disabled";
  if (sendDisabledReason) return sendDisabledReason;
  if (unresolvedVars.length > 0) return "unresolved_template_vars";
  if (!bodyText.trim()) return "empty_body";
  return null;
}

export function GmailComposePanel({
  messageId,
  fromAlias,
  fromLabel,
  to,
  subject,
  bodyText,
  unresolvedVars,
  readOnly,
  sendEnabled,
  sendDisabledReason,
  isSendingGmailReply,
  sentStatus,
  errorMessage,
  onBodyChange,
  onSend,
  onCancel,
}: GmailComposePanelProps) {
  const effectiveDisabledReason = getEffectiveDisabledReason({
    bodyText,
    readOnly,
    sendDisabledReason,
    sendEnabled,
    sentStatus,
    unresolvedVars,
  });
  const disableMessage = effectiveDisabledReason ? disabledReasonMessage(effectiveDisabledReason, errorMessage) : null;
  const errorDisplayMessage = disableMessage ?? errorMessage;
  const sentMessage = sentStatusMessage(sentStatus);
  const actionDisabled = isSendingGmailReply || effectiveDisabledReason !== null || sentStatus !== "idle";
  const bodyDisabled = readOnly || isSendingGmailReply || sentStatus !== "idle";
  const fromText = fromAlias ? (fromLabel ? `${fromLabel} <${fromAlias}>` : fromAlias) : "-";
  const readinessChecks = [
    { label: "From", ok: Boolean(fromAlias), detail: fromAlias ?? "未解決" },
    { label: "To", ok: Boolean(to), detail: to ?? "未解決" },
    { label: "本文", ok: Boolean(bodyText.trim()), detail: bodyText.trim() ? `${bodyText.trim().length}字` : "未入力" },
    { label: "変数", ok: unresolvedVars.length === 0, detail: unresolvedVars.length === 0 ? "OK" : `${unresolvedVars.length}件` },
    {
      label: "送信",
      ok: !effectiveDisabledReason && sentStatus === "idle",
      detail: effectiveDisabledReason ? disabledReasonMessage(effectiveDisabledReason, errorMessage) : "可能",
    },
  ];

  return (
    <div
      className="mt-6 rounded-lg border border-[#d2e3fc] bg-[#f8fbff] p-5"
      data-message-id={messageId}
      data-testid="gmail-compose-panel"
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Send size={16} className="text-blue-600" />
          <div>
            <div className="text-[13px] font-semibold text-[#202124]">Gmail返信</div>
            <div className="text-[11px] text-[#5f6368]">送信は取り消せません。宛先とFromを確認してから実行します。</div>
          </div>
        </div>
        {readOnly && (
          <span className="rounded-full border border-[#f4b4ae] bg-[#fce8e6] px-2 py-0.5 text-[12px] font-medium text-red-700">
            READ ONLY
          </span>
        )}
      </div>

      <div
        className="mb-4 grid gap-2 rounded-md border border-[#d2e3fc] bg-white p-3 sm:grid-cols-5"
        data-testid="gmail-compose-safety-checks"
      >
        {readinessChecks.map((check) => (
          <div key={check.label} className="min-w-0">
            <div className="flex items-center gap-1 text-[11px] font-medium text-[#5f6368]">
              {check.ok ? (
                <CheckCircle size={13} className="shrink-0 text-[#137333]" />
              ) : (
                <AlertTriangle size={13} className="shrink-0 text-[#ea8600]" />
              )}
              {check.label}
            </div>
            <div
              className={`mt-1 truncate text-[12px] font-medium ${check.ok ? "text-[#202124]" : "text-[#92400e]"}`}
              title={check.detail}
            >
              {check.detail}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 mb-4">
        <div>
          <div className="text-xs font-medium text-gray-500 mb-1">From</div>
          <div className="text-sm text-gray-900 bg-white border border-[#d2e3fc] rounded-md px-3 py-2" data-testid="gmail-compose-from">
            {fromText}
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-gray-500 mb-1">To</div>
          <div className="text-sm text-gray-900 bg-white border border-[#d2e3fc] rounded-md px-3 py-2" data-testid="gmail-compose-to">
            {to ?? "-"}
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-gray-500 mb-1">Subject</div>
          <div className="text-sm text-gray-900 bg-white border border-[#d2e3fc] rounded-md px-3 py-2" data-testid="gmail-compose-subject">
            {subject || "(no subject)"}
          </div>
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-700 mb-2" htmlFor={`gmail-compose-body-${messageId}`}>
          返信内容
        </label>
        <textarea
          id={`gmail-compose-body-${messageId}`}
          data-testid="reply-body"
          value={bodyText}
          onChange={(e) => onBodyChange(e.target.value)}
          rows={8}
          placeholder={readOnly ? "READ ONLYのため編集できません" : "返信内容を入力してください"}
          className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all resize-y font-mono disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed"
          disabled={bodyDisabled}
        />
        {unresolvedVars.length > 0 && (
          <div className="mt-2 text-[12px] text-[#ea8600] bg-[#fef7e0] p-2 rounded border border-[#fdd663]">
            未解決の変数: {unresolvedVars.join(", ")}（そのまま送らないでください）
          </div>
        )}
      </div>

      <div
        className={`mb-3 text-[12px] ${errorDisplayMessage ? "text-red-700 bg-red-50 border border-red-200 rounded p-2" : "text-transparent"}`}
        data-testid="gmail-compose-error"
        aria-live="polite"
      >
        {errorDisplayMessage ?? ""}
      </div>

      <div
        className={`mb-4 text-[12px] ${sentMessage ? "text-blue-800 bg-blue-100 border border-blue-200 rounded p-2" : "text-transparent"}`}
        data-testid="gmail-compose-sent"
        aria-live="polite"
      >
        {sentMessage}
      </div>

      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          data-testid="gmail-compose-send"
          onClick={() => onSend("none")}
          disabled={actionDisabled}
          className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-500 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed rounded-md text-sm font-medium transition-colors flex items-center gap-2"
        >
          <Send size={14} />
          {isSendingGmailReply ? "送信中..." : "Gmailで送信"}
        </button>
        <button
          type="button"
          data-testid="gmail-compose-send-and-done"
          onClick={() => onSend("done")}
          disabled={actionDisabled}
          className="px-4 py-2 bg-green-600 text-white hover:bg-green-500 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed rounded-md text-sm font-medium transition-colors flex items-center gap-2"
        >
          <CheckCircle size={14} />
          {isSendingGmailReply ? "送信中..." : "送信してDone"}
        </button>
        <button
          type="button"
          data-testid="gmail-compose-cancel"
          onClick={onCancel}
          disabled={isSendingGmailReply}
          className="px-4 py-2 bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed text-gray-700 rounded-md text-sm font-medium transition-colors flex items-center gap-2"
        >
          <X size={14} />
          キャンセル
        </button>
      </div>
    </div>
  );
}
