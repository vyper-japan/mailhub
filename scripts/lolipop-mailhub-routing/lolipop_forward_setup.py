#!/usr/bin/env python3
"""
lolipop_forward_setup.py

ロリポップ管理画面へ自動ログインし、指定アドレスのメール転送設定画面まで到達する。
デフォルトは dry-run（到達・読み取りのみ、「更新」は押さない）。
--apply フラグを付けた場合のみ apply_forward() を実行する。

Usage:
  python3 scripts/lolipop-mailhub-routing/lolipop_forward_setup.py
  python3 scripts/lolipop-mailhub-routing/lolipop_forward_setup.py --apply --target ams_vyper@vtj.co.jp
  python3 scripts/lolipop-mailhub-routing/lolipop_forward_setup.py audit
"""

import argparse, json, sys
from datetime import datetime, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

SECRETS_PATH = Path.home() / ".claude/secrets/lolipop-vtj.json"
STORAGE_PATH = Path.home() / ".claude/secrets/lolipop-vtj-storage.json"
OUTPUT_DIR = Path.home() / "VYPER-Dev/Mailhub/.ai-runs/mailhub-next-phase"
DEFAULT_TARGET = "ams_vyper@vtj.co.jp"
FORWARD_TO = "mailhub@vtj.co.jp"
LOGIN_URL = "https://user.lolipop.jp/?mode=login"
BASE_URL = "https://user.lolipop.jp"
MAIL_LIST_URL = f"{BASE_URL}/?mode=mail-address"

# audit サブコマンドの対象7アドレス（vyper_r@ は絶対含めない）
AUDIT_TARGETS = [
    "gopro_y@vtj.co.jp",
    "gopro_order_yahoo@vtj.co.jp",
    "vyper_rakuten@vtj.co.jp",
    "vyperglobal_y@vtj.co.jp",
    "ams_vyper@vtj.co.jp",
    "datacolor_shopify@vtj.co.jp",
    "ebay@vtj.co.jp",
]

# アドレス→編集ID の既知マッピング（偵察済み）
KNOWN_IDS = {
    "ams_vyper@vtj.co.jp": "DMA6079860",
    "steiner-optics_sc@vtj.co.jp": "DMA8787735",
    "secondhand@vtj.co.jp": "DMA6193388",
    "ebay@vtj.co.jp": "DMA6632845",
    "ken_ug@vtj.co.jp": "DMA5526399",
    "ken_vc1@vtj.co.jp": "DMA4696970",
    "cricut_r@vtj.co.jp": "DMA7956598",
    "vyper_rakuten@vtj.co.jp": "DMA6194268",
    "info@vtj.co.jp": "DMA3807060",
}


def load_secrets() -> dict:
    with open(SECRETS_PATH) as f:
        return json.load(f)


def is_logged_in(page) -> bool:
    try:
        page.wait_for_selector("a[href*='logout']", timeout=3000)
        return True
    except PWTimeout:
        return False


