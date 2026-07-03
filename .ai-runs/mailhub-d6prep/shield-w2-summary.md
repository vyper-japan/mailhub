# SHIELD W2 Summary — Lolipop 12addr audit + polling persistence

## Scope
- Parent ticket: mailhub-destructive-6-prep
- Worker: W2
- READ ONLY: Lolipop/Gmail/Workspace admin destructive操作なし。実pollingも未実行。
- Requested branch: `feat/lolipop-12addr-audit-and-polling-persistence`
- Actual git state: branch creation failed because `.git/index.lock` creation was denied by the sandbox (`Operation not permitted`). Current branch remained `feat/mailhub-lolipop-12addr-audit-poll` with working-tree changes.

## Audit JSON
- Path: `.ai-runs/mailhub-next-phase/lolipop-routing-audit.json`
- sha256: `b70f790debca7efa10385f3bf4f7372d55e2472c166f3e1b378820b5484798cb`
- total: 12
- entry count (`.entries|length`): 12
- schema note: existing JSON uses `entries`; `addresses` is not present, so the prompt probe `.addresses|length` returns 0.
- audit_at: `2026-06-29T22:33:11Z`
- previous_audit_at: `2026-06-27T01:13:17.988430+00:00`

## 5 New POC Entries
| address | forwarding | success | applied_at | verification_method | status |
| --- | --- | --- | --- | --- | --- |
| sbd@vtj.co.jp | mailhub@vtj.co.jp.test-google-a.com | false | null | null | poc_failed |
| secondhand@vtj.co.jp | mailhub@vtj.co.jp.test-google-a.com | false | null | null | poc_failed |
| steiner-optics_sc@vtj.co.jp | mailhub@vtj.co.jp.test-google-a.com | true | null | null |  |
| vyper_sc@vtj.co.jp | mailhub@vtj.co.jp.test-google-a.com | true | null | null |  |
| vyperglobal_sc@vtj.co.jp | mailhub@vtj.co.jp.test-google-a.com | true | null | null |  |

## secondhand@ poc_failed note
- status: `poc_failed`
- notes: `Q2 canary 振替で D6 では使用しない`

## Poll Script Persistence
- Requested source: scratchpad / temporary `poll_5addrs.py`
- Search result: no scratchpad/tmp source found; only canonical repo path existed during Phase 0.
- Canonical path: `scripts/lolipop-mailhub-routing/poll_5addrs.py`
- Main branch state: path absent, so this is treated as new canonical repo content.
- Diff/full content: full content below because the file is new relative to `main`.

