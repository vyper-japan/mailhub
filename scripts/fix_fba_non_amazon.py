"""
Amazon/FBA ラベル内の非Amazonメール修正スクリプト

対象:
- shippinno.co.jp  → 不要/営業 (Label_148)
- miraku-corp.co.jp → 不要/営業 (Label_148)
- insatsu-net.com   → 不要/メルマガ (Label_147)
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
LABEL_FBA = "Label_120"
LABEL_DELIVERY = "Label_141"
LABEL_SALES = "Label_148"
LABEL_MAILMAG = "Label_147"


# =====================
# ユーティリティ関数
# =====================
def search_all_message_ids(query, retries=3):
    """検索クエリで全メールIDをページングで取得"""
    ids = []
    page_token = None
    while True:
        params = {"userId": "me", "q": query, "maxResults": 500}
        if page_token:
            params["pageToken"] = page_token
        for attempt in range(retries):
            try:
                resp = gmail.users().messages().list(**params).execute()
                break
            except HttpError as e:
                if e.resp.status == 429:
                    print(
                        f"  [429] Rate limit hit on search, waiting 60s... (attempt {attempt + 1})"
                    )
                    time.sleep(60)
                else:
                    raise
        msgs = resp.get("messages", [])
        ids.extend([m["id"] for m in msgs])
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
        time.sleep(0.2)
    return ids


def batch_modify(msg_ids, add_labels, remove_labels, retries=3):
    """1000件ずつbatchModifyで一括更新"""
    chunk_size = 1000
    for i in range(0, len(msg_ids), chunk_size):
        chunk = msg_ids[i : i + chunk_size]
        body = {"ids": chunk}
        if add_labels:
            body["addLabelIds"] = add_labels
        if remove_labels:
            body["removeLabelIds"] = remove_labels
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
        time.sleep(0.2)


# =====================
# ルール1: shippinno.co.jp → 不要/営業
# =====================
def fix_rule1_shippinno():
    print("\n=== ルール1: shippinno.co.jp → 不要/営業 (Label_148) ===")
    query = "label:Amazon-FBA from:shippinno.co.jp"
    ids = search_all_message_ids(query)
    print(f"  検索クエリ: {query}")
    print(f"  取得件数: {len(ids)} 件")

    if ids:
        batch_modify(ids, add_labels=[LABEL_SALES], remove_labels=[LABEL_FBA])
        print(f"  完了: {len(ids)} 件を Amazon/FBA → 不要/営業 に移動")
    else:
        print("  対象メールなし")

    return len(ids)


# =====================
# ルール2: miraku-corp.co.jp → 不要/営業
# =====================
def fix_rule2_miraku():
    print("\n=== ルール2: miraku-corp.co.jp → 不要/営業 (Label_148) ===")
    query = "label:Amazon-FBA from:miraku-corp.co.jp"
    ids = search_all_message_ids(query)
    print(f"  検索クエリ: {query}")
    print(f"  取得件数: {len(ids)} 件")

    if ids:
        batch_modify(ids, add_labels=[LABEL_SALES], remove_labels=[LABEL_FBA])
        print(f"  完了: {len(ids)} 件を Amazon/FBA → 不要/営業 に移動")
    else:
        print("  対象メールなし")

    return len(ids)


# =====================
# ルール3: insatsu-net.com → 不要/メルマガ
# =====================
def fix_rule3_insatsu():
    print("\n=== ルール3: insatsu-net.com → 不要/メルマガ (Label_147) ===")
    query = "label:Amazon-FBA from:insatsu-net.com"
    ids = search_all_message_ids(query)
    print(f"  検索クエリ: {query}")
    print(f"  取得件数: {len(ids)} 件")

    if ids:
        batch_modify(ids, add_labels=[LABEL_MAILMAG], remove_labels=[LABEL_FBA])
        print(f"  完了: {len(ids)} 件を Amazon/FBA → 不要/メルマガ に移動")
    else:
        print("  対象メールなし")

    return len(ids)


# =====================
# メイン処理
# =====================
def main():
    print("=" * 60)
    print("Gmail Amazon/FBA 非Amazonメール修正スクリプト")
    print("=" * 60)

    start_time = time.time()

    r1_count = fix_rule1_shippinno()
    r2_count = fix_rule2_miraku()
    r3_count = fix_rule3_insatsu()

    elapsed = time.time() - start_time

    print("\n" + "=" * 60)
    print("処理結果サマリー")
    print("=" * 60)
    print(f"[ルール1] shippinno.co.jp  → 不要/営業:   {r1_count} 件")
    print(f"[ルール2] miraku-corp.co.jp → 不要/営業:  {r2_count} 件")
    print(f"[ルール3] insatsu-net.com   → 不要/メルマガ: {r3_count} 件")
    print(f"\n合計移動件数: {r1_count + r2_count + r3_count} 件")
    print(f"処理時間: {elapsed:.1f} 秒")
    print("=" * 60)


if __name__ == "__main__":
    main()
