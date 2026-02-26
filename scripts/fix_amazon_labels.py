"""
Gmail Amazon系ラベル誤分類修正スクリプト
対象: Amazon/広告, Amazon/SC通知, Amazon/FBA の誤分類を修正する
"""

import json
import time
import re

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
LABEL_SC = "Label_117"
LABEL_ADS = "Label_118"
LABEL_PAYMENT = "Label_119"
LABEL_VC = "Label_116"
LABEL_PROMO = "Label_121"
LABEL_HILLS = "Label_113"
LABEL_GOPRO = "Label_111"
LABEL_CRICUT = "Label_112"
LABEL_ACCOUNTING = "Label_133"


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
    return ids


def get_message_metadata(msg_id, retries=3):
    """メールのFrom/Subjectメタデータを取得"""
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
            return headers.get("from", "").lower(), headers.get("subject", "")
        except HttpError as e:
            if e.resp.status == 429:
                print(
                    f"  [429] Rate limit hit on get, waiting 60s... (attempt {attempt + 1})"
                )
                time.sleep(60)
            else:
                raise
    return "", ""


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
        time.sleep(0.5)


# =====================
# ルール1: Amazon/広告 → Amazon/入金（件名に"Remittance Advice"）
# =====================
def fix_rule1_ads_to_payment():
    print(
        "\n=== ルール1: Amazon/広告(Label_118) → Amazon/入金(Label_119) [Remittance Advice] ==="
    )
    ids = get_all_message_ids(LABEL_ADS)
    print(f"  Amazon/広告 総件数: {len(ids)}")

    targets = []
    for i, msg_id in enumerate(ids):
        sender, subject = get_message_metadata(msg_id)
        if "remittance advice" in subject.lower():
            targets.append(msg_id)
        time.sleep(0.05)
        if (i + 1) % 100 == 0:
            print(
                f"  進捗: {i + 1}/{len(ids)} 件チェック済み (対象候補: {len(targets)}件)"
            )

    print(f"  移動対象: {len(targets)} 件")
    if targets:
        batch_modify(targets, add_labels=[LABEL_PAYMENT], remove_labels=[LABEL_ADS])
        print(f"  完了: {len(targets)} 件を Amazon/入金 に移動")
    return len(targets)


# =====================
# ルール2: Amazon/SC通知 の整理
# =====================
def fix_rule2_sc_sort():
    print("\n=== ルール2: Amazon/SC通知(Label_117) の整理 ===")
    ids = get_all_message_ids(LABEL_SC)
    print(f"  Amazon/SC通知 総件数: {len(ids)}")

    to_fba = []  # Amazon/FBA へ
    to_payment = []  # Amazon/入金 へ
    to_accounting = []  # 経理/入金通知 へ
    stay = []  # そのまま（正しいSC通知）

    for i, msg_id in enumerate(ids):
        sender, subject = get_message_metadata(msg_id)
        subject_lower = subject.lower()

        if "remittance" in subject_lower:
            to_accounting.append(msg_id)
        elif any(
            kw in subject_lower
            for kw in ["お支払い", "送金", "payment", "disbursement"]
        ):
            to_payment.append(msg_id)
        elif any(kw in subject_lower for kw in ["fba", "納品", "受領"]):
            to_fba.append(msg_id)
        elif any(kw in subject for kw in ["注文確定", "出荷指示", "注文がキャンセル"]):
            stay.append(msg_id)
        else:
            stay.append(msg_id)

        time.sleep(0.05)
        if (i + 1) % 100 == 0:
            print(f"  進捗: {i + 1}/{len(ids)} 件チェック済み")

    print(
        f"  FBA移動: {len(to_fba)} 件 / 入金移動: {len(to_payment)} 件 / 経理移動: {len(to_accounting)} 件 / 維持: {len(stay)} 件"
    )

    if to_fba:
        batch_modify(to_fba, add_labels=[LABEL_FBA], remove_labels=[LABEL_SC])
        print(f"  完了: {len(to_fba)} 件を Amazon/FBA に移動")

    if to_payment:
        batch_modify(to_payment, add_labels=[LABEL_PAYMENT], remove_labels=[LABEL_SC])
        print(f"  完了: {len(to_payment)} 件を Amazon/入金 に移動")

    if to_accounting:
        batch_modify(
            to_accounting, add_labels=[LABEL_ACCOUNTING], remove_labels=[LABEL_SC]
        )
        print(f"  完了: {len(to_accounting)} 件を 経理/入金通知 に移動")

    return len(to_fba), len(to_payment), len(to_accounting)