```python
#!/usr/bin/env python3
"""Read-only Lolipop routing polling for the five Q5 add-on addresses.

実行方法:
    python scripts/lolipop-mailhub-routing/poll_5addrs.py --dry-run
    python scripts/lolipop-mailhub-routing/poll_5addrs.py --no-screenshot

入力:
    --audit-json PATH
        既定: .ai-runs/mailhub-next-phase/lolipop-routing-audit.json
    --addresses ADDR,ADDR
        既定: vyperglobal_sc / vyper_sc / steiner-optics_sc / secondhand / sbd

出力:
    - audit JSON の該当 entry を read-only observation で更新
    - .ai-runs/mailhub-next-phase/lolipop-routing-poll-<UTC>.json
    - 任意で .ai-runs/mailhub-next-phase/lolipop-poll-5addrs-*.png

dry-run flag:
    --dry-run は Lolipop に接続せず、audit JSON上の対象 entry と実行計画だけを表示する。

READ ONLY 原則:
    「更新」「変更」「削除」「追加」ボタンは絶対に押さない。既存7件は変更せず、
    5件のPOC由来entryだけを source="audit_full" へ昇格する。
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# 同一ディレクトリ配置を前提に lolipop_forward_setup を再利用
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
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


DEFAULT_OUTPUT_DIR = REPO_ROOT / ".ai-runs/mailhub-next-phase"
DEFAULT_AUDIT_JSON = DEFAULT_OUTPUT_DIR / "lolipop-routing-audit.json"

NEW_TARGETS: list[str] = [
    "vyperglobal_sc@vtj.co.jp",
    "vyper_sc@vtj.co.jp",
    "steiner-optics_sc@vtj.co.jp",
    "secondhand@vtj.co.jp",
    "sbd@vtj.co.jp",
]


def _load_audit(audit_json: Path) -> dict:
    if not audit_json.exists():
        raise FileNotFoundError(
            f"audit JSON not found: {audit_json}. "
            "W2 (lolipop-routing-audit.json total=12) を先に適用してください。"
        )
    return json.loads(audit_json.read_text(encoding="utf-8"))


def _save_audit(doc: dict, audit_json: Path) -> None:
    audit_json.write_text(
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
            f"success={existing.get('success')} "
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
        "--audit-json",
        type=Path,
        default=DEFAULT_AUDIT_JSON,
        help="更新対象の audit JSON path",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="poll結果JSONとスクリーンショットの出力先",
    )
    parser.add_argument(
        "--result-json",
        type=Path,
        default=None,
        help="poll結果JSON path。未指定なら output-dir/lolipop-routing-poll-<UTC>.json",
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

    audit_json = args.audit_json.resolve()
    output_dir = args.output_dir.resolve()
    doc = _load_audit(audit_json)

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
    output_dir.mkdir(parents=True, exist_ok=True)

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
                    png_path = output_dir / f"lolipop-poll-5addrs-{slug}.png"
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

    _save_audit(doc, audit_json)

    result_json = args.result_json
    if result_json is None:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        result_json = output_dir / f"lolipop-routing-poll-{stamp}.json"
    result_payload = {
        "poll_at": doc["audit_at"],
        "read_only": True,
        "audit_json": str(audit_json),
        "targets": targets,
        "summary": summary,
        "polling_pending_addresses": pending,
        "screenshots_enabled": not args.no_screenshot,
    }
    result_json.write_text(
        json.dumps(result_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print("\n" + "=" * 60)
    print("poll 結果サマリ")
    print(f"  audit_full: {len(audit_full)} / poc_derived: {len(poc_remain)}")
    print(f"  pending  : {pending}")
    for s in summary:
        print(f"  - {s['address']:<35} {s['status']}")
    print(f"\n[output] {audit_json}")
    print(f"[output] {result_json}")


if __name__ == "__main__":
    main()
```

## Poll Result JSON
- Path: `.ai-runs/mailhub-next-phase/lolipop-routing-poll-20260629T223425Z.json`
- sha256: `8d066c08259e83373b77d61ba7b0f94ffee17603fc23ddbf022d182176bf5e5e`
- polling_executed: `false`
- reason: No prior lolipop-routing-poll-*.json was found and W2 explicitly forbids live polling; memory records polling 実測未完.

## memory:186 / current memory line
- Requested memory reference was memory:186, but current grep output located the polling note at line 191.
- Current line: `残: ①CoWork で 5アドレスにテストメール MAILHUB-ROUTING-5-{name}-20260627 送信→scratchpad/poll_5addrs.py で polling 実測 ②destructive 6項目...`
- Consistency: the new poll result JSON explicitly says `polling_executed:false`, so it does not claim the unfinished polling was completed.

## Phase 1.5 Self-check
- total is 12: PASS (`.total=12`, `.entries|length=12`)
- previous_audit_at differs from audit_at: PASS
- secondhand@ has `status:poc_failed` and Q2 canary note: PASS
- `poll_5addrs.py` exists and starts: PASS (`python3 -m py_compile` and `--dry-run` passed)
- Lolipop apply/delete/modify not called: PASS (no live polling run; script grep found no operational `--apply`, click/press/fill/submit calls)
- `ams_vyper@`, `gopro_y@`, `gopro_order_yahoo@` unchanged vs main: PASS
- Branch + two commits: NEEDS_RETRY (git metadata write denied by sandbox; initial `git switch -c ... main` failed)

## STATUS: NEEDS_RETRY
