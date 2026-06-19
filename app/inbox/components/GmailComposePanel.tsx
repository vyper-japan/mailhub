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
      className="mt-5 overflow-hidden rounded-lg border border-[#dadce0] bg-white shadow-[0_1px_2px_rgba(60,64,67,0.08)]"
      data-message-id={messageId}
      data-testid="gmail-compose-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8eaed] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e8f0fe] text-[#1a73e8]">
            <Send size={16} />
          </span>
          <div>
            <div className="text-[13px] font-semibold text-[#202124]">Gmail返信</div>
            <div className="text-[11px] leading-4 text-[#5f6368]">From / To / 本文を確認してから送信します。</div>
          </div>
        </div>
        {readOnly && (
          <span className="rounded-full border border-[#f4b4ae] bg-[#fce8e6] px-2 py-0.5 text-[12px] font-medium text-red-700">
            READ ONLY
          </span>
        )}
      </div>

      <div className="grid gap-1.5 px-4 py-3 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-1 text-[11px] font-medium text-[#5f6368]">From</div>
          <div className="min-h-9 whitespace-normal break-all rounded-md border border-[#dadce0] bg-[#f8fafd] px-3 py-2 text-[13px] text-[#202124]" data-testid="gmail-compose-from" title={fromText}>
            {fromText}
          </div>
        </div>
        <div className="min-w-0">
          <div className="mb-1 text-[11px] font-medium text-[#5f6368]">To</div>
          <div className="min-h-9 whitespace-normal break-all rounded-md border border-[#dadce0] bg-[#f8fafd] px-3 py-2 text-[13px] text-[#202124]" data-testid="gmail-compose-to" title={to ?? "-"}>
            {to ?? "-"}
          </div>
        </div>
        <div className="min-w-0 lg:col-span-2">
          <div className="mb-1 text-[11px] font-medium text-[#5f6368]">Subject</div>
          <div className="min-h-9 truncate rounded-md border border-[#dadce0] bg-[#f8fafd] px-3 py-2 text-[13px] text-[#202124]" data-testid="gmail-compose-subject" title={subject || "(no subject)"}>
            {subject || "(no subject)"}
          </div>
        </div>

        <div
          className="grid gap-1.5 rounded-md border border-[#e8eaed] bg-[#f8fafd] p-1.5 sm:grid-cols-5 lg:col-span-2"
          data-testid="gmail-compose-safety-checks"
        >
          {readinessChecks.map((check) => (
            <div key={check.label} className="min-w-0 rounded border border-[#e8eaed] bg-white px-1.5 py-1">
              <div className="flex items-center gap-1 text-[11px] font-medium text-[#5f6368]">
                {check.ok ? (
                  <CheckCircle size={13} className="shrink-0 text-[#137333]" />
                ) : (
                  <AlertTriangle size={13} className="shrink-0 text-[#ea8600]" />
                )}
                {check.label}
              </div>
              <div
                className={`mt-0.5 truncate text-[12px] font-medium leading-4 ${check.ok ? "text-[#202124]" : "text-[#92400e]"}`}
                title={check.detail}
              >
                {check.detail}
              </div>
            </div>
          ))}
        </div>

        <div className="lg:col-span-2">
          <label className="mb-1 block text-[12px] font-medium text-[#3c4043]" htmlFor={`gmail-compose-body-${messageId}`}>
            返信内容
          </label>
          <textarea
            id={`gmail-compose-body-${messageId}`}
            data-testid="reply-body"
            value={bodyText}
            onChange={(e) => onBodyChange(e.target.value)}
            rows={8}
            placeholder={readOnly ? "READ ONLYのため編集できません" : "返信内容を入力してください"}
            className="min-h-[220px] w-full resize-y rounded-md border border-[#dadce0] bg-white px-3 py-2 text-[14px] leading-[20px] text-[#202124] transition-all focus:border-[#1a73e8] focus:outline-none focus:ring-1 focus:ring-[#1a73e8]/40 disabled:cursor-not-allowed disabled:bg-[#f8fafd] disabled:text-[#5f6368]"
            disabled={bodyDisabled}
          />
          {unresolvedVars.length > 0 && (
            <div className="mt-2 text-[12px] text-[#ea8600] bg-[#fef7e0] p-2 rounded border border-[#fdd663]">
              未解決の変数: {unresolvedVars.join(", ")}（そのまま送らないでください）
            </div>
          )}
        </div>
      </div>

      <div
        className={`mx-4 mb-3 text-[12px] ${errorDisplayMessage ? "rounded border border-red-200 bg-red-50 p-2 text-red-700" : "hidden"}`}
        data-testid="gmail-compose-error"
        aria-live="polite"
      >
        {errorDisplayMessage ?? ""}
      </div>

      <div
        className={`mx-4 mb-3 text-[12px] ${sentMessage ? "rounded border border-blue-200 bg-blue-50 p-2 text-blue-800" : "hidden"}`}
        data-testid="gmail-compose-sent"
        aria-live="polite"
      >
        {sentMessage}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-[#e8eaed] bg-[#f8fafd] px-4 py-1.5 xl:justify-between" data-testid="gmail-compose-actions">
        <div className="hidden text-[11px] leading-4 text-[#5f6368] xl:block">送信後は取り消せません。</div>
        <div className="flex w-full flex-nowrap justify-end gap-1.5 xl:w-auto">
          <button
            type="button"
            data-testid="gmail-compose-send"
            onClick={() => onSend("none")}
            disabled={actionDisabled}
            className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md bg-blue-600 px-3 text-[13px] font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
          >
            <Send size={14} />
            {isSendingGmailReply ? "送信中..." : "Gmailで送信"}
          </button>
          <button
            type="button"
            data-testid="gmail-compose-send-and-done"
            onClick={() => onSend("done")}
            disabled={actionDisabled}
            className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md bg-green-600 px-3 text-[13px] font-medium text-white transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
          >
            <CheckCircle size={14} />
            {isSendingGmailReply ? "送信中..." : "送信してDone"}
          </button>
          <button
            type="button"
            data-testid="gmail-compose-cancel"
            onClick={onCancel}
            disabled={isSendingGmailReply}
            className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md bg-gray-200 px-3 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-300 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
          >
            <X size={14} />
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
