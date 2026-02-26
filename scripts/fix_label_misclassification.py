#!/usr/bin/env python3
"""
Gmail ラベル誤分類修正スクリプト
軽微なラベル誤分類を一括修正する
"""

import json
import time
import re

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

# ============================================================
# 認証
# ============================================================
TOKEN_FILE = "/Users/takayukisuzuki/VYPER JAPAN Dropbox/Suzuki Takayuki/VYPER-Dev/vyper-ai-workspace/.cursor/gmail-token.json"

with open(TOKEN_FILE) as f:
    ti = json.load(f)

creds = Credentials(
    token=ti.get("token"),
    refresh_token=ti["refresh_token"],
    client_id=ti["client_id"],
    client_secret=ti["client_secret"],
    token_uri=ti["token_uri"],
    scopes=["https://www.googleapis.com/auth/gmail.modify"],
)
if creds.expired or not creds.valid:
    creds.refresh(Request())

gmail = build("gmail", "v1", credentials=creds)

# ============================================================
# ラベルID定数
# ============================================================
LABEL_STAFF = "Label_104"  # 社内/スタッフ
LABEL_MOBILE = "Label_146"  # 通知/携帯
LABEL_GITHUB = "Label_139"  # 通知/GitHub
LABEL_SPAM_MAIL = "Label_147"  # 不要/メルマガ
LABEL_SPAM_SALES = "Label_148"  # 不要/営業
LABEL_TEPS = "Label_140"  # 通知/TēPs
LABEL_YAHOO_STORE = "Label_127"  # Yahoo/ストア
LABEL_YAHOO_PROMO = "Label_128"  # Yahoo/販促

# ============================================================
# ユーティリティ
# ============================================================


def get_header(headers, name):
    """メッセージヘッダから指定フィールドを取得"""
    for h in headers:
        if h["name"].lower() == name.lower():
            return h["value"]
    return ""


def fetch_messages_with_label(label_id, max_results=500):
    """指定ラベルのメッセージ一覧を取得"""
    messages = []
    page_token = None
    while True:
        params = {
            "userId": "me",
            "labelIds": [label_id],
            "maxResults": 100,
        }
        if page_token:
            params["pageToken"] = page_token
        result = gmail.users().messages().list(**params).execute()
        batch = result.get("messages", [])
        messages.extend(batch)
        if len(messages) >= max_results:
            break
        page_token = result.get("nextPageToken")
        if not page_token:
            break
    return messages[:max_results]


def get_message_metadata(msg_id):
    """メッセージのFrom/Subjectを取得（429対応付き）"""
    for attempt in range(3):
        try:
            msg = (
                gmail.users()
                .messages()
                .get(
                    userId="me",
                    id=msg_id,
                    format="metadata",
                    metadataHeaders=["From", "Subject"],
                )
                .execute()
            )
            time.sleep(0.05)
            return msg
        except Exception as e:
            if "429" in str(e):
                print(f"  [429] Rate limit. 60秒待機...")
                time.sleep(60)
            else:
                raise
    return None


def batch_modify(message_ids, add_labels=None, remove_labels=None):
    """batchModify で一括ラベル変更（429対応付き）"""
    if not message_ids:
        return
    body = {"ids": message_ids}
    if add_labels:
        body["addLabelIds"] = add_labels
    if remove_labels:
        body["removeLabelIds"] = remove_labels
    for attempt in range(3):
        try:
            gmail.users().messages().batchModify(userId="me", body=body).execute()
            time.sleep(0.5)
            return
        except Exception as e:
            if "429" in str(e):
                print(f"  [429] Rate limit. 60秒待機...")
                time.sleep(60)
            else:
                raise


# ============================================================
# 修正処理
# ============================================================


def task1_clean_staff_label():
    """
    タスク1: 社内/スタッフ (Label_104) の清掃
    - neo-career.co.jp / e.dji.com / e-tenki.co.jp / yamadaseiyaku.com
      → 不要/メルマガ に移動（社内/スタッフを外す）
    """
    print("\n=== タスク1: 社内/スタッフ の清掃 ===")
    MOVE_DOMAINS = [
        "neo-career.co.jp",
        "e.dji.com",
        "e-tenki.co.jp",
        "yamadaseiyaku.com",
    ]

    messages = fetch_messages_with_label(LABEL_STAFF)
    print(f"  社内/スタッフ 件数: {len(messages)}")

    targets = []
    for m in messages:
        msg = get_message_metadata(m["id"])
        if not msg:
            continue
        from_val = get_header(msg["payload"]["headers"], "From").lower()
        matched = any(d in from_val for d in MOVE_DOMAINS)
        if matched:
            subj = get_header(msg["payload"]["headers"], "Subject")
            targets.append(m["id"])
            print(f"  [対象] From={from_val[:60]}  Sub={subj[:50]}")

    if targets:
        batch_modify(targets, add_labels=[LABEL_SPAM_MAIL], remove_labels=[LABEL_STAFF])
        print(f"  -> {len(targets)} 件を 不要/メルマガ に移動しました")
    else:
        print("  -> 対象メールなし")
    return len(targets)


