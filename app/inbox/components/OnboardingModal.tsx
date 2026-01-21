"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, BookOpen, Keyboard, ArrowRight } from "lucide-react";

const ONBOARDING_STORAGE_KEY = "mailhub-onboarding-shown";

type Props = {
  onClose: () => void;
};

export function OnboardingModal({ onClose }: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    // localStorageに記録（1回のみ表示）
    try {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
    } catch {
      // localStorageが使えない環境では無視
    }
  }, []);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[9998] flex items-center justify-center" data-testid="onboarding-overlay">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative bg-white rounded-lg shadow-2xl max-w-[600px] w-full mx-4 max-h-[90vh] overflow-auto"
        data-testid="onboarding-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-[#e8eaed] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen size={20} className="text-[#1a73e8]" />
            <h1 className="text-[18px] font-semibold text-[#202124]">MailHubへようこそ</h1>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded hover:bg-[#f1f3f4]"
            aria-label="閉じる"
            data-testid="onboarding-close"
          >
            <X size={18} className="text-[#5f6368]" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-6">
          {/* 画面構成 */}
          <section>
            <h2 className="text-[16px] font-semibold text-[#202124] mb-3 flex items-center gap-2">
              <BookOpen size={16} className="text-[#1a73e8]" />
              画面構成（3分で理解）
            </h2>
            <div className="text-[14px] text-[#5f6368] space-y-3">
              <div className="bg-[#f8f9fa] border border-[#e8eaed] rounded-lg p-3">
                <div className="grid grid-cols-3 gap-2 text-center text-[12px]">
                  <div className="bg-[#e3f2fd] rounded p-2">
                    <div className="font-medium text-[#1a73e8]">左: ラベル</div>
                    <div className="text-[#5f6368]">Views / Channels / Status</div>
                  </div>
                  <div className="bg-[#e8f5e9] rounded p-2">
                    <div className="font-medium text-[#2e7d32]">中央: 一覧</div>
                    <div className="text-[#5f6368]">メール一覧</div>
                  </div>
                  <div className="bg-[#fff3e0] rounded p-2">
                    <div className="font-medium text-[#e65100]">右: 詳細</div>
                    <div className="text-[#5f6368]">本文 / 返信</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 基本操作 */}
          <section>
            <h2 className="text-[16px] font-semibold text-[#202124] mb-3">📬 基本操作</h2>
            <div className="text-[14px] text-[#5f6368] space-y-2">
              <div>
                <strong className="text-[#202124]">完了:</strong> 処理が終わったら「完了」（<kbd className="px-1.5 py-0.5 bg-[#e8eaed] border border-[#dadce0] rounded text-[11px] font-mono">E</kbd>）でアーカイブ
              </div>
              <div>
                <strong className="text-[#202124]">保留:</strong> 後で確認したい場合は「保留」ボタンで待機状態に
              </div>
            </div>
          </section>

          {/* 低優先と復帰 */}
          <section>
            <h2 className="text-[16px] font-semibold text-[#202124] mb-3">🔇 低優先（Muted）と復帰</h2>
            <div className="text-[14px] text-[#5f6368] space-y-2">
              <div>
                <strong className="text-[#202124]">低優先:</strong> 重要度が低いメールは「低優先」（<kbd className="px-1.5 py-0.5 bg-[#e8eaed] border border-[#dadce0] rounded text-[11px] font-mono">M</kbd>）で一覧から除外
              </div>
              <div>
                <strong className="text-[#202124]">復帰:</strong> 左メニューの「低優先」タブから確認し、再び対応する場合はUndo（<kbd className="px-1.5 py-0.5 bg-[#e8eaed] border border-[#dadce0] rounded text-[11px] font-mono">U</kbd>）
              </div>
            </div>
          </section>

          {/* 担当と引き継ぎ */}
          <section>
            <h2 className="text-[16px] font-semibold text-[#202124] mb-3">👤 担当（Assign）と引き継ぎ</h2>
            <div className="text-[14px] text-[#5f6368] space-y-2">
              <div>
                <strong className="text-[#202124]">担当割当:</strong> 自分が対応するメールは「担当」ボタンで割り当て
              </div>
              <div>
                <strong className="text-[#202124]">引き継ぎ:</strong> 他の担当者に変更する場合は理由を入力して引き継ぎ
              </div>
            </div>
          </section>

          {/* ショートカット */}
          <section>
            <h2 className="text-[16px] font-semibold text-[#202124] mb-3 flex items-center gap-2">
              <Keyboard size={16} className="text-[#1a73e8]" />
              キーボードショートカット
            </h2>
            <div className="text-[14px] text-[#5f6368] grid grid-cols-2 gap-x-4 gap-y-1">
              <div className="flex items-center justify-between py-1">
                <kbd className="px-1.5 py-0.5 bg-[#e8eaed] border border-[#dadce0] rounded text-[11px] font-mono">↑</kbd><kbd className="px-1.5 py-0.5 bg-[#e8eaed] border border-[#dadce0] rounded text-[11px] font-mono ml-1">↓</kbd>
                <span className="text-[#202124] ml-2">移動</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <kbd className="px-1.5 py-0.5 bg-[#e8eaed] border border-[#dadce0] rounded text-[11px] font-mono">E</kbd>
                <span className="text-[#202124] ml-2">完了</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <kbd className="px-1.5 py-0.5 bg-[#e8eaed] border border-[#dadce0] rounded text-[11px] font-mono">U</kbd>
                <span className="text-[#202124] ml-2">Undo</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <kbd className="px-1.5 py-0.5 bg-[#e8eaed] border border-[#dadce0] rounded text-[11px] font-mono">M</kbd>
                <span className="text-[#202124] ml-2">低優先</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <kbd className="px-1.5 py-0.5 bg-[#e8eaed] border border-[#dadce0] rounded text-[11px] font-mono">?</kbd>
                <span className="text-[#202124] ml-2">ヘルプ</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <kbd className="px-1.5 py-0.5 bg-[#e8eaed] border border-[#dadce0] rounded text-[11px] font-mono">Esc</kbd>
                <span className="text-[#202124] ml-2">閉じる</span>
              </div>
            </div>
          </section>

          <section className="border-t border-[#e8eaed] pt-4">
            <div className="flex items-center justify-between">
              <div className="text-[13px] text-[#5f6368]">
                詳細は右上の <strong className="text-[#202124]">?</strong> ボタンから「Help」を開いて確認できます。
              </div>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-[#1a73e8] text-white text-[14px] font-medium rounded hover:bg-[#1557b0] flex items-center gap-2"
                data-testid="onboarding-start"
              >
                始める
                <ArrowRight size={16} />
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function shouldShowOnboarding(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) !== "true";
  } catch {
    return false;
  }
}
