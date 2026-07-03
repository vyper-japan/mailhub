#!/usr/bin/env python3
"""
Register MailHub Gmail send-as aliases through Domain-Wide Delegation.

Default mode is dry-run: list current Gmail send-as settings, print a diff,
write redacted evidence, and perform no write API calls.
"""

import argparse
import base64
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class RequiredAlias:
    email: str
    channel_id: str
    channel_label: str


REQUIRED_ALIASES = [
    RequiredAlias("cricut_y@vtj.co.jp", "cricut-yahoo", "Cricut Yahoo"),
    RequiredAlias("cricut_sc@vtj.co.jp", "cricut-amazon", "Cricut Amazon"),
    RequiredAlias("cricut_makeshop@vtj.co.jp", "cricut-makeshop", "Cricut オンラインストア"),
    RequiredAlias("gopro_y@vtj.co.jp", "gopro-yahoo", "GoPro Yahoo"),
    RequiredAlias("gopro_order_yahoo@vtj.co.jp", "gopro-yahoo", "GoPro Yahoo"),
    RequiredAlias("gopro_mp@vtj.co.jp", "gopro-mp", "GoPro Amazon"),
    RequiredAlias("vyperglobal_y@vtj.co.jp", "vyperglobal-yahoo", "VYPER GLOBAL Yahoo"),
    RequiredAlias("vyperglobal_sc@vtj.co.jp", "vyperglobal-amazon", "VYPER GLOBAL Amazon"),
    RequiredAlias("vyper_sc@vtj.co.jp", "vyper-amazon", "VYPER SC"),
    RequiredAlias("datacolor_shopify@vtj.co.jp", "datacolor", "Datacolor Shopify"),
    RequiredAlias("akgstore@vtj.co.jp", "akg", "AKGストア"),
    RequiredAlias("sbd@vtj.co.jp", "sbd", "SBD (Black & Decker)"),
    RequiredAlias("secondhand@vtj.co.jp", "secondhand", "セカンドハンド"),
    RequiredAlias("steiner-optics_sc@vtj.co.jp", "steiner", "Steiner Optics"),
    RequiredAlias("ebay@vtj.co.jp", "ebay", "eBay"),
]

REQUIRED_BY_EMAIL = {item.email: item for item in REQUIRED_ALIASES}
REQUIRED_EMAILS = set(REQUIRED_BY_EMAIL)

SCOPES = [
    "https://www.googleapis.com/auth/gmail.settings.sharing",
    "https://www.googleapis.com/auth/gmail.readonly",
]

DEFAULT_SUBJECT = "mailhub@vtj.co.jp"
DEFAULT_SA_KEY = Path.home() / ".config/gcloud/ec-data-hub-sa-key.json"
DEFAULT_LEDGER = (
    Path.home()
    / ".claude/instructions/mailhub-inapp-send/phase1/ops/send-as-ledger.md"
)
DEFAULT_VERIFICATION_URL_DIR = Path.home() / ".claude/secrets"
REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = REPO_ROOT / ".ai-runs/mailhub-next-phase"
EVIDENCE_PREFIX = "sendas-registration"
ALIAS_SLEEP_SECONDS = 1.5

EMAIL_RE = re.compile(r"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}", re.I)
URL_RE = re.compile(r"https?://[^\s\"'<>)]+", re.I)
PRIVATE_KEY_RE = re.compile(
    r"-----BEGIN PRIVATE KEY-----.*?-----END PRIVATE KEY-----", re.S
)
TOKEN_RE = re.compile(r"\bya29\.[A-Za-z0-9_.\-]+")