def task3_github_aws_health():
    """
    タスク3: 通知/GitHub (Label_139) のAWS Health通知
    - 送信元 health@aws.com → 通知/GitHub から外すのみ
    """
    print("\n=== タスク3: 通知/GitHub の AWS Health通知除去 ===")

    messages = fetch_messages_with_label(LABEL_GITHUB)
    print(f"  通知/GitHub 件数: {len(messages)}")

    targets = []
    for m in messages:
        msg = get_message_metadata(m["id"])
        if not msg:
            continue
        from_val = get_header(msg["payload"]["headers"], "From").lower()
        if "health@aws.com" in from_val or "health.aws.com" in from_val:
            subj = get_header(msg["payload"]["headers"], "Subject")
            targets.append(m["id"])
            print(f"  [対象] From={from_val[:60]}  Sub={subj[:50]}")

    if targets:
        batch_modify(targets, remove_labels=[LABEL_GITHUB])
        print(f"  -> {len(targets)} 件から 通知/GitHub を除去しました")
    else:
        print("  -> 対象メールなし")
    return len(targets)


def task4_rescue_from_spam_mail():
    """
    タスク4: 不要/メルマガ (Label_147) の重要メール救出
    - teps.io → 通知/TēPs に移動
    - Yahoo系 かつ 件名に "Yahoo!広告" or "広告" → Yahoo/ストア に移動
    """
    print("\n=== タスク4: 不要/メルマガ からの重要メール救出 ===")

    messages = fetch_messages_with_label(LABEL_SPAM_MAIL)
    print(f"  不要/メルマガ 件数: {len(messages)}")

    teps_targets = []
    yahoo_ad_targets = []

    for m in messages:
        msg = get_message_metadata(m["id"])
        if not msg:
            continue
        headers = msg["payload"]["headers"]
        from_val = get_header(headers, "From").lower()
        subj = get_header(headers, "Subject")

        # teps.io
        if "teps.io" in from_val:
            teps_targets.append(m["id"])
            print(f"  [TēPs] From={from_val[:60]}  Sub={subj[:50]}")
            continue

        # Yahoo広告系
        is_yahoo_sender = "yahoo" in from_val
        is_ad_subject = (
            "yahoo!広告" in subj.lower() or "広告" in subj or "yahoo!広告" in subj
        )
        if is_yahoo_sender and is_ad_subject:
            yahoo_ad_targets.append(m["id"])
            print(f"  [Yahoo広告] From={from_val[:60]}  Sub={subj[:50]}")

    count = 0
    if teps_targets:
        batch_modify(
            teps_targets, add_labels=[LABEL_TEPS], remove_labels=[LABEL_SPAM_MAIL]
        )
        print(f"  -> teps.io: {len(teps_targets)} 件を 通知/TēPs に移動しました")
        count += len(teps_targets)

    if yahoo_ad_targets:
        batch_modify(
            yahoo_ad_targets,
            add_labels=[LABEL_YAHOO_STORE],
            remove_labels=[LABEL_SPAM_MAIL],
        )
        print(
            f"  -> Yahoo広告: {len(yahoo_ad_targets)} 件を Yahoo/ストア に移動しました"
        )
        count += len(yahoo_ad_targets)

    if count == 0:
        print("  -> 対象メールなし")
    return count


def task5_rescue_from_spam_sales():
    """
    タスク5: 不要/営業 (Label_148) のYahoo!コマースパートナー
    - 件名に "コマースパートナー" or "Yahoo!コマース" → Yahoo/販促 に移動
    """
    print("\n=== タスク5: 不要/営業 からの Yahoo コマース系救出 ===")

    messages = fetch_messages_with_label(LABEL_SPAM_SALES)
    print(f"  不要/営業 件数: {len(messages)}")

    targets = []
    for m in messages:
        msg = get_message_metadata(m["id"])
        if not msg:
            continue
        headers = msg["payload"]["headers"]
        subj = get_header(headers, "Subject")
        from_val = get_header(headers, "From").lower()

        if "コマースパートナー" in subj or "yahoo!コマース" in subj.lower():
            targets.append(m["id"])
            print(f"  [対象] From={from_val[:60]}  Sub={subj[:50]}")

    if targets:
        batch_modify(
            targets, add_labels=[LABEL_YAHOO_PROMO], remove_labels=[LABEL_SPAM_SALES]
        )
        print(f"  -> {len(targets)} 件を Yahoo/販促 に移動しました")
    else:
        print("  -> 対象メールなし")
    return len(targets)


# ============================================================
# メイン
# ============================================================


def main():
    print("=" * 60)
    print("Gmail ラベル誤分類修正スクリプト")
    print("=" * 60)

    t1 = task1_clean_staff_label()
    t3 = task3_github_aws_health()
    t4 = task4_rescue_from_spam_mail()
    t5 = task5_rescue_from_spam_sales()

    print("\n" + "=" * 60)
    print("処理サマリー")
    print("=" * 60)
    print(f"  タスク1 社内/スタッフ 清掃         : {t1} 件移動")
    print(f"  タスク2 通知/携帯 Microsoft         : 修正不要（スキップ）")
    print(f"  タスク3 通知/GitHub AWS Health除去  : {t3} 件修正")
    print(f"  タスク4 不要/メルマガ 重要メール救出 : {t4} 件救出")
    print(f"  タスク5 不要/営業 Yahoo コマース救出 : {t5} 件救出")
    total = t1 + t3 + t4 + t5
    print(f"  合計                               : {total} 件修正")
    print("=" * 60)


if __name__ == "__main__":
    main()
