#!/usr/bin/env python3
"""poll_5addrs.py

ロリポップ管理画面に read-only で再訪し、Adjudicator Q5 #1 で「polling 未完」と
記録された 5 アドレス (vyperglobal_sc / vyper_sc / steiner-optics_sc / secondhand
/ sbd) の forwarding_mails[] slot を実測して
.ai-runs/mailhub-next-phase/lolipop-routing-audit.json の該当 entry を
source="audit_full" に昇格させる。

設計原則 (READ ONLY 厳守):
- 「更新」「変更」「削除」「追加」ボタンは絶対に押さない。
- 既存 lolipop_forward_setup.py のログイン/転送読取 API を再利用する
  (二重実装による drift を避ける)。
- 例外: target が見つからない / セッション失効 / DOM 変更で取得失敗した場合は
  該当 entry を polling_pending=True のまま残し error フィールドに事由を記録する。
- 既存の audit_full 7 アドレス entry は touch しない。

スコープ外:
- destructive 操作 (apply / delete)。lolipop_forward_setup.py --apply または W4
  の sbd 削除 ledger 適用フローで別途扱う。
- sbd@ の polling は W4 ledger 適用前なら pre-reconstruct snapshot を映す。これは
  Adjudicator Q5 の意図通りで、本 script は raw observation のみ返す。
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# 同一ディレクトリ配置を前提に lolipop_forward_setup を再利用
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))


def _import_forward_setup() -> dict:
    """lolipop_forward_setup を遅延 import (dry-run では呼ばない)。

    W3 (scripts/lolipop-mailhub-routing 移管) が未完了の状態でも
    --dry-run だけは走らせられるよう、import を main() からのみ呼ぶ。
    """
    try:
        from lolipop_forward_setup import (  # type: ignore[import-not-found]
            BASE_URL,
            STORAGE_PATH,
            do_login,
            is_logged_in,
            load_secrets,
            navigate_to_forward_settings,
        )
    except ImportError as e:  # pragma: no cover
        print(
            "[poll] NG lolipop_forward_setup が同一ディレクトリに見つかりません。"
            "W3 (scripts/lolipop-mailhub-routing 移管) 完了後に実行してください。"
            f" detail={e}",
            file=sys.stderr,
        )
        sys.exit(2)
    return {
        "BASE_URL": BASE_URL,
        "STORAGE_PATH": STORAGE_PATH,
        "do_login": do_login,
        "is_logged_in": is_logged_in,
        "load_secrets": load_secrets,
        "navigate_to_forward_settings": navigate_to_forward_settings,
    }


OUTPUT_DIR = Path.home() / "VYPER-Dev/Mailhub/.ai-runs/mailhub-next-phase"
AUDIT_JSON = OUTPUT_DIR / "lolipop-routing-audit.json"

NEW_TARGETS: list[str] = [
    "vyperglobal_sc@vtj.co.jp",
    "vyper_sc@vtj.co.jp",
    "steiner-optics_sc@vtj.co.jp",
    "secondhand@vtj.co.jp",
    "sbd@vtj.co.jp",
]


def _load_audit() -> dict:
    if not AUDIT_JSON.exists():
        raise FileNotFoundError(
            f"audit JSON not found: {AUDIT_JSON}. "
            "W2 (lolipop-routing-audit.json total=12) を先に適用してください。"
        )
    return json.loads(AUDIT_JSON.read_text(encoding="utf-8"))


def _save_audit(doc: dict) -> None:
    AUDIT_JSON.write_text(
        json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def _promote_entry(entry: dict, observation: dict, png_path: Path | None) -> dict:
    """POC-derived entry に observation を反映して audit_full に昇格させる。"""
    now = datetime.now(timezone.utc).isoformat()
    entry = dict(entry)
    err = observation.get("error")
    forward_addresses = observation.get("forward_addresses") or []

    if err:
        entry["error"] = err
        entry["polling_pending"] = True
        entry["last_poll_attempt_at"] = now
        if png_path:
            entry["last_poll_screenshot"] = png_path.name
        return entry

    entry["source"] = "audit_full"
    entry["forward_addresses_complete"] = True
    entry["observed_at"] = now
    entry["forward_addresses"] = forward_addresses
    entry["leave_messages"] = observation.get("leave_messages")
    entry["page_url"] = observation.get("page_url") or entry.get("page_url")
    if not entry.get("edit_id") and entry.get("page_url"):
        url = entry["page_url"]
        if "id=" in url:
            entry["edit_id"] = url.split("id=")[-1].split("&")[0]
    entry["polling_pending"] = False
    entry["error"] = None
    entry.pop("last_poll_attempt_at", None)
    if png_path:
        entry["last_poll_screenshot"] = png_path.name
    return entry


def _print_plan(targets: list[str], doc: dict) -> None:
    print("=" * 60)
    print(f"poll_5addrs.py dry-run plan ({len(targets)} targets)")
    print("=" * 60)
    for t in targets:
        existing = next((e for e in doc["entries"] if e["address"] == t), None)
        if not existing:
            print(f"  - {t}: entry not found in audit JSON (skipped)")
            continue
        print(
            f"  - {t}: source={existing.get('source')} "
            f"poc_success={existing.get('poc_success')} "
            f"edit_id={existing.get('edit_id') or '(unknown)'}"
        )
    print("実行時の差分:")
    print("  - 読取成功 -> source=audit_full に昇格、forwarding_mails[] 全 slot 記録")
    print("  - 読取失敗 -> POC エビデンス保持、error/last_poll_attempt_at 更新")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Lolipop 5 新規アドレスを read-only で polling して audit JSON を昇格"
        )
    )
    parser.add_argument(
        "--addresses",
        type=str,
        default=",".join(NEW_TARGETS),
        help="polling 対象 (カンマ区切り)。既定は Adjudicator Q5 の 5 件。",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Lolipop に接続せず計画のみ表示 (CI / 確認用)",
    )
    parser.add_argument(
        "--no-screenshot",
        action="store_true",
        help="スクリーンショット保存をスキップ",
    )
    args = parser.parse_args()

    targets = [a.strip() for a in args.addresses.split(",") if a.strip()]
    if not targets:
        print("[poll] NG 対象アドレスが空です", file=sys.stderr)
        sys.exit(2)

    doc = _load_audit()

    if args.dry_run:
        _print_plan(targets, doc)
        return

    # destructive-safe な遅延 import (W3 移管完了が前提)
    fs = _import_forward_setup()
    BASE_URL = fs["BASE_URL"]
    STORAGE_PATH = fs["STORAGE_PATH"]
    do_login = fs["do_login"]
    is_logged_in = fs["is_logged_in"]
    load_secrets = fs["load_secrets"]
    navigate_to_forward_settings = fs["navigate_to_forward_settings"]

    from playwright.sync_api import sync_playwright  # type: ignore

    secrets = load_secrets()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print(f"poll_5addrs.py: {len(targets)} アドレスを READ ONLY で polling")
    print("  「更新」「削除」「追加」ボタンは絶対に押しません")
    print("=" * 60)

    summary: list[dict] = []
    with sync_playwright() as p:
        storage_state = str(STORAGE_PATH) if STORAGE_PATH.exists() else None
        browser = p.chromium.launch(headless=False)
        ctx = browser.new_context(
            storage_state=storage_state,
            viewport={"width": 1280, "height": 900},
        )
        page = ctx.new_page()
        try:
            page.goto(BASE_URL + "/", wait_until="domcontentloaded")
            page.wait_for_timeout(1500)
            if not is_logged_in(page):
                print("[init] 未ログイン -> ログイン実行")
                do_login(page, secrets)
            else:
                print("[init] OK セッション有効 (既存 cookie)")
            ctx.storage_state(path=str(STORAGE_PATH))

            for i, addr in enumerate(targets, 1):
                print(f"\n[poll {i}/{len(targets)}] {addr}")
                print("-" * 40)
                observation = navigate_to_forward_settings(page, addr)

                png_path: Path | None = None
                if not args.no_screenshot:
                    slug = addr.split("@")[0].replace("_", "-")
                    png_path = OUTPUT_DIR / f"lolipop-poll-5addrs-{slug}.png"
                    try:
                        page.screenshot(path=str(png_path), full_page=True)
                        print(f"[poll] screenshot: {png_path}")
                    except Exception as e:  # pragma: no cover
                        print(f"[poll] WARN screenshot 失敗: {e}")

                idx = next(
                    (j for j, e in enumerate(doc["entries"]) if e["address"] == addr),
                    None,
                )
                if idx is None:
                    print(f"[poll] WARN audit JSON に entry が無い: {addr}")
                    summary.append({"address": addr, "status": "missing_entry"})
                    continue

                updated = _promote_entry(doc["entries"][idx], observation, png_path)
                doc["entries"][idx] = updated
                summary.append(
                    {
                        "address": addr,
                        "status": (
                            "promoted_to_audit_full"
                            if not observation.get("error")
                            else "polling_pending_with_error"
                        ),
                        "error": observation.get("error"),
                    }
                )
        finally:
            try:
                ctx.storage_state(path=str(STORAGE_PATH))
            except Exception:
                pass
            ctx.close()
            browser.close()

    audit_full = [e for e in doc["entries"] if e.get("source") == "audit_full"]
    poc_remain = [e for e in doc["entries"] if e.get("source") == "poc"]
    pending = [e["address"] for e in doc["entries"] if e.get("polling_pending")]

    doc["audit_at"] = datetime.now(timezone.utc).isoformat()
    doc["audit_full_total"] = len(audit_full)
    doc["poc_derived_total"] = len(poc_remain)
    doc["polling_pending_addresses"] = pending
    if not pending:
        doc["last_full_audit_at"] = doc["audit_at"]

    _save_audit(doc)

    print("\n" + "=" * 60)
    print("poll 結果サマリ")
    print(f"  audit_full: {len(audit_full)} / poc_derived: {len(poc_remain)}")
    print(f"  pending  : {pending}")
    for s in summary:
        print(f"  - {s['address']:<35} {s['status']}")
    print(f"\n[output] {AUDIT_JSON}")


if __name__ == "__main__":
    main()
