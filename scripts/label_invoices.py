"""
Gmail 請求書ラベリングスクリプト
対象: 請求書関連メールを検出し ★請求書 (Label_101) を付ける
"""

import json
import time

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# =====================
# 認証設定
# =====================
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

# =====================
# ラベルID定義
# =====================
LABEL_INVOICE = "Label_101"  # ★請求書
LABEL_CONFIRM = "Label_102"  # ★要確認（今回は使わない）

# =====================
# 検索クエリ定義
# =====================
QUERIES = [
    ("クエリ1: subject:請求書", "subject:請求書"),
    ("クエリ2: subject:ご請求", "subject:ご請求"),
    ("クエリ3: subject:invoice", "subject:invoice"),
    ("クエリ4: filename:請求書 pdf", "filename:請求書 filename:pdf"),
    ("クエリ5: filename:invoice pdf", "filename:invoice filename:pdf"),
    ("クエリ6: subject:請求のご案内", "subject:請求のご案内"),
    (
        "クエリ7: subject:お支払いのお願い/ご案内",
        "subject:お支払いのお願い OR subject:お支払いのご案内",
    ),
]


# =====================
# ユーティリティ関数
# =====================
def search_message_ids(query, retries=3):
    """検索クエリで全メールIDをページングで取得"""
    ids = []
    page_token = None
    while True:
        params = {
            "userId": "me",
            "q": query,
            "maxResults": 500,
        }
        if page_token:
            params["pageToken"] = page_token
        for attempt in range(retries):
            try:
                resp = gmail.users().messages().list(**params).execute()
                break
            except HttpError as e:
                if e.resp.status == 429:
                    print(
                        f"  [429] Rate limit hit on list, waiting 60s... (attempt {attempt + 1})"
                    )
                    time.sleep(60)
                else:
                    raise
        msgs = resp.get("messages", [])
        ids.extend([m["id"] for m in msgs])
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
        time.sleep(0.1)
    return ids


def get_message_metadata(msg_id, retries=3):
    """メールのFrom/Subject/labelIdsを取得"""
    for attempt in range(retries):
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
            headers = {
                h["name"].lower(): h["value"]
                for h in msg.get("payload", {}).get("headers", [])
            }
            label_ids = msg.get("labelIds", [])
            return (
                headers.get("from", ""),
                headers.get("subject", ""),
                label_ids,
            )
        except HttpError as e:
            if e.resp.status == 429:
                print(
                    f"  [429] Rate limit hit on get, waiting 60s... (attempt {attempt + 1})"
                )
                time.sleep(60)
            else:
                raise
    return "", "", []


def batch_modify_add(msg_ids, add_label_id, retries=3):
    """1000件ずつbatchModifyでラベル追加（既存ラベルは触らない）"""
    chunk_size = 1000
    total_done = 0
    for i in range(0, len(msg_ids), chunk_size):
        chunk = msg_ids[i : i + chunk_size]
        body = {
            "ids": chunk,
            "addLabelIds": [add_label_id],
        }
        for attempt in range(retries):
            try:
                gmail.users().messages().batchModify(userId="me", body=body).execute()
                break
            except HttpError as e:
                if e.resp.status == 429:
                    print(
                        f"  [429] Rate limit hit on batchModify, waiting 60s... (attempt {attempt + 1})"
                    )
                    time.sleep(60)
                else:
                    raise
        total_done += len(chunk)
        print(f"  batchModify 完了: {total_done}/{len(msg_ids)} 件")
        time.sleep(0.3)
    return total_done


# =====================
# メイン処理
# =====================
def main():
    print("=" * 60)
    print("Gmail 請求書ラベリングスクリプト")
    print("=" * 60)

    start_time = time.time()

    # ---- 1. 各クエリで全メールIDを取得 ----
    print("\n[Step 1] 各クエリでメールIDを収集中...")
    all_ids = set()
    query_counts = {}

    for label, query in QUERIES:
        ids = search_message_ids(query)
        query_counts[label] = len(ids)
        all_ids.update(ids)
        print(f"  {label}: {len(ids)} 件")
        time.sleep(0.1)

    print(f"\n  統合後ユニーク件数: {len(all_ids)} 件")

    # ---- 2. 既に★請求書ラベルが付いているものを除外 ----
    print("\n[Step 2] 既存ラベル確認・除外中...")
    already_labeled = []
    target_ids = []

    all_ids_list = list(all_ids)
    for i, msg_id in enumerate(all_ids_list):
        _, _, label_ids = get_message_metadata(msg_id)
        if LABEL_INVOICE in label_ids:
            already_labeled.append(msg_id)
        else:
            target_ids.append(msg_id)
        if (i + 1) % 100 == 0:
            print(f"  進捗: {i + 1}/{len(all_ids_list)} 件チェック済み")
        time.sleep(0.05)

    print(f"  既に★請求書ラベル付き: {len(already_labeled)} 件（スキップ）")
    print(f"  ラベル付け対象: {len(target_ids)} 件")

    # ---- 3. サンプル20件を表示 ----
    print("\n[Step 3] サンプル20件 (From + Subject) ---")
    sample_ids = target_ids[:20]
    for i, msg_id in enumerate(sample_ids):
        sender, subject, _ = get_message_metadata(msg_id)
        print(f"  [{i + 1:02d}] From: {sender}")
        print(f"        Subject: {subject}")
        time.sleep(0.05)

    # ---- 4. 全件にbatchModifyで★請求書ラベルを追加 ----
    if target_ids:
        print(f"\n[Step 4] {len(target_ids)} 件に★請求書ラベルを付与中...")
        labeled_count = batch_modify_add(target_ids, LABEL_INVOICE)
    else:
        labeled_count = 0
        print("\n[Step 4] ラベル付け対象が0件のためスキップ")

    elapsed = time.time() - start_time

    # ---- 結果サマリー ----
    print("\n" + "=" * 60)
    print("処理結果サマリー")
    print("=" * 60)
    print("[各クエリのヒット数]")
    for label, count in query_counts.items():
        print(f"  {label}: {count} 件")
    print(f"\n[統合後ユニーク件数]: {len(all_ids)} 件")
    print(f"[既存ラベル付きスキップ]: {len(already_labeled)} 件")
    print(f"[ラベル付け完了]: {labeled_count} 件")
    print(f"[処理時間]: {elapsed:.1f} 秒")
    print("=" * 60)


if __name__ == "__main__":
    main()
