"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, RefreshCw, X, BookOpen, Keyboard, Info, HelpCircle } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  readOnlyMode: boolean;
  isAdmin: boolean;
  onShowOnboarding?: () => void; // Step 92: オンボーディング再表示
};

type FetchState<T> = { ok: true; data: T } | { ok: false; error: string };

async function safeFetchJson<T>(url: string): Promise<FetchState<T>> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as T;
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

type TabId = "quickstart" | "shortcuts" | "diagnostics" | "support";

export function HelpDrawer({ open, onClose, readOnlyMode, isAdmin, onShowOnboarding }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("quickstart");
  const [health, setHealth] = useState<FetchState<unknown> | null>(null);
  const [version, setVersion] = useState<FetchState<unknown> | null>(null);
  const [apiHealth, setApiHealth] = useState<FetchState<unknown> | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showManualCopy, setShowManualCopy] = useState(false);
  const manualCopyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [supportBundle, setSupportBundle] = useState<string | null>(null);

  const loadDiagnostics = useCallback(async () => {
    const [h, v, ah] = await Promise.all([
      safeFetchJson("/api/mailhub/config/health"),
      safeFetchJson("/api/version"),
      safeFetchJson("/api/health"),
    ]);
    setHealth(h);
    setVersion(v);
    setApiHealth(ah);
  }, []);

  useEffect(() => {
    if (!open || activeTab !== "diagnostics") return;
    void loadDiagnostics();
  }, [open, activeTab, loadDiagnostics]);

  useEffect(() => {
    if (!open || activeTab !== "support") return;
    void loadDiagnostics();
  }, [open, activeTab, loadDiagnostics]);

  useEffect(() => {
    if (activeTab === "support" && health?.ok && version?.ok && apiHealth?.ok) {
      const bundle = {
        capturedAt: new Date().toISOString(),
        location: typeof window !== "undefined" ? window.location.href : "(unknown)",
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "(unknown)",
        health: health.data,
        version: version.data,
        apiHealth: apiHealth.data,
      };
      setSupportBundle(JSON.stringify(bundle, null, 2));
    }
  }, [activeTab, health, version, apiHealth]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const copyText = useCallback(async (text: string, showManualOnFail = false) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast("コピーしました");
      setTimeout(() => setToast(null), 2500);
      if (showManualOnFail) {
        setShowManualCopy(false);
      }
    } catch {
      if (showManualOnFail) {
        setShowManualCopy(true);
        setTimeout(() => {
          manualCopyTextareaRef.current?.select();
          manualCopyTextareaRef.current?.focus();
        }, 100);
      } else {
        setToast("コピーに失敗しました（権限/ブラウザ設定を確認）");
        setTimeout(() => setToast(null), 4000);
      }
    }
  }, []);

  const diagnosticsBundle = useMemo(() => {
    return {
      capturedAt: new Date().toISOString(),
      location: typeof window !== "undefined" ? window.location.href : "(unknown)",
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "(unknown)",
      health,
      version,
      apiHealth,
    };
  }, [health, version, apiHealth]);

  const prettyBundle = useMemo(() => JSON.stringify(diagnosticsBundle, null, 2), [diagnosticsBundle]);
  const prettyHealth = useMemo(() => JSON.stringify(health, null, 2), [health]);
  const prettyVersion = useMemo(() => JSON.stringify(version, null, 2), [version]);
  const prettyApiHealth = useMemo(() => JSON.stringify(apiHealth, null, 2), [apiHealth]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[9997]" data-testid="help-overlay">
      <button
        type="button"
        className="absolute inset-0 bg-black/20"
        aria-label="閉じる（背景）"
        onClick={onClose}
      />
      <div
        className="absolute right-0 top-0 h-full w-full max-w-[560px] bg-white shadow-2xl border-l border-[#dadce0] flex flex-col"
        data-testid="help-drawer"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-14 px-4 flex items-center justify-between border-b border-[#e8eaed]">
          <div className="text-[14px] font-semibold text-[#202124]">Help</div>
          <button type="button" onClick={onClose} className="p-2 rounded hover:bg-[#f1f3f4]" aria-label="閉じる">
            <X size={18} className="text-[#5f6368]" />
          </button>
        </div>

        <div className="flex border-b border-[#e8eaed]">
          <button
            type="button"
            onClick={() => setActiveTab("quickstart")}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${
              activeTab === "quickstart"
                ? "border-[#1a73e8] text-[#1a73e8]"
                : "border-transparent text-[#5f6368] hover:text-[#202124]"
            }`}
            data-testid="help-tab-quickstart"
          >
            <BookOpen size={14} className="inline mr-1" />
            Quick Start
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("shortcuts")}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${
              activeTab === "shortcuts"
                ? "border-[#1a73e8] text-[#1a73e8]"
                : "border-transparent text-[#5f6368] hover:text-[#202124]"
            }`}
            data-testid="help-tab-shortcuts"
          >
            <Keyboard size={14} className="inline mr-1" />
            Shortcuts
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("diagnostics")}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${
              activeTab === "diagnostics"
                ? "border-[#1a73e8] text-[#1a73e8]"
                : "border-transparent text-[#5f6368] hover:text-[#202124]"
            }`}
            data-testid="help-tab-diagnostics"
          >
            <Info size={14} className="inline mr-1" />
            Diagnostics
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("support")}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${
              activeTab === "support"
                ? "border-[#1a73e8] text-[#1a73e8]"
                : "border-transparent text-[#5f6368] hover:text-[#202124]"
            }`}
            data-testid="help-tab-support"
          >
            <HelpCircle size={14} className="inline mr-1" />
            Support
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          {activeTab === "quickstart" && (
            <div className="space-y-4">
              {/* Step 92: オンボーディングガイドを再表示ボタン */}
              {onShowOnboarding && (
                <section className="border rounded-md border-[#1a73e8] bg-[#e8f0fe] p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[13px] text-[#202124]">
                      <BookOpen size={16} className="inline mr-1 text-[#1a73e8]" />
                      初回ガイドを再表示できます
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onShowOnboarding();
                      }}
                      className="px-3 py-1 text-[12px] font-medium bg-[#1a73e8] text-white rounded hover:bg-[#1557b0]"
                      data-testid="help-show-onboarding"
                    >
                      ガイドを表示
                    </button>
                  </div>
                </section>
              )}

              <section>
                <h2 className="text-[15px] font-semibold text-[#202124] mb-2">はじめに</h2>
                <div className="text-[13px] text-[#5f6368] space-y-2">
                  <p>MailHubは、共有受信箱のメールを効率的に管理するためのツールです。</p>
                  <p>左サイドバーから「受信箱」「担当」「保留」「低優先」を切り替えて、メールを確認・操作できます。</p>
                </div>
              </section>

              <section>
                <h2 className="text-[15px] font-semibold text-[#202124] mb-2">基本的な操作</h2>
                <div className="text-[13px] text-[#5f6368] space-y-2">
                  <div>
                    <strong className="text-[#202124]">メールを選択:</strong> 一覧からメールをクリックすると、右側に詳細が表示されます。
                  </div>
                  <div>
                    <strong className="text-[#202124]">完了:</strong> メールを処理したら「完了」ボタン（Eキー）でアーカイブします。
                  </div>
                  <div>
                    <strong className="text-[#202124]">保留:</strong> 後で確認したい場合は「保留」ボタンで保留状態にします。
                  </div>
                  <div>
                    <strong className="text-[#202124]">低優先:</strong> 重要度が低いメールは「低優先」ボタンでミュートします。
                  </div>
                  <div>
                    <strong className="text-[#202124]">担当:</strong> 自分が対応するメールは「担当」ボタンで自分に割り当てます。
                  </div>
                </div>
              </section>

              {readOnlyMode && (
                <section className="border rounded-md border-[#fdd663] bg-[#fef7e0] p-3">
                  <h2 className="text-[15px] font-semibold text-[#ea8600] mb-2">READ ONLY モード</h2>
                  <div className="text-[13px] text-[#5f6368] space-y-2">
                    <p>現在、READ ONLYモードで動作しています。メールの閲覧・検索は可能ですが、変更系の操作（完了/保留/担当など）は実行できません。</p>
                    <p>変更系の操作を実行するには、管理者がREAD ONLYモードを解除する必要があります。</p>
                  </div>
                </section>
              )}

              {!isAdmin && (
                <section className="border rounded-md border-[#dadce0] bg-[#f8f9fa] p-3">
                  <h2 className="text-[15px] font-semibold text-[#202124] mb-2">設定の変更について</h2>
                  <div className="text-[13px] text-[#5f6368] space-y-2">
                    <p>設定（ラベル/ルール）の作成・編集は管理者のみが実行できます。</p>
                    <p>一般ユーザーは設定を閲覧することはできますが、変更はできません。</p>
                  </div>
                </section>
              )}
            </div>
          )}

          {activeTab === "shortcuts" && (
            <div className="space-y-4">
              <section>
                <h2 className="text-[15px] font-semibold text-[#202124] mb-2">キーボードショートカット</h2>
                <div className="text-[13px] text-[#5f6368] space-y-2">
                  <div className="flex items-center justify-between py-1">
                    <span><kbd className="px-1.5 py-0.5 bg-[#e8eaed] border border-[#dadce0] rounded text-[11px] font-mono">↑</kbd> / <kbd className="px-1.5 py-0.5 bg-[#e8eaed] border border-[#dadce0] rounded text-[11px] font-mono">↓</kbd></span>
                    <span className="text-[#202124]">メール選択の移動</span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span><kbd className="px-1.5 py-0.5 bg-[#e8eaed] border border-[#dadce0] rounded text-[11px] font-mono">E</kbd></span>
                    <span className="text-[#202124]">完了（アーカイブ）</span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span><kbd className="px-1.5 py-0.5 bg-[#e8eaed] border border-[#dadce0] rounded text-[11px] font-mono">U</kbd></span>
                    <span className="text-[#202124]">Undo（元に戻す）</span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span><kbd className="px-1.5 py-0.5 bg-[#e8eaed] border border-[#dadce0] rounded text-[11px] font-mono">?</kbd></span>
                    <span className="text-[#202124]">ヘルプ（この画面）</span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span><kbd className="px-1.5 py-0.5 bg-[#e8eaed] border border-[#dadce0] rounded text-[11px] font-mono">Esc</kbd></span>
                    <span className="text-[#202124]">閉じる（モーダル/Drawer）</span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span><kbd className="px-1.5 py-0.5 bg-[#e8eaed] border border-[#dadce0] rounded text-[11px] font-mono">Cmd+K</kbd> / <kbd className="px-1.5 py-0.5 bg-[#e8eaed] border border-[#dadce0] rounded text-[11px] font-mono">Ctrl+K</kbd></span>
                    <span className="text-[#202124]">コマンドパレット（将来実装予定）</span>
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeTab === "diagnostics" && (
            <div className="space-y-4">
              <div className="text-[12px] text-[#5f6368]">
                困ったら「診断情報をコピー」を押して、Slack/チャットに貼り付けてください（秘密情報は含めません）。
              </div>

              {showManualCopy && (
                <section className="border rounded-md border-[#dadce0] bg-[#fef7e0]">
                  <div className="px-3 py-2 border-b border-[#e8eaed] flex items-center justify-between">
                    <div className="text-[13px] font-semibold text-[#ea8600]">手動コピー（クリップボードコピーに失敗した場合）</div>
                    <button
                      type="button"
                      className="px-2 py-1 text-[12px] rounded border border-[#dadce0] hover:bg-[#f1f3f4]"
                      onClick={() => setShowManualCopy(false)}
                    >
                      閉じる
                    </button>
                  </div>
                  <div className="p-3">
                    <textarea
                      ref={manualCopyTextareaRef}
                      readOnly
                      value={prettyBundle}
                      className="w-full h-48 p-2 text-[11px] font-mono border border-[#dadce0] rounded bg-white resize-none"
                      onClick={(e) => {
                        e.currentTarget.select();
                      }}
                      data-testid="help-manual-copy-textarea"
                    />
                    <div className="mt-2 text-[11px] text-[#5f6368]">
                      上記のテキストエリアを全選択（Cmd+A / Ctrl+A）してコピー（Cmd+C / Ctrl+C）してください。
                    </div>
                  </div>
                </section>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-3 py-1.5 text-[12px] rounded border border-[#dadce0] hover:bg-[#f1f3f4] flex items-center gap-1"
                  onClick={() => void loadDiagnostics()}
                  title="再取得"
                  data-testid="help-diagnostics-reload"
                >
                  <RefreshCw size={14} className="text-[#5f6368]" />
                  再取得
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 text-[12px] rounded border border-[#dadce0] hover:bg-[#f1f3f4] flex items-center gap-1"
                  onClick={() => void copyText(prettyBundle, true)}
                  title="診断情報をまとめてコピー"
                  data-testid="help-diagnostics-copy"
                >
                  <Copy size={14} className="text-[#5f6368]" />
                  診断情報をコピー
                </button>
              </div>

              <section className="border rounded-md border-[#dadce0]">
                <div className="px-3 py-2 border-b border-[#e8eaed] flex items-center justify-between">
                  <div className="text-[13px] font-semibold text-[#202124]">Health</div>
                  <button
                    type="button"
                    className="px-2 py-1 text-[12px] rounded border border-[#dadce0] hover:bg-[#f1f3f4]"
                    onClick={() => void copyText(prettyHealth)}
                    data-testid="help-copy-health"
                  >
                    コピー
                  </button>
                </div>
                <pre className="p-3 text-[11px] overflow-auto whitespace-pre-wrap break-words max-h-64">{prettyHealth}</pre>
              </section>

              <section className="border rounded-md border-[#dadce0]">
                <div className="px-3 py-2 border-b border-[#e8eaed] flex items-center justify-between">
                  <div className="text-[13px] font-semibold text-[#202124]">Version</div>
                  <button
                    type="button"
                    className="px-2 py-1 text-[12px] rounded border border-[#dadce0] hover:bg-[#f1f3f4]"
                    onClick={() => void copyText(prettyVersion)}
                    data-testid="help-copy-version"
                  >
                    コピー
                  </button>
                </div>
                <pre className="p-3 text-[11px] overflow-auto whitespace-pre-wrap break-words max-h-64">{prettyVersion}</pre>
              </section>

              <section className="border rounded-md border-[#dadce0]">
                <div className="px-3 py-2 border-b border-[#e8eaed] flex items-center justify-between">
                  <div className="text-[13px] font-semibold text-[#202124]">API Health</div>
                  <button
                    type="button"
                    className="px-2 py-1 text-[12px] rounded border border-[#dadce0] hover:bg-[#f1f3f4]"
                    onClick={() => void copyText(prettyApiHealth)}
                    data-testid="help-copy-api-health"
                  >
                    コピー
                  </button>
                </div>
                <pre className="p-3 text-[11px] overflow-auto whitespace-pre-wrap break-words max-h-64">{prettyApiHealth}</pre>
              </section>
            </div>
          )}

          {activeTab === "support" && (
            <div className="space-y-4">
              <section>
                <h2 className="text-[15px] font-semibold text-[#202124] mb-2">Access（権限について）</h2>
                <div className="text-[13px] text-[#5f6368] space-y-3">
                  <div>
                    <h3 className="text-[14px] font-medium text-[#202124] mb-1">1. Open in Gmail が開けない</h3>
                    <p className="mb-2">
                      「Open in Gmail」ボタンをクリックしてもGmailが開かない、または「アクセス権限がありません」と表示される場合：
                    </p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>共有受信箱へのアクセス権限（委任）が付与されていない可能性があります</li>
                      <li>管理者に共有受信箱の委任設定を依頼してください</li>
                    </ul>
                  </div>

                  <div>
                    <h3 className="text-[14px] font-medium text-[#202124] mb-1">2. READ ONLY モード</h3>
                    <p className="mb-2">
                      画面上部に「READ ONLY」バッジが表示されている場合、変更系の操作（完了/保留/担当など）は実行できません。
                    </p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>これは意図的な安全設定です（本番環境の保護）</li>
                      <li>変更操作が必要な場合は、管理者にREAD ONLY解除を依頼してください</li>
                    </ul>
                  </div>

                  <div>
                    <h3 className="text-[14px] font-medium text-[#202124] mb-1">3. 設定（ラベル/ルール）の編集ができない</h3>
                    <p className="mb-2">
                      Settings Drawerでラベルやルールの作成・編集ができない場合：
                    </p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>設定の変更は管理者のみが実行できます</li>
                      <li>一般ユーザーは設定を閲覧することはできますが、変更はできません</li>
                      <li>設定変更が必要な場合は、管理者に依頼してください</li>
                    </ul>
                  </div>

                  <div className="border rounded-md border-[#dadce0] bg-[#f8f9fa] p-3 mt-4">
                    <h3 className="text-[14px] font-medium text-[#202124] mb-2">権限依頼テンプレート</h3>
                    <p className="text-[12px] text-[#5f6368] mb-2">
                      以下のテンプレートをコピーして、管理者に送信してください。
                    </p>
                    <div className="bg-white border border-[#dadce0] rounded p-2 mb-2">
                      <pre className="text-[11px] font-mono whitespace-pre-wrap break-words">
{`件名: MailHub 権限設定のご依頼

お世話になっております。

MailHubで以下の権限設定をお願いいたします。

【必要な権限】
□ 共有受信箱へのアクセス権限（委任）
  → 「Open in Gmail」が開けるようにするため

□ READ ONLY解除（変更操作が必要な場合）
  → メールの完了/保留/担当などの操作を実行するため

□ 管理者権限（設定変更が必要な場合）
  → ラベル/ルールの作成・編集を行うため

【現在の状況】
- ユーザー: ${typeof window !== "undefined" ? window.location.href : "(unknown)"}
- READ ONLY: ${readOnlyMode ? "有効" : "無効"}
- 管理者: ${isAdmin ? "はい" : "いいえ"}

よろしくお願いいたします。`}
                      </pre>
                    </div>
                    <button
                      type="button"
                      className="px-3 py-1.5 text-[12px] rounded border border-[#dadce0] hover:bg-[#f1f3f4] flex items-center gap-1"
                      onClick={() => {
                        const template = `件名: MailHub 権限設定のご依頼

お世話になっております。

MailHubで以下の権限設定をお願いいたします。

【必要な権限】
□ 共有受信箱へのアクセス権限（委任）
  → 「Open in Gmail」が開けるようにするため

□ READ ONLY解除（変更操作が必要な場合）
  → メールの完了/保留/担当などの操作を実行するため

□ 管理者権限（設定変更が必要な場合）
  → ラベル/ルールの作成・編集を行うため

【現在の状況】
- ユーザー: ${typeof window !== "undefined" ? window.location.href : "(unknown)"}
- READ ONLY: ${readOnlyMode ? "有効" : "無効"}
- 管理者: ${isAdmin ? "はい" : "いいえ"}

よろしくお願いいたします。`;
                        void copyText(template);
                      }}
                      data-testid="support-copy-request"
                    >
                      <Copy size={14} className="text-[#5f6368]" />
                      依頼テンプレをコピー
                    </button>
                  </div>
                </div>
              </section>

              <section>
                <h2 className="text-[15px] font-semibold text-[#202124] mb-2">Support Bundle（診断情報）</h2>
                <div className="text-[13px] text-[#5f6368] space-y-2 mb-3">
                  <p>
                    困ったら「Support Bundleをコピー」を押して、Slack/チャットに貼り付けてください。
                  </p>
                  <p className="text-[12px] text-[#ea8600]">
                    ※ 秘密情報（パスワード、トークンなど）は含まれません。共有受信箱のメールアドレスは一部マスクされます。
                  </p>
                </div>

                {showManualCopy && supportBundle && (
                  <div className="border rounded-md border-[#dadce0] bg-[#fef7e0] mb-3">
                    <div className="px-3 py-2 border-b border-[#e8eaed] flex items-center justify-between">
                      <div className="text-[13px] font-semibold text-[#ea8600]">手動コピー（クリップボードコピーに失敗した場合）</div>
                      <button
                        type="button"
                        className="px-2 py-1 text-[12px] rounded border border-[#dadce0] hover:bg-[#f1f3f4]"
                        onClick={() => setShowManualCopy(false)}
                      >
                        閉じる
                      </button>
                    </div>
                    <div className="p-3">
                      <textarea
                        readOnly
                        value={supportBundle}
                        className="w-full h-48 p-2 text-[11px] font-mono border border-[#dadce0] rounded bg-white resize-none"
                        onClick={(e) => {
                          e.currentTarget.select();
                        }}
                        data-testid="support-manual-copy-textarea"
                      />
                      <div className="mt-2 text-[11px] text-[#5f6368]">
                        上記のテキストエリアを全選択（Cmd+A / Ctrl+A）してコピー（Cmd+C / Ctrl+C）してください。
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    className="px-3 py-1.5 text-[12px] rounded border border-[#dadce0] hover:bg-[#f1f3f4] flex items-center gap-1"
                    onClick={() => void loadDiagnostics()}
                    title="再取得"
                    data-testid="support-bundle-reload"
                  >
                    <RefreshCw size={14} className="text-[#5f6368]" />
                    再取得
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1.5 text-[12px] rounded border border-[#dadce0] hover:bg-[#f1f3f4] flex items-center gap-1"
                    onClick={() => {
                      if (supportBundle) {
                        void copyText(supportBundle, true);
                      } else {
                        setToast("診断情報を読み込み中です。しばらく待ってから再試行してください。");
                        setTimeout(() => setToast(null), 3000);
                      }
                    }}
                    title="Support Bundleをコピー"
                    data-testid="support-copy-bundle"
                    disabled={!supportBundle}
                  >
                    <Copy size={14} className="text-[#5f6368]" />
                    Support Bundleをコピー
                  </button>
                </div>

                {supportBundle && (
                  <div className="mt-3 border rounded-md border-[#dadce0]">
                    <div className="px-3 py-2 border-b border-[#e8eaed]">
                      <div className="text-[13px] font-semibold text-[#202124]">Bundle Preview（プレビュー）</div>
                    </div>
                    <pre className="p-3 text-[11px] overflow-auto whitespace-pre-wrap break-words max-h-64">{supportBundle}</pre>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>

        {toast && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-[#202124] text-white text-[12px] px-3 py-2 rounded shadow">
            {toast}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