def do_login(page, secrets: dict) -> None:
    """
    ロリポップへのログイン。
    認証: jf_Login(1) を JS で呼ぶ（form.submit()/click は認証が通らない）
    """
    print("[login] ログインページへ移動...")
    page.goto(LOGIN_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(1500)

    r1 = page.query_selector("input[name='domain_plan'][value='1']")
    if r1:
        page.evaluate("el => el.click()", r1)
        page.wait_for_timeout(800)
        print("[login] 独自ドメインラジオ選択")
    else:
        print("[login] ⚠ domain_plan radio value='1' が見つからない")

    domain = secrets["login_domain"]
    tld = secrets["login_tld"]
    password = secrets["login_password"]

    for name, val in [
        ("domain_name_2", domain),
        ("domain_name_3", tld),
        ("passwd", password),
    ]:
        el = page.query_selector(f"input[name='{name}']")
        if el:
            el.fill(val)
        else:
            print(f"[login] ⚠ input[name='{name}'] が見つからない")

    page.wait_for_timeout(400)
    print("[login] jf_Login(1) 呼び出し...")
    with page.expect_navigation(wait_until="domcontentloaded", timeout=20000):
        page.evaluate("jf_Login(1)")
    page.wait_for_timeout(1500)

    if "mode=login" in page.url:
        body = page.text_content("body") or ""
        print(f"[login] NG ログイン失敗 URL={page.url}\n{body[:300]}")
        raise RuntimeError("ロリポップログイン失敗")
    print(f"[login] OK ログイン完了 URL={page.url}")


def get_edit_url(page, target_address: str) -> str:
    """アドレスの編集URLを取得（既知マップ優先、なければ一覧から検索）"""
    if target_address in KNOWN_IDS:
        return f"{BASE_URL}/?mode=mail-address&exec=edit&id={KNOWN_IDS[target_address]}"

    print(f"[url] {target_address} の ID を一覧から検索...")
    page.goto(MAIL_LIST_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(1500)

    short = target_address.split("@")[0]
    for a in page.query_selector_all("a[href]"):
        href = a.get_attribute("href") or ""
        text = (a.text_content() or "").strip()
        if short in text and "exec=edit" in href:
            if href.startswith("?"):
                full = f"{BASE_URL}/{href}"
            elif href.startswith("http"):
                full = href
            else:
                full = f"{BASE_URL}/?{href.lstrip('?')}"
            print(f"[url] 発見: {text!r} -> {full}")
            return full

    raise RuntimeError(f"'{target_address}' の編集URL が一覧から見つからない")


def read_forward_settings(page) -> dict:
    """
    現在開いているページから転送設定を読み取って返す。
    「更新」「削除」「追加」ボタンは絶対に押さない。
    """
    result = {
        "page_url": page.url,
        "page_title": page.title(),
        "forward_addresses": [],
        "leave_messages": None,
        "raw_fields": [],
    }

    inputs = page.query_selector_all("input[name='forwarding_mails[]']")
    print(f"[read] forwarding_mails[] フィールド数: {len(inputs)}")
    for inp in inputs:
        val = (inp.get_attribute("value") or "").strip()
        result["raw_fields"].append(val)
        if val:
            result["forward_addresses"].append(val)
            print(f"[read] 転送先: {val!r}")

    for r in page.query_selector_all("input[name='leave_messages']"):
        val = r.get_attribute("value") or ""
        checked = r.is_checked()
        print(f"[read] leave_messages value={val!r} checked={checked}")
        if checked:
            result["leave_messages"] = val == "1"

    print(
        f"[read] OK 転送先={result['forward_addresses']} leave_messages={result['leave_messages']}"
    )
    return result


def navigate_to_forward_settings(page, target_address: str) -> dict:
    """転送設定画面まで遷移し現在の設定値を返す。更新は行わない。"""
    result = {"target_address": target_address, "error": None}
    try:
        edit_url = get_edit_url(page, target_address)
        print(f"[nav] edit URL: {edit_url}")
        page.goto(edit_url, wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        settings = read_forward_settings(page)
        result.update(settings)
    except Exception as e:
        result["error"] = str(e)
        result.setdefault("page_url", page.url)
        result.setdefault("page_title", page.title())
        print(f"[nav] NG {e}")
        import traceback

        traceback.print_exc()
    return result


def dump_forward_dom(page, target_address: str) -> None:
    """
    転送設定フォームの button / input[type=submit|button] / a[onclick|href^=javascript] 要素を
    標準出力に JSON ダンプする診断モード。読み取り専用、更新は行わない。
    """
    edit_url = get_edit_url(page, target_address)
    print(f"[dump-dom] edit URL: {edit_url}")
    page.goto(edit_url, wait_until="domcontentloaded")
    page.wait_for_timeout(2500)

    # iframe 確認
    iframes = page.evaluate(
        "() => Array.from(document.querySelectorAll('iframe')).map(f => f.src || f.id || '(no-src)')"
    )
    print(f"[dump-dom] iframe: {iframes}")

    # 全要素数確認（ページロード検証用）
    total_els = page.evaluate("() => document.querySelectorAll('*').length")
    print(f"[dump-dom] 総要素数: {total_els}")

    elements = page.evaluate(
        """() => {
        // button / input各種 / a全般（javascript: href含む）/ onclick付き全要素
        const candidates = document.querySelectorAll(
            'button, input[type="submit"], input[type="button"], input[type="image"], '
            + 'input[type="reset"], a, input[onclick], *[onclick]'
        );
        const keywords = ['更新', '変更', '設定', '保存', 'Save', 'Update', 'OK', '次へ', '確認'];
        const results = [];
        candidates.forEach(el => {
            const href = el.getAttribute('href') || '';
            const onclick = el.getAttribute('onclick') || '';
            const text = (el.textContent || el.value || el.alt || '').trim().substring(0, 120);
            const isJsHref = href.startsWith('javascript:');
            const isBtn = ['BUTTON', 'INPUT'].includes(el.tagName);
            // a[href^=javascript:] / button / input 以外は onclick か keyword マッチのあるもののみ
            if (!isBtn && !isJsHref && !onclick && el.tagName !== 'A') return;
            if (el.tagName === 'A' && !isJsHref && !onclick && !keywords.some(k => text.includes(k))) return;
            const info = {
                tag: el.tagName,
                type: el.type || null,
                value: el.value || null,
                name: el.name || null,
                id: el.id || null,
                className: (el.className || '').toString().substring(0, 80),
                onclick: onclick || null,
                href: href || null,
                alt: el.getAttribute('alt') || null,
                src: el.getAttribute('src') || null,
                textContent: text,
                _keyword_match: keywords.some(k =>
                    text.includes(k) ||
                    onclick.includes(k) ||
                    href.includes(k) ||
                    (el.value && el.value.includes && el.value.includes(k))
                ),
            };
            results.push(info);
        });
        return results;
    }"""
    )

    print("[dump-dom] === button/submit/a/onclick 要素一覧 ===")
    print(json.dumps(elements, ensure_ascii=False, indent=2))

    kw = [e for e in elements if e.get("_keyword_match")]
    print(f"\n[dump-dom] === キーワードマッチ ({len(kw)}件) ===")
    print(json.dumps(kw, ensure_ascii=False, indent=2))

    # テキスト検索（ページ全体で「更新」を含む要素を取得）
    by_text = page.evaluate(
        """() => {
        const kw = ['更新', '変更'];
        const hits = [];
        document.querySelectorAll('*').forEach(el => {
            const own = Array.from(el.childNodes)
                .filter(n => n.nodeType === 3)
                .map(n => n.textContent.trim())
                .join('');
            if (kw.some(k => own.includes(k))) {
                hits.push({
                    tag: el.tagName,
                    id: el.id || null,
                    className: (el.className || '').toString().substring(0, 60),
                    onclick: el.getAttribute('onclick') || null,
                    href: el.getAttribute('href') || null,
                    ownText: own.substring(0, 80),
                });
            }
        });
        return hits;
    }"""
    )
    print(f"\n[dump-dom] === テキスト「更新/変更」を持つ要素 ({len(by_text)}件) ===")
    print(json.dumps(by_text, ensure_ascii=False, indent=2))

    # JS グローバル関数候補も列挙（範囲を広げる）
    fns = page.evaluate(
        """() => Object.keys(window).filter(k =>
            typeof window[k] === 'function' &&
            /[Uu]pdat|[Ss]ave|[Ss]ubmit|[Ss]end|[Cc]hange|jf_/.test(k)
        )"""
    )
    print(f"\n[dump-dom] === 検出されたグローバルJS関数: {fns} ===")


def apply_forward(
    page, target_address: str, forward_to: str, keep_on_server: bool = True
) -> bool:
    """
    転送先追加+「更新」ボタン押下。
    --apply フラグがない限り絶対に呼ばない。
    """
    print(f"[apply] ⚠  apply_forward: {target_address} -> {forward_to}")

    state = navigate_to_forward_settings(page, target_address)
    if state.get("error"):
        print(f"[apply] NG 画面到達失敗: {state['error']}")
        return False

    if forward_to in state["forward_addresses"]:
        print(f"[apply] OK {forward_to} は既に転送先に設定済み。スキップ。")
        return True

    target_input = None
    for inp in page.query_selector_all("input[name='forwarding_mails[]']"):
        if not (inp.get_attribute("value") or "").strip():
            target_input = inp
            break

    if not target_input:
        print("[apply] NG 空の転送先フィールドが見つかりません")
        return False

    print(f"[apply] 転送先入力: {forward_to}")
    target_input.fill(forward_to)
    page.wait_for_timeout(400)

    if keep_on_server:
        r1 = page.query_selector("input[name='leave_messages'][value='1']")
        if r1:
            page.evaluate("el => el.click()", r1)
            print("[apply] 「サーバーに残す」(value='1') を選択")

    update_btn = None
    for sel in [
        # ロリポップ転送設定の実際のボタン（a[href^=javascript:setForwarding()]）
        "a.js-update-forwarding-btn",
        "a[href*='setForwarding']",
        # 一般的なフォールバック
        "input[type='submit'][value*='更新']",
        "input[type='submit'][value*='変更']",
        "input[type='submit']",
        "input[type='button'][value*='更新']",
        "input[type='button'][onclick*='Update']",
        "input[type='button']",
        "button[type='submit']",
        "button:has-text('更新')",
    ]:
        btn = page.query_selector(sel)
        if btn:
            update_btn = btn
            print(f"[apply] 更新ボタン: selector={sel!r}")
            break

    if not update_btn:
        print("[apply] NG 「更新」ボタンが見つかりません")
        return False

    # confirm() ダイアログを自動 accept
    page.on(
        "dialog",
        lambda d: (print(f"[apply] dialog: {d.message!r} → accept"), d.accept()),
    )

    print("[apply] 「更新」ボタンをクリック...")
    href = update_btn.get_attribute("href") or ""
    onclick = update_btn.get_attribute("onclick") or ""
    use_js_click = href.startswith("javascript:") or bool(onclick)

    try:
        with page.expect_navigation(wait_until="domcontentloaded", timeout=15000):
            if use_js_click:
                page.evaluate("el => el.click()", update_btn)
            else:
                update_btn.click()
    except PWTimeout:
        print("[apply] navigation なし（AJAX / 確認ページ待ちの可能性）")
        page.wait_for_timeout(2000)
    page.wait_for_timeout(2000)

    # 確認ボタンの探索（frm2.submit / OK 等）
    ok_btn = page.query_selector(
        "a[href*='frm2.submit'], input[value='OK'], button:has-text('OK')"
    )
    if ok_btn:
        ok_href = ok_btn.get_attribute("href") or ""
        print(f"[apply] 確認ボタンをクリック: href={ok_href!r}")
        try:
            with page.expect_navigation(wait_until="domcontentloaded", timeout=10000):
                if ok_href.startswith("javascript:"):
                    page.evaluate("el => el.click()", ok_btn)
                else:
                    ok_btn.click()
        except PWTimeout:
            print("[apply] confirmation navigation なし")
            page.wait_for_timeout(2000)
        page.wait_for_timeout(2000)

    body = page.text_content("body") or ""
    success = any(
        w in body for w in ["完了", "設定しました", "更新しました", "設定が完了"]
    )
    print(
        f"[apply] {'OK 更新成功' if success else 'ⓘ 成功メッセージ未確認'} URL={page.url}"
    )
    return success


def run_audit():
    """
    7アドレス全件の転送設定を read-only で収集し JSON 出力する。
    「更新」「削除」「追加」ボタンは絶対に押さない。
    ログイン1回で全件回す（cookie 再利用）。
    """
    print("=" * 60)
    print("audit モード: 7アドレスの転送設定を read-only で収集")
    print("  絶対に「更新」「削除」ボタンは押しません")
    print("=" * 60)

    secrets = load_secrets()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    audit_json = OUTPUT_DIR / "lolipop-routing-audit.json"
    entries = []

    with sync_playwright() as p:
        storage_state = str(STORAGE_PATH) if STORAGE_PATH.exists() else None
        if storage_state:
            print(f"[init] 既存 cookie: {STORAGE_PATH}")

        browser = p.chromium.launch(headless=False)
        ctx = browser.new_context(
            storage_state=storage_state,
            viewport={"width": 1280, "height": 900},
        )
        page = ctx.new_page()

        try:
            print("[init] ログイン状態確認...")
            page.goto(BASE_URL + "/", wait_until="domcontentloaded")
            page.wait_for_timeout(1500)

            if not is_logged_in(page):
                print("[init] 未ログイン → ログイン実行")
                do_login(page, secrets)
            else:
                print("[init] OK セッション有効 (既存 cookie)")

            ctx.storage_state(path=str(STORAGE_PATH))
            print(f"[init] cookie 保存: {STORAGE_PATH}")

            for i, addr in enumerate(AUDIT_TARGETS, 1):
                slug = addr.split("@")[0].replace("_", "-")
                png_out = OUTPUT_DIR / f"lolipop-routing-audit-{slug}.png"

                print(f"\n[audit {i}/{len(AUDIT_TARGETS)}] {addr}")
                print("-" * 40)

                entry = {
                    "address": addr,
                    "observed_at": datetime.now(timezone.utc).isoformat(),
                }

                try:
                    edit_url = get_edit_url(page, addr)
                    entry["edit_id"] = (
                        edit_url.split("id=")[-1] if "id=" in edit_url else None
                    )
                    entry["page_url"] = edit_url

                    page.goto(edit_url, wait_until="domcontentloaded")
                    page.wait_for_timeout(1500)

                    settings = read_forward_settings(page)
                    entry["forward_addresses"] = settings["forward_addresses"]
                    entry["leave_messages"] = settings["leave_messages"]
                    entry["page_url"] = settings["page_url"]
                    entry["error"] = None

                    page.screenshot(path=str(png_out), full_page=True)
                    print(f"[audit] screenshot: {png_out}")

                except Exception as e:
                    entry["forward_addresses"] = []
                    entry["leave_messages"] = None
                    entry["error"] = str(e)
                    entry.setdefault("page_url", page.url)
                    print(f"[audit] NG エラー: {e}")
                    import traceback

                    traceback.print_exc()
                    try:
                        page.screenshot(path=str(png_out), full_page=True)
                        print(f"[audit] screenshot (error): {png_out}")
                    except Exception:
                        pass

                entries.append(entry)
                print(
                    f"[audit {i}/{len(AUDIT_TARGETS)}] 完了: 転送先={entry['forward_addresses']}"
                )

        except KeyboardInterrupt:
            print("\n中断されました")
        except Exception as e:
            print(f"\nNG 予期しないエラー: {e}")
            import traceback

            traceback.print_exc()
        finally:
            try:
                ctx.storage_state(path=str(STORAGE_PATH))
            except Exception:
                pass
            ctx.close()
            browser.close()

    audit_result = {
        "audit_at": datetime.now(timezone.utc).isoformat(),
        "total": len(entries),
        "entries": entries,
    }
    with open(audit_json, "w", encoding="utf-8") as f:
        json.dump(audit_result, f, ensure_ascii=False, indent=2)
    print(f"\n[output] JSON: {audit_json}")

    print("\n" + "=" * 60)
    print("audit サマリ")
    print(f"{'アドレス':<35} {'転送先数':>6} {'leave':>6} {'error':>6}")
    print("-" * 60)
    for e in entries:
        fwd_count = len(e.get("forward_addresses", []))
        leave = str(e.get("leave_messages", "?"))
        err = "あり" if e.get("error") else "なし"
        print(f"{e['address']:<35} {fwd_count:>6} {leave:>6} {err:>6}")
        for fa in e.get("forward_addresses", []):
            print(f"  -> {fa}")
    print("=" * 60)
    print(f"\nJSON: {audit_json}")

    return audit_result


def main():
    parser = argparse.ArgumentParser(description="ロリポップメール転送設定 PoC / audit")
    subparsers = parser.add_subparsers(dest="subcommand")
    subparsers.add_parser("audit", help="7アドレス全件の転送設定を read-only で収集")

    parser.add_argument(
        "--apply",
        action="store_true",
        help="転送設定を実際に更新する（デフォルト dry-run）",
    )
    parser.add_argument(
        "--dump-dom",
        action="store_true",
        help="転送設定フォームの button/input/onclick 要素を診断ダンプ（read-only）",
    )
    parser.add_argument("--target", default=DEFAULT_TARGET)
    parser.add_argument("--forward-to", default=FORWARD_TO)
    args = parser.parse_args()

    if args.subcommand == "audit":
        run_audit()
        return

    if args.dump_dom:
        print("=" * 60)
        print("dump-dom: フォーム要素診断（read-only、更新なし）")
        print("=" * 60)
    elif args.apply:
        print("=" * 60)
        print("⚠  --apply モード: 転送設定を実際に更新します")
        print("=" * 60)
        try:
            confirm = input("本当に実行しますか？ (yes と入力): ")
        except EOFError:
            confirm = ""
        if confirm.strip().lower() != "yes":
            print("キャンセルしました")
            sys.exit(0)
    else:
        print("=" * 60)
        print("dry-run: 画面到達と現状読み取りのみ（更新なし）")
        print("=" * 60)

    secrets = load_secrets()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    short = args.target.split("@")[0]
    json_out = OUTPUT_DIR / f"lolipop-poc-{short}.json"
    png_out = OUTPUT_DIR / f"lolipop-poc-{short}.png"

    with sync_playwright() as p:
        storage_state = str(STORAGE_PATH) if STORAGE_PATH.exists() else None
        if storage_state:
            print(f"[init] 既存 cookie: {STORAGE_PATH}")

        browser = p.chromium.launch(headless=False)
        ctx = browser.new_context(
            storage_state=storage_state,
            viewport={"width": 1280, "height": 900},
        )
        page = ctx.new_page()

        try:
            print("[init] ログイン状態確認...")
            page.goto(BASE_URL + "/", wait_until="domcontentloaded")
            page.wait_for_timeout(1500)

            if not is_logged_in(page):
                print("[init] 未ログイン → ログイン実行")
                do_login(page, secrets)
            else:
                print("[init] OK セッション有効 (既存 cookie)")

            ctx.storage_state(path=str(STORAGE_PATH))
            print(f"[init] cookie 保存: {STORAGE_PATH}")

            if args.dump_dom:
                dump_forward_dom(page, args.target)
                result = {"mode": "dump-dom", "target_address": args.target}
            elif args.apply:
                success = apply_forward(page, args.target, args.forward_to)
                result = {
                    "mode": "apply",
                    "target_address": args.target,
                    "forward_to": args.forward_to,
                    "success": success,
                    "final_url": page.url,
                }
            else:
                result = navigate_to_forward_settings(page, args.target)
                result["mode"] = "dry-run"

            print(f"\n[output] screenshot: {png_out}")
            page.screenshot(path=str(png_out), full_page=True)

            print(f"[output] JSON: {json_out}")
            with open(json_out, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False, indent=2)

            print("\n" + "=" * 60)
            print("結果サマリ")
            print(f"  モード  : {result.get('mode')}")
            print(f"  対象    : {result.get('target_address', args.target)}")
            print(
                f"  URL     : {result.get('page_url', result.get('final_url', 'N/A'))}"
            )
            print(f"  転送先  : {result.get('forward_addresses', [])}")
            print(f"  残す設定: {result.get('leave_messages', 'N/A')}")
            print(f"  エラー  : {result.get('error', 'なし')}")
            print("=" * 60)

            print("\n⏸  ブラウザで目視確認後、Enter キーを押してください...")
            try:
                input()
            except EOFError:
                print("(非インタラクティブ環境のためスキップ)")

        except KeyboardInterrupt:
            print("\n中断されました")
        except Exception as e:
            print(f"\nNG 予期しないエラー: {e}")
            import traceback

            traceback.print_exc()
            try:
                page.screenshot(path=str(png_out))
            except Exception:
                pass
        finally:
            try:
                ctx.storage_state(path=str(STORAGE_PATH))
            except Exception:
                pass
            ctx.close()
            browser.close()


if __name__ == "__main__":
    main()
