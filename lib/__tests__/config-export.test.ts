import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { buildConfigExportFilename, buildConfigExportPayload } from "@/lib/config-export";
import type { RegisteredLabel } from "@/lib/labelRegistryStore";
import type { LabelRule } from "@/lib/labelRules";

// 秘密情報のキーワード（大文字小文字を問わず、雑でも強いチェック）
const FORBIDDEN_SUBSTRINGS = [
  "GOOGLE_",
  "NEXTAUTH_",
  "MAILHUB_ALERTS_SECRET",
  "MAILHUB_CONFIG_EXPORT_SECRET",
  "SLACK_WEBHOOK_URL",
  "MAILHUB_SHEETS_PRIVATE_KEY",
  "MAILHUB_ADMINS",
  "CLIENT_SECRET",
  "CLIENT_ID", // IDも含める（念のため）
  "REFRESH_TOKEN",
  "REFRESH",
  "TOKEN",
  "SECRET",
  "WEBHOOK",
  "refresh",
  "token",
  "secret",
  "webhook",
  "client_secret",
  "client_id",
  "refresh_token",
];

describe("config export", () => {
  const prevEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...prevEnv };
    process.env.MAILHUB_ENV = "staging";
    process.env.MAILHUB_CONFIG_STORE = "file";
  });

  afterEach(() => {
    process.env = prevEnv;
  });

  test("buildConfigExportFilename includes env + timestamp and ends with .json", () => {
    const name = buildConfigExportFilename();
    expect(name.startsWith("mailhub-config-staging-")).toBe(true);
    expect(name.endsWith(".json")).toBe(true);
  });

  test("buildConfigExportPayload contains only safe config + meta (no secrets)", () => {
    const labels: RegisteredLabel[] = [
      { labelName: "MailHub/Label/VIP", displayName: "VIP", createdAt: new Date().toISOString() },
    ];
    const rules: LabelRule[] = [
      {
        id: "r-1",
        enabled: true,
        createdAt: new Date().toISOString(),
        match: { fromEmail: "a@example.com" },
        labelNames: ["MailHub/Label/VIP"],
      },
    ];

    const payload = buildConfigExportPayload({ labels, rules, assignees: [] });
    expect(payload.labels.length).toBe(1);
    expect(payload.rules.length).toBe(1);

    const json = JSON.stringify(payload);
    for (const s of FORBIDDEN_SUBSTRINGS) {
      // 大文字小文字を問わずチェック（雑でも強い）
      const jsonLower = json.toLowerCase();
      const searchLower = s.toLowerCase();
      expect(jsonLower.includes(searchLower)).toBe(false);
    }
  });

  test("buildConfigExportPayload does not include env variables or secrets in keys", () => {
    const labels: RegisteredLabel[] = [];
    const rules: LabelRule[] = [];

    const payload = buildConfigExportPayload({ labels, rules, assignees: [] });
    const json = JSON.stringify(payload, null, 2);

    // キー名に秘密情報が含まれていないことを確認
    const forbiddenKeys = ["secret", "token", "refresh", "webhook", "client_secret", "client_id"];
    for (const key of forbiddenKeys) {
      // キー名として出現しないことを確認（値として含まれる可能性はあるが、キー名としてはNG）
      const keyPattern = new RegExp(`"\\s*${key}\\s*"\\s*:`, "i");
      expect(keyPattern.test(json)).toBe(false);
    }
  });
});

