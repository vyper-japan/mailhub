"""
Gmail Amazon/キャンセルラベル作成・移行スクリプト
- 新ラベル「Amazon/キャンセル」を作成
- 旧ラベル「Amazon/amazonキャンセルリクエスト」(Label_2238975314827338448) のメールを移行
- 条件に合致するがラベルが付いていないメールにも追加でラベル付け
- 旧ラベルを削除
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
# 定数
# =====================
OLD_LABEL_ID = "Label_2238975314827338448"
NEW_LABEL_NAME = "Amazon/キャンセル"


# =====================
# ユーティリティ関数
# =====================
def get_all_message_ids(label_id):
    """指定ラベルの全メールIDをページングで取得"""
    ids = []
    page_token = None
    while True:
        params = {"userId": "me", "labelIds": [label_id], "maxResults": 500}
        if page_token:
            params["pageToken"] = page_token
        resp = gmail.users().messages().list(**params).execute()
        msgs = resp.get("messages", [])
        ids.extend([m["id"] for m in msgs])
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
        time.sleep(0.1)
    return ids


def search_message_ids(query):
    """クエリで全メールIDをページングで取得"""
    ids = []
    page_token = None
    while True:
        params = {"userId": "me", "q": query, "maxResults": 500}
        if page_token:
            params["pageToken"] = page_token
        resp = gmail.users().messages().list(**params).execute()
        msgs = resp.get("messages", [])
        ids.extend([m["id"] for m in msgs])
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
        time.sleep(0.1)
    return ids


def batch_modify(msg_ids, add_labels=None, remove_labels=None, retries=3):
    """1000件ずつbatchModifyで一括更新（UNREAD/INBOX は変更しない）"""
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
        time.sleep(0.3)


# =====================
# Step 1: 新ラベル作成
# =====================
def step1_create_label():
    print("\n=== Step 1: 新ラベル「Amazon/キャンセル」を作成 ===")
    label_body = {
        "name": NEW_LABEL_NAME,
        "labelListVisibility": "labelShow",
        "messageListVisibility": "show",
    }
    new_label = gmail.users().labels().create(userId="me", body=label_body).execute()
    cancel_label_id = new_label["id"]
    print(f"  ラベル作成: {NEW_LABEL_NAME} = {cancel_label_id}")
    return cancel_label_id


# =====================
# Step 2: 旧ラベルのメールを新ラベルに移行
# =====================
def step2_migrate_from_old_label(cancel_label_id):
    print(f"\n=== Step 2: 旧ラベル({OLD_LABEL_ID})のメールを新ラベルに移行 ===")
    ids = get_all_message_ids(OLD_LABEL_ID)
    print(f"  旧ラベルのメール総件数: {len(ids)}")

    if ids:
        batch_modify(
            ids,
            add_labels=[cancel_label_id],
            remove_labels=[OLD_LABEL_ID],
        )
        print(f"  完了: {len(ids)} 件を {NEW_LABEL_NAME} に移行（UNREAD状態は保持）")
    else:
        print("  対象メールなし")

    return len(ids)


# =====================
# Step 3: 条件に合致するがラベルが付いていないメールにラベル付け
# =====================
def step3_label_unlabeled(cancel_label_id):
    print(f"\n=== Step 3: 未ラベルの条件合致メールにラベル付け ===")
    query = "from:auto-communication@amazon.co.jp subject:キャンセルリクエスト -label:Amazon-キャンセル"
    print(f"  検索クエリ: {query}")
    ids = search_message_ids(query)
    print(f"  対象件数: {len(ids)}")

    if ids:
        # addLabelIds のみ指定（INBOX も UNREAD も変更しない）
        batch_modify(
            ids,
            add_labels=[cancel_label_id],
        )
        print(
            f"  完了: {len(ids)} 件に {NEW_LABEL_NAME} を追加（INBOX/UNREAD状態は保持）"
        )
    else:
        print("  対象メールなし")

    return len(ids)


# =====================
# Step 4: 旧ラベル削除
# =====================
def step4_delete_old_label():
    print(f"\n=== Step 4: 旧ラベル({OLD_LABEL_ID})を削除 ===")
    try:
        gmail.users().labels().delete(userId="me", id=OLD_LABEL_ID).execute()
        print(f"  完了: 旧ラベル({OLD_LABEL_ID})を削除しました")
        return "削除済み"
    except HttpError as e:
        if e.resp.status == 404:
            print(f"  スキップ: 旧ラベルが存在しないため削除不要")
            return "存在しなかった（スキップ）"
        else:
            raise


# =====================
# メイン処理
# =====================
def main():
    print("=" * 60)
    print("Gmail Amazon/キャンセルラベル作成・移行スクリプト")
    print("=" * 60)

    start_time = time.time()

    # Step 1: 新ラベル作成
    cancel_label_id = step1_create_label()

    # Step 2: 旧ラベルからの移行
    migrated_count = step2_migrate_from_old_label(cancel_label_id)

    # Step 3: 未ラベルメールへの追加ラベル付け
    added_count = step3_label_unlabeled(cancel_label_id)

    # Step 4: 旧ラベル削除
    delete_result = step4_delete_old_label()

    elapsed = time.time() - start_time

    print("\n" + "=" * 60)
    print("処理結果サマリー")
    print("=" * 60)
    print(f"[Step 1] 新ラベル ID: {cancel_label_id}")
    print(f"[Step 2] 旧ラベルからの移行件数: {migrated_count} 件")
    print(f"[Step 3] 追加ラベル付け件数:     {added_count} 件")
    print(f"[Step 4] 旧ラベル削除結果:       {delete_result}")
    print(f"\n合計処理件数: {migrated_count + added_count} 件")
    print(f"処理時間: {elapsed:.1f} 秒")
    print("=" * 60)


if __name__ == "__main__":
    main()