class Abort(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def now_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def normalize_email(raw: str) -> str:
    value = raw.strip().strip("`").strip().lower()
    match = EMAIL_RE.search(value)
    return match.group(0).lower() if match else value


def strip_md_cell(value: str) -> str:
    value = value.strip()
    if value.startswith("`") and value.endswith("`") and len(value) >= 2:
        value = value[1:-1]
    return value.strip()


def is_md_separator(cells: list[str]) -> bool:
    if not cells:
        return False
    return all(re.fullmatch(r":?-{3,}:?", cell.strip()) for cell in cells)


def is_forbidden_alias(raw: str) -> bool:
    alias = normalize_email(raw)
    local, sep, _domain = alias.partition("@")
    if not sep:
        return False
    if alias == "ams_vyper@vtj.co.jp":
        return True
    if local.startswith("vyper_r"):
        return True
    if local.endswith("_r"):
        return True
    if "rakuten" in alias:
        return True
    return False


def sanitize_text(value: Any, max_len: int = 800) -> str:
    text = str(value)
    text = PRIVATE_KEY_RE.sub("[redacted-private-key]", text)
    text = TOKEN_RE.sub("[redacted-token]", text)
    text = URL_RE.sub("[redacted-url]", text)
    if len(text) > max_len:
        text = text[: max_len - 3] + "..."
    return text


def parse_ledger_aliases_from_text(text: str) -> list[str]:
    aliases: list[str] = []
    alias_col: int | None = None
    saw_alias_header = False

    for line in text.splitlines():
        if not line.lstrip().startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if is_md_separator(cells):
            continue
        normalized = [strip_md_cell(cell).lower() for cell in cells]
        if "alias" in normalized:
            alias_col = normalized.index("alias")
            saw_alias_header = True
            continue
        if alias_col is None or len(cells) <= alias_col:
            continue
        cell = strip_md_cell(cells[alias_col])
        for match in EMAIL_RE.finditer(cell):
            aliases.append(match.group(0).lower())

    if not saw_alias_header:
        raise Abort(2, "ledger markdown table with an alias column was not found")
    return aliases


def duplicate_values(values: list[str]) -> list[str]:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for value in values:
        if value in seen:
            duplicates.add(value)
        seen.add(value)
    return sorted(duplicates)


def validate_ledger_aliases(aliases: list[str], source: str) -> None:
    normalized = [normalize_email(alias) for alias in aliases]
    forbidden = sorted({alias for alias in normalized if is_forbidden_alias(alias)})
    if forbidden:
        raise Abort(
            3,
            f"{source}: forbidden aliases present in ledger: {', '.join(forbidden)}",
        )

    actual = set(normalized)
    missing = sorted(REQUIRED_EMAILS - actual)
    extra = sorted(actual - REQUIRED_EMAILS)
    duplicates = duplicate_values(normalized)
    if missing or extra or duplicates or len(normalized) != len(REQUIRED_ALIASES):
        parts = []
        if missing:
            parts.append(f"missing={','.join(missing)}")
        if extra:
            parts.append(f"extra={','.join(extra)}")
        if duplicates:
            parts.append(f"duplicates={','.join(duplicates)}")
        parts.append(f"rowCount={len(normalized)} expected={len(REQUIRED_ALIASES)}")
        raise Abort(2, f"{source}: ledger alias set mismatch ({'; '.join(parts)})")


def validate_ledger(path: Path) -> None:
    ledger_path = path.expanduser()
    try:
        text = ledger_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise Abort(2, f"cannot read ledger {ledger_path}: {exc}") from exc
    aliases = parse_ledger_aliases_from_text(text)
    validate_ledger_aliases(aliases, str(ledger_path))


def validate_subject(raw: str) -> str:
    subject = raw.strip().strip("`").strip().lower()
    if subject != DEFAULT_SUBJECT:
        raise Abort(2, f"subject must be {DEFAULT_SUBJECT} for D2")
    return subject


def validate_target_alias(raw: str, flag_name: str) -> str:
    alias = normalize_email(raw)
    if is_forbidden_alias(alias):
        raise Abort(3, f"{flag_name} is forbidden: {alias}")
    if alias not in REQUIRED_EMAILS:
        raise Abort(2, f"{flag_name} is not in the 15 allowed aliases: {alias}")
    return alias


def selected_aliases(target: str | None) -> list[RequiredAlias]:
    if target:
        alias = validate_target_alias(target, "--target")
        return [REQUIRED_BY_EMAIL[alias]]
    return list(REQUIRED_ALIASES)


def validate_rollback_alias(raw: str) -> str:
    alias = normalize_email(raw)
    if alias == DEFAULT_SUBJECT:
        raise Abort(2, "primary shared inbox address is not rollback-eligible")
    if is_forbidden_alias(alias):
        raise Abort(3, f"--rollback is forbidden: {alias}")
    if alias not in REQUIRED_EMAILS:
        raise Abort(2, f"--rollback is not in the 15 allowed aliases: {alias}")
    return alias


def build_gmail_service(sa_key: Path, subject: str):
    # Lazy imports keep --self-test runnable without google-api-python-client.
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    credentials = service_account.Credentials.from_service_account_file(
        str(sa_key.expanduser()),
        scopes=SCOPES,
    ).with_subject(subject)
    return build("gmail", "v1", credentials=credentials, cache_discovery=False)


def http_status(exc: BaseException) -> int | None:
    resp = getattr(exc, "resp", None)
    return getattr(resp, "status", None)


def status_from_send_as(item: dict[str, Any] | None) -> str:
    if not item:
        return "unknown"
    if item.get("isPrimary") is True:
        return "accepted"
    return str(item.get("verificationStatus") or "unknown")


def existing_send_as_map(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for item in items:
        email = item.get("sendAsEmail")
        if not email:
            continue
        result[normalize_email(str(email))] = item
    return result


def fetch_send_as_list(service, subject: str) -> list[dict[str, Any]]:
    response = service.users().settings().sendAs().list(userId=subject).execute()
    return list(response.get("sendAs", []) or [])


def fetch_send_as(service, subject: str, alias: str) -> dict[str, Any] | None:
    return (
        service.users()
        .settings()
        .sendAs()
        .get(userId=subject, sendAsEmail=alias)
        .execute()
    )


def classify_alias_state(
    alias: str,
    existing: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    if is_forbidden_alias(alias):
        return {
            "alias": alias,
            "action": "FORBIDDEN",
            "verificationStatus": "forbidden",
            "note": "blocked by forbidden alias guard",
        }
    item = existing.get(alias)
    if item:
        return {
            "alias": alias,
            "action": "SKIP",
            "verificationStatus": status_from_send_as(item),
            "note": "already registered",
        }
    return {
        "alias": alias,
        "action": "CREATE",
        "verificationStatus": "unregistered",
        "note": "not registered",
    }


def build_diff_rows(
    aliases: list[RequiredAlias],
    existing: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    rows = []
    for item in aliases:
        row = classify_alias_state(item.email, existing)
        row["channelLabel"] = item.channel_label
        row["channelId"] = item.channel_id
        rows.append(row)
    return rows


def print_markdown_table(headers: list[str], rows: list[list[Any]]) -> None:
    print("| " + " | ".join(headers) + " |")
    print("| " + " | ".join("---" for _ in headers) + " |")
    for row in rows:
        print("| " + " | ".join(str(cell) for cell in row) + " |")


def print_diff(rows: list[dict[str, Any]], mode: str) -> None:
    print("\nGmail send-as diff")
    print(f"mode={mode}")
    print_markdown_table(
        ["alias", "channelLabel", "action", "verificationStatus", "note"],
        [
            [
                f"`{row['alias']}`",
                row.get("channelLabel", ""),
                row["action"],
                row.get("verificationStatus", ""),
                row.get("note", ""),
            ]
            for row in rows
        ],
    )


def redacted_result(row: dict[str, Any]) -> dict[str, Any]:
    allowed = {
        "alias",
        "channelId",
        "channelLabel",
        "action",
        "verificationStatus",
        "status",
        "checkedAt",
        "note",
        "error",
        "verificationUrlFound",
        "verificationUrlCount",
    }
    result: dict[str, Any] = {}
    for key, value in row.items():
        if key not in allowed:
            continue
        if key == "error":
            result[key] = sanitize_text(value)
        else:
            result[key] = value
    return result


def write_evidence(
    *,
    mode: str,
    subject: str,
    ledger_path: Path,
    results: list[dict[str, Any]],
    started_at: str,
    cancelled: bool = False,
) -> str:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUTPUT_DIR / f"{EVIDENCE_PREFIX}-{now_stamp()}.json"
    payload = {
        "operator": os.environ.get("USER") or os.environ.get("USERNAME") or "unknown",
        "timestamp": started_at,
        "mode": mode,
        "cancelled": cancelled,
        "subject": subject,
        "ledger": str(ledger_path.expanduser()),
        "scopes": SCOPES,
        "aliases": [redacted_result(row) for row in results],
        "redaction": {
            "tokenValuesStored": False,
            "privateKeyStored": False,
            "verificationUrlsStored": False,
        },
    }
    with out.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return str(out.relative_to(REPO_ROOT))


def print_ledger_update_rows(results: list[dict[str, Any]], evidence_ref: str) -> None:
    print("\nsend-as-ledger.md update rows")
    print_markdown_table(
        ["alias", "verificationStatus", "checkedAt", "evidenceRef"],
        [
            [
                f"`{row['alias']}`",
                row.get("verificationStatus") or row.get("status") or "unknown",
                row.get("checkedAt", ""),
                f"`{evidence_ref}`",
            ]
            for row in results
            if row.get("alias")
        ],
    )


def aliases_needing_verification(results: list[dict[str, Any]]) -> list[str]:
    aliases: list[str] = []
    for row in results:
        alias = row.get("alias")
        if not alias:
            continue
        status = str(row.get("verificationStatus") or "unknown").lower()
        if status != "accepted":
            aliases.append(normalize_email(str(alias)))
    return aliases


def apply_result_exit_code(results: list[dict[str, Any]]) -> int:
    if any(row.get("action") == "ERROR" for row in results):
        return 1
    if any(row.get("action") == "FORBIDDEN" for row in results):
        return 3
    if aliases_needing_verification(results):
        return 4
    return 0


def confirm_yes(prompt: str) -> bool:
    try:
        answer = input(prompt)
    except EOFError:
        answer = ""
    return answer.strip().lower() == "yes"


def decode_base64url(data: str) -> str:
    padded = data + "=" * (-len(data) % 4)
    raw = base64.urlsafe_b64decode(padded.encode("ascii"))
    return raw.decode("utf-8", errors="replace")


def extract_message_text(payload: dict[str, Any]) -> str:
    chunks: list[str] = []

    def walk(part: dict[str, Any]) -> None:
        body = part.get("body") or {}
        data = body.get("data")
        if data:
            try:
                chunks.append(decode_base64url(str(data)))
            except Exception:
                pass
        for child in part.get("parts") or []:
            if isinstance(child, dict):
                walk(child)

    walk(payload)
    return "\n".join(chunks)


def extract_google_verification_urls(text: str) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    for match in URL_RE.finditer(text):
        url = match.group(0).rstrip(".,;")
        lower = url.lower()
        if "google." not in lower:
            continue
        if not any(token in lower for token in ["verify", "confirm", "mail"]):
            continue
        if url in seen:
            continue
        seen.add(url)
        urls.append(url)
    return urls


def write_verification_urls(alias: str, urls: list[str]) -> Path:
    DEFAULT_VERIFICATION_URL_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    out = DEFAULT_VERIFICATION_URL_DIR / f"mailhub-sendas-verification-urls-{now_stamp()}.txt"
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(f"alias={alias}\n")
        for url in urls:
            f.write(f"{url}\n")
    os.chmod(out, 0o600)
    return out


def search_and_print_verification_urls(service, subject: str, alias: str) -> tuple[int, int]:
    queries = [
        f"(from:forwarding-noreply@google.com OR from:mail-noreply@google.com) {alias} newer_than:14d",
        f"from:forwarding-noreply@google.com {alias} newer_than:14d",
        f"\"{alias}\" newer_than:14d",
    ]
    found_urls: list[str] = []
    seen_urls: set[str] = set()
    searched_messages = 0

    for query in queries:
        response = (
            service.users()
            .messages()
            .list(userId=subject, q=query, labelIds=["INBOX"], maxResults=10)
            .execute()
        )
        for message in response.get("messages") or []:
            message_id = message.get("id")
            if not message_id:
                continue
            searched_messages += 1
            detail = (
                service.users()
                .messages()
                .get(userId=subject, id=message_id, format="full")
                .execute()
            )
            text = detail.get("snippet", "") + "\n" + extract_message_text(detail.get("payload") or {})
            for url in extract_google_verification_urls(text):
                if url in seen_urls:
                    continue
                seen_urls.add(url)
                found_urls.append(url)

    if found_urls:
        out = write_verification_urls(alias, found_urls)
        print(
            f"\n[verification-email] verificationUrlCount={len(found_urls)} "
            f"file={out}"
        )
    else:
        print(f"\n[verification-email] {alias}: no verification URL found in INBOX fallback search")
    return searched_messages, len(found_urls)


def create_one_alias(service, subject: str, item: RequiredAlias) -> dict[str, Any]:
    alias = item.email
    result = {
        "alias": alias,
        "channelId": item.channel_id,
        "channelLabel": item.channel_label,
        "action": "CREATE",
        "verificationStatus": "unknown",
        "checkedAt": now_iso(),
    }

    body = {"sendAsEmail": alias, "displayName": item.channel_label}
    try:
        response = (
            service.users()
            .settings()
            .sendAs()
            .create(userId=subject, body=body)
            .execute()
        )
    except Exception as exc:
        if http_status(exc) == 409:
            try:
                existing = fetch_send_as(service, subject, alias)
                status = status_from_send_as(existing)
            except Exception:
                status = "unknown"
            result.update(
                {
                    "action": "SKIP",
                    "verificationStatus": status,
                    "note": "create returned 409; treated as already registered",
                    "checkedAt": now_iso(),
                }
            )
            return result
        result.update(
            {
                "action": "ERROR",
                "verificationStatus": "error",
                "error": sanitize_text(exc),
                "checkedAt": now_iso(),
            }
        )
        return result

    response_status = status_from_send_as(response)
    result["note"] = f"createResponseStatus={response_status}"

    try:
        current = fetch_send_as(service, subject, alias)
    except Exception as exc:
        result.update(
            {
                "action": "ERROR",
                "verificationStatus": "error",
                "error": f"sendAs.get failed after create: {sanitize_text(exc)}",
                "checkedAt": now_iso(),
            }
        )
        return result

    current_status = status_from_send_as(current)
    result["verificationStatus"] = current_status
    result["checkedAt"] = now_iso()
    if current_status == "accepted":
        result["status"] = "OK"
        return result

    if current_status == "pending":
        try:
            service.users().settings().sendAs().verify(
                userId=subject,
                sendAsEmail=alias,
            ).execute()
            time.sleep(1.0)
            current = fetch_send_as(service, subject, alias)
            current_status = status_from_send_as(current)
            result["verificationStatus"] = current_status
            result["checkedAt"] = now_iso()
        except Exception as exc:
            result.update(
                {
                    "action": "ERROR",
                    "verificationStatus": "error",
                    "error": f"sendAs.verify/get failed: {sanitize_text(exc)}",
                    "checkedAt": now_iso(),
                }
            )
            return result

    if current_status == "accepted":
        result["status"] = "OK"
        return result

    if current_status == "pending":
        try:
            searched, url_count = search_and_print_verification_urls(service, subject, alias)
            result["verificationStatus"] = "pending"
            result["verificationUrlFound"] = url_count > 0
            result["verificationUrlCount"] = url_count
            result["note"] = f"pending after verify; searchedMessages={searched}"
            result["checkedAt"] = now_iso()
        except Exception as exc:
            result.update(
                {
                    "action": "ERROR",
                    "verificationStatus": "error",
                    "error": f"verification email fallback failed: {sanitize_text(exc)}",
                    "checkedAt": now_iso(),
                }
            )
        return result

    result["note"] = f"unexpected verificationStatus={current_status}"
    return result


def run_rollback(args: argparse.Namespace, started_at: str) -> int:
    subject = validate_subject(args.subject)
    ledger_path = Path(args.ledger)
    validate_ledger(ledger_path)
    alias = validate_rollback_alias(args.rollback)

    print("=" * 60)
    print("rollback mode: Gmail send-as delete")
    print(f"subject={subject}")
    print(f"alias={alias}")
    print("=" * 60)
    if not args.yes and not confirm_yes("Delete this send-as alias? Type yes: "):
        result = {
            "alias": alias,
            "action": "CANCELLED",
            "verificationStatus": "unchanged",
            "checkedAt": now_iso(),
            "note": "operator did not confirm rollback",
        }
        evidence_ref = write_evidence(
            mode="rollback",
            subject=subject,
            ledger_path=ledger_path,
            results=[result],
            started_at=started_at,
            cancelled=True,
        )
        print(f"[output] evidence: {evidence_ref}")
        print_ledger_update_rows([result], evidence_ref)
        return 0

    try:
        service = build_gmail_service(Path(args.sa_key), subject)
        service.users().settings().sendAs().delete(
            userId=subject,
            sendAsEmail=alias,
        ).execute()
        result = {
            "alias": alias,
            "action": "DELETE",
            "verificationStatus": "removed",
            "checkedAt": now_iso(),
            "status": "OK",
        }
    except Exception as exc:
        if http_status(exc) == 404:
            result = {
                "alias": alias,
                "action": "SKIP",
                "verificationStatus": "removed",
                "checkedAt": now_iso(),
                "note": "delete returned 404; alias was not registered",
            }
        else:
            result = {
                "alias": alias,
                "action": "ERROR",
                "verificationStatus": "error",
                "checkedAt": now_iso(),
                "error": sanitize_text(exc),
            }

    evidence_ref = write_evidence(
        mode="rollback",
        subject=subject,
        ledger_path=ledger_path,
        results=[result],
        started_at=started_at,
    )
    print(f"[output] evidence: {evidence_ref}")
    print_ledger_update_rows([result], evidence_ref)
    return 1 if result["action"] == "ERROR" else 0


def run_register(args: argparse.Namespace, started_at: str) -> int:
    subject = validate_subject(args.subject)
    ledger_path = Path(args.ledger)
    validate_ledger(ledger_path)
    aliases = selected_aliases(args.target)
    mode = "apply" if args.apply else "dry-run"

    try:
        service = build_gmail_service(Path(args.sa_key), subject)
        existing_items = fetch_send_as_list(service, subject)
    except Exception as exc:
        results = [
            {
                "alias": item.email,
                "channelId": item.channel_id,
                "channelLabel": item.channel_label,
                "action": "ERROR",
                "verificationStatus": "error",
                "checkedAt": now_iso(),
                "error": sanitize_text(exc),
            }
            for item in aliases
        ]
        evidence_ref = write_evidence(
            mode=mode,
            subject=subject,
            ledger_path=ledger_path,
            results=results,
            started_at=started_at,
        )
        print(f"[output] evidence: {evidence_ref}")
        print_ledger_update_rows(results, evidence_ref)
        return 1

    existing = existing_send_as_map(existing_items)
    diff_rows = build_diff_rows(aliases, existing)
    print_diff(diff_rows, mode)

    if not args.apply:
        print("\nDry-run complete: no write API calls were made.")
        for row in diff_rows:
            row["checkedAt"] = now_iso()
        evidence_ref = write_evidence(
            mode="dry-run",
            subject=subject,
            ledger_path=ledger_path,
            results=diff_rows,
            started_at=started_at,
        )
        print(f"[output] evidence: {evidence_ref}")
        print_ledger_update_rows(diff_rows, evidence_ref)
        return 0

    if len(aliases) >= 2 and not args.yes:
        print("\n--apply targets")
        for item in aliases:
            print(f"  - {item.email} ({item.channel_label})")
        if not confirm_yes("Create missing send-as aliases? Type yes: "):
            for row in diff_rows:
                row["action"] = "CANCELLED"
                row["checkedAt"] = now_iso()
                row["note"] = "operator did not confirm apply"
            evidence_ref = write_evidence(
                mode="apply",
                subject=subject,
                ledger_path=ledger_path,
                results=diff_rows,
                started_at=started_at,
                cancelled=True,
            )
            print(f"[output] evidence: {evidence_ref}")
            print_ledger_update_rows(diff_rows, evidence_ref)
            return 0

    results: list[dict[str, Any]] = []
    for index, item in enumerate(aliases):
        existing_row = classify_alias_state(item.email, existing)
        if existing_row["action"] == "SKIP":
            existing_row.update(
                {
                    "channelId": item.channel_id,
                    "channelLabel": item.channel_label,
                    "checkedAt": now_iso(),
                }
            )
            results.append(existing_row)
        elif existing_row["action"] == "FORBIDDEN":
            existing_row.update(
                {
                    "channelId": item.channel_id,
                    "channelLabel": item.channel_label,
                    "checkedAt": now_iso(),
                }
            )
            results.append(existing_row)
        else:
            print(f"\n[create {index + 1}/{len(aliases)}] {item.email} ({item.channel_label})")
            result = create_one_alias(service, subject, item)
            results.append(result)

        if index < len(aliases) - 1:
            time.sleep(ALIAS_SLEEP_SECONDS)

    evidence_ref = write_evidence(
        mode="apply",
        subject=subject,
        ledger_path=ledger_path,
        results=results,
        started_at=started_at,
    )
    print(f"\n[output] evidence: {evidence_ref}")
    print_ledger_update_rows(results, evidence_ref)

    exit_code = apply_result_exit_code(results)
    if exit_code == 4:
        print(f"NEEDS_VERIFICATION: {', '.join(aliases_needing_verification(results))}")
    return exit_code


def build_sample_ledger(aliases: list[str]) -> str:
    lines = [
        "| alias | channelId | channelLabel | replyKind | requiredForT2 | verificationStatus | checkedAt | evidenceRef | notes |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for alias in aliases:
        item = REQUIRED_BY_EMAIL.get(normalize_email(alias))
        channel_id = item.channel_id if item else "extra"
        label = item.channel_label if item else "Extra"
        lines.append(
            f"| `{alias}` | `{channel_id}` | {label} | gmail | true | unregistered |  |  | self-test |"
        )
    return "\n".join(lines)


def expect_abort(
    name: str,
    expected_code: int,
    fn,
) -> tuple[str, bool, str]:
    try:
        fn()
    except Abort as exc:
        ok = exc.code == expected_code
        return name, ok, f"exit={exc.code} message={exc.message}"
    return name, False, "no Abort raised"


def expect_pass(name: str, fn) -> tuple[str, bool, str]:
    try:
        detail = fn()
    except Exception as exc:
        return name, False, sanitize_text(exc)
    return name, True, str(detail or "ok")


def expect_value(name: str, expected: Any, fn) -> tuple[str, bool, str]:
    try:
        actual = fn()
    except Exception as exc:
        return name, False, sanitize_text(exc)
    return name, actual == expected, f"value={actual} expected={expected}"


def self_test_cases() -> list[tuple[str, bool, str]]:
    ordered = [item.email for item in REQUIRED_ALIASES]
    existing = {
        "cricut_y@vtj.co.jp": {
            "sendAsEmail": "cricut_y@vtj.co.jp",
            "verificationStatus": "accepted",
        }
    }
    accepted_results = [
        {
            "alias": "cricut_y@vtj.co.jp",
            "action": "SKIP",
            "verificationStatus": "accepted",
        },
        {
            "alias": "ebay@vtj.co.jp",
            "action": "CREATE",
            "verificationStatus": "accepted",
        },
    ]
    pending_mixed_results = accepted_results + [
        {
            "alias": "gopro_mp@vtj.co.jp",
            "action": "SKIP",
            "verificationStatus": "pending",
        }
    ]
    error_mixed_results = pending_mixed_results + [
        {
            "alias": "sbd@vtj.co.jp",
            "action": "ERROR",
            "verificationStatus": "error",
        }
    ]
    return [
        expect_pass(
            "googleapiclient is not imported during self-test",
            lambda: "not imported"
            if not any(name.startswith("googleapiclient") for name in sys.modules)
            else (_ for _ in ()).throw(AssertionError("googleapiclient imported")),
        ),
        expect_pass(
            "constants contain exactly 15 aliases",
            lambda: f"count={len(REQUIRED_ALIASES)}"
            if len(REQUIRED_ALIASES) == 15 and len(REQUIRED_EMAILS) == 15
            else (_ for _ in ()).throw(AssertionError("bad alias count")),
        ),
        expect_pass(
            "ledger exact 15 aliases passes",
            lambda: validate_ledger_aliases(
                parse_ledger_aliases_from_text(build_sample_ledger(ordered)),
                "self-test-ledger",
            ),
        ),
        expect_abort(
            "ledger missing alias aborts exit 2",
            2,
            lambda: validate_ledger_aliases(
                parse_ledger_aliases_from_text(build_sample_ledger(ordered[:-1])),
                "self-test-ledger",
            ),
        ),
        expect_abort(
            "ledger extra alias aborts exit 2",
            2,
            lambda: validate_ledger_aliases(
                parse_ledger_aliases_from_text(
                    build_sample_ledger(ordered + ["extra_alias@vtj.co.jp"])
                ),
                "self-test-ledger",
            ),
        ),
        expect_abort(
            "ledger duplicate alias aborts exit 2",
            2,
            lambda: validate_ledger_aliases(
                parse_ledger_aliases_from_text(build_sample_ledger(ordered + [ordered[0]])),
                "self-test-ledger",
            ),
        ),
        expect_abort(
            "ledger ams_vyper forbidden aborts exit 3",
            3,
            lambda: validate_ledger_aliases(
                parse_ledger_aliases_from_text(
                    build_sample_ledger(ordered[:-1] + ["ams_vyper@vtj.co.jp"])
                ),
                "self-test-ledger",
            ),
        ),
        expect_abort(
            "ledger rakuten/_r forbidden aborts exit 3",
            3,
            lambda: validate_ledger_aliases(
                parse_ledger_aliases_from_text(
                    build_sample_ledger(ordered[:-1] + ["gopro_r@vtj.co.jp"])
                ),
                "self-test-ledger",
            ),
        ),
        expect_abort(
            "target forbidden aborts exit 3",
            3,
            lambda: validate_target_alias("cricut_r@vtj.co.jp", "--target"),
        ),
        expect_abort(
            "target outside 15 aborts exit 2",
            2,
            lambda: validate_target_alias("other@vtj.co.jp", "--target"),
        ),
        expect_pass(
            "diff classifies existing alias as SKIP",
            lambda: classify_alias_state("cricut_y@vtj.co.jp", existing)["action"],
        ),
        expect_pass(
            "diff classifies missing alias as CREATE",
            lambda: classify_alias_state("ebay@vtj.co.jp", existing)["action"],
        ),
        expect_pass(
            "diff classifies forbidden alias as FORBIDDEN",
            lambda: classify_alias_state("vyper_r@vtj.co.jp", existing)["action"],
        ),
        expect_pass(
            "rollback allows a required alias",
            lambda: validate_rollback_alias("ebay@vtj.co.jp"),
        ),
        expect_abort(
            "rollback rejects primary mailhub address",
            2,
            lambda: validate_rollback_alias("mailhub@vtj.co.jp"),
        ),
        expect_abort(
            "rollback rejects forbidden alias",
            3,
            lambda: validate_rollback_alias("vyper_rakuten@vtj.co.jp"),
        ),
        expect_abort(
            "subject outside vtj domain aborts exit 2",
            2,
            lambda: validate_subject("mailhub@example.com"),
        ),
        expect_abort(
            "subject info mailbox aborts exit 2",
            2,
            lambda: validate_subject("info@vtj.co.jp"),
        ),
        expect_value(
            "apply summary accepted only exits 0",
            0,
            lambda: apply_result_exit_code(accepted_results),
        ),
        expect_value(
            "apply summary pending mixed exits 4",
            4,
            lambda: apply_result_exit_code(pending_mixed_results),
        ),
        expect_value(
            "apply summary error mixed exits 1",
            1,
            lambda: apply_result_exit_code(error_mixed_results),
        ),
    ]


def run_self_test() -> int:
    print("SELF-TEST: no Gmail API calls; googleapiclient is not imported")
    cases = self_test_cases()
    passed = 0
    for name, ok, detail in cases:
        status = "PASS" if ok else "FAIL"
        print(f"{status} - {name} ({detail})")
        if ok:
            passed += 1
    print(f"SELF-TEST {'PASS' if passed == len(cases) else 'FAIL'} ({passed}/{len(cases)})")
    return 0 if passed == len(cases) else 1


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="MailHub Gmail send-as alias registration tool (default dry-run)",
    )
    parser.add_argument("--apply", action="store_true", help="create missing send-as aliases")
    parser.add_argument("--yes", action="store_true", help="skip interactive yes confirmation")
    parser.add_argument("--target", help="limit registration diff/apply to one alias")
    parser.add_argument(
        "--ledger",
        default=str(DEFAULT_LEDGER),
        help=f"send-as ledger markdown path (default: {DEFAULT_LEDGER})",
    )
    parser.add_argument(
        "--sa-key",
        default=str(DEFAULT_SA_KEY),
        help=f"service account key path (default: {DEFAULT_SA_KEY})",
    )
    parser.add_argument(
        "--subject",
        default=DEFAULT_SUBJECT,
        help=f"DWD subject user (default: {DEFAULT_SUBJECT})",
    )
    parser.add_argument("--rollback", help="delete one of the 15 send-as aliases")
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="run local parser/guard/diff tests without importing googleapiclient",
    )
    args = parser.parse_args(argv)
    if args.rollback and args.target:
        parser.error("--rollback cannot be combined with --target")
    if args.rollback and args.apply:
        parser.error("--rollback is destructive by itself; do not combine it with --apply")
    return args


def write_abort_evidence(args: argparse.Namespace, started_at: str, exc: Abort) -> None:
    if args.self_test:
        mode = "self-test"
    elif args.rollback:
        mode = "rollback"
    elif args.apply:
        mode = "apply"
    else:
        mode = "dry-run"
    subject = normalize_email(str(getattr(args, "subject", DEFAULT_SUBJECT)))
    ledger_path = Path(getattr(args, "ledger", DEFAULT_LEDGER))
    result = {
        "alias": normalize_email(str(args.rollback or args.target or "")),
        "action": "ABORT",
        "verificationStatus": "error",
        "checkedAt": now_iso(),
        "error": f"exit {exc.code}: {exc.message}",
    }
    evidence_ref = write_evidence(
        mode=mode,
        subject=subject,
        ledger_path=ledger_path,
        results=[result],
        started_at=started_at,
    )
    print(f"[output] evidence: {evidence_ref}", file=sys.stderr)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    if args.self_test:
        return run_self_test()

    started_at = now_iso()
    try:
        if args.rollback:
            return run_rollback(args, started_at)
        return run_register(args, started_at)
    except Abort as exc:
        try:
            write_abort_evidence(args, started_at, exc)
        except Exception as evidence_exc:
            print(
                f"[output] evidence write failed: {sanitize_text(evidence_exc)}",
                file=sys.stderr,
            )
        print(f"ABORT exit {exc.code}: {exc.message}", file=sys.stderr)
        return exc.code
    except KeyboardInterrupt:
        print("Interrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