# =====================
# ルール3: Amazon/FBA の整理
# =====================
def fix_rule3_fba_sort():
    print("\n=== ルール3: Amazon/FBA(Label_120) の整理 ===")
    ids = get_all_message_ids(LABEL_FBA)
    print(f"  Amazon/FBA 総件数: {len(ids)}")

    to_hills = []  # 取引先/Hills へ
    to_gopro = []  # 取引先/GoPro へ
    to_cricut = []  # 取引先/Cricut へ
    to_vc = []  # Amazon/VC発注 へ
    to_sc = []  # Amazon/SC通知 へ
    stay = []  # そのまま

    for i, msg_id in enumerate(ids):
        sender, subject = get_message_metadata(msg_id)
        subject_lower = subject.lower()

        if "hillspet.com" in sender:
            to_hills.append(msg_id)
        elif "gopro" in sender:
            to_gopro.append(msg_id)
        elif "cricut" in sender:
            to_cricut.append(msg_id)
        elif ("vendor central" in subject_lower) and ("fba" not in subject_lower):
            to_vc.append(msg_id)
        elif (
            "レビュー" in subject or "review" in subject_lower
        ) and "amazon" in sender:
            to_sc.append(msg_id)
        else:
            stay.append(msg_id)

        time.sleep(0.05)
        if (i + 1) % 100 == 0:
            print(f"  進捗: {i + 1}/{len(ids)} 件チェック済み")

    print(
        f"  Hills移動: {len(to_hills)} 件 / GoPro移動: {len(to_gopro)} 件 / Cricut移動: {len(to_cricut)} 件 / VC発注移動: {len(to_vc)} 件 / SC通知移動: {len(to_sc)} 件 / 維持: {len(stay)} 件"
    )

    if to_hills:
        batch_modify(to_hills, add_labels=[LABEL_HILLS], remove_labels=[LABEL_FBA])
        print(f"  完了: {len(to_hills)} 件を 取引先/Hills に移動")

    if to_gopro:
        batch_modify(to_gopro, add_labels=[LABEL_GOPRO], remove_labels=[LABEL_FBA])
        print(f"  完了: {len(to_gopro)} 件を 取引先/GoPro に移動")

    if to_cricut:
        batch_modify(to_cricut, add_labels=[LABEL_CRICUT], remove_labels=[LABEL_FBA])
        print(f"  完了: {len(to_cricut)} 件を 取引先/Cricut に移動")

    if to_vc:
        batch_modify(to_vc, add_labels=[LABEL_VC], remove_labels=[LABEL_FBA])
        print(f"  完了: {len(to_vc)} 件を Amazon/VC発注 に移動")

    if to_sc:
        batch_modify(to_sc, add_labels=[LABEL_SC], remove_labels=[LABEL_FBA])
        print(f"  完了: {len(to_sc)} 件を Amazon/SC通知 に移動")

    return len(to_hills), len(to_gopro), len(to_cricut), len(to_vc), len(to_sc)


# =====================
# メイン処理
# =====================
def main():
    print("=" * 60)
    print("Gmail Amazon系ラベル誤分類修正スクリプト")
    print("=" * 60)

    start_time = time.time()

    # ルール1実行
    r1_count = fix_rule1_ads_to_payment()

    # ルール2実行
    r2_fba, r2_payment, r2_accounting = fix_rule2_sc_sort()

    # ルール3実行
    r3_hills, r3_gopro, r3_cricut, r3_vc, r3_sc = fix_rule3_fba_sort()

    elapsed = time.time() - start_time

    print("\n" + "=" * 60)
    print("処理結果サマリー")
    print("=" * 60)
    print(f"[ルール1] Amazon/広告 → Amazon/入金 (Remittance Advice): {r1_count} 件")
    print(f"[ルール2] Amazon/SC通知 の整理:")
    print(f"         → Amazon/FBA:     {r2_fba} 件")
    print(f"         → Amazon/入金:    {r2_payment} 件")
    print(f"         → 経理/入金通知:  {r2_accounting} 件")
    print(f"[ルール3] Amazon/FBA の整理:")
    print(f"         → 取引先/Hills:   {r3_hills} 件")
    print(f"         → 取引先/GoPro:   {r3_gopro} 件")
    print(f"         → 取引先/Cricut:  {r3_cricut} 件")
    print(f"         → Amazon/VC発注:  {r3_vc} 件")
    print(f"         → Amazon/SC通知:  {r3_sc} 件")
    total = (
        r1_count
        + r2_fba
        + r2_payment
        + r2_accounting
        + r3_hills
        + r3_gopro
        + r3_cricut
        + r3_vc
        + r3_sc
    )
    print(f"\n合計移動件数: {total} 件")
    print(f"処理時間: {elapsed:.1f} 秒")
    print("=" * 60)


if __name__ == "__main__":
    main()
