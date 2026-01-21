import "server-only";
import { getActivityLogs, type AuditAction } from "./audit-log";
import type { SLAStatus } from "./slaRules";

export interface AlertProvider {
  send(payload: AlertPayload): Promise<void>;
}

export type AlertPayload = {
  title: string;
  text: string;
  items: Array<{
    subject: string;
    age: string;
    assignee?: string;
    gmailLink: string;
    status: SLAStatus;
    url?: string; // Step 68: MailHub直リンク
    takeUrl?: string; // Step 71: Take導線（担当UIを開く）
  }>;
  openUrl?: string; // Step 68: SLA Focus直リンク
  openCriticalUrl?: string; // Step 68: Critical-only直リンク
};

// Slack通知プロバイダー
export class SlackProvider implements AlertProvider {
  private webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  async send(payload: AlertPayload): Promise<void> {
    const blocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: payload.title,
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: payload.text,
        },
      },
    ];

    // Step 68: SLA Focus直リンクを追加
    if (payload.openUrl || payload.openCriticalUrl) {
      const links: string[] = [];
      if (payload.openUrl) links.push(`<${payload.openUrl}|📋 SLA Focus>`);
      if (payload.openCriticalUrl) links.push(`<${payload.openCriticalUrl}|🔴 Critical-only>`);
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*MailHubで確認:* ${links.join(" | ")}`,
        },
      });
    }

    if (payload.items.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*超過メール（上位5件）:*",
        },
      });

      for (const item of payload.items.slice(0, 5)) {
        const statusEmoji = item.status === "critical" ? "🔴" : "🟡";
        // Step 68: MailHub直リンクを追加
        const mailhubLink = item.url ? ` | <${item.url}|Open in MailHub>` : "";
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${statusEmoji} *${item.subject || "(no subject)"}*\n` +
              `経過: ${item.age}${item.assignee ? ` | 担当: ${item.assignee}` : ""}\n` +
              `<${item.gmailLink}|Open in Gmail>${mailhubLink}`,
          },
        });
      }
    }

    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks }),
    });

    if (!response.ok) {
      throw new Error(`Slack webhook failed: ${response.status}`);
    }
  }
}

// テストモード用（ログ出力のみ）
export class LogProvider implements AlertProvider {
  async send(payload: AlertPayload): Promise<void> {
    console.log("[AlertProvider] Alert would be sent:", JSON.stringify(payload, null, 2));
  }
}

// 無効化プロバイダー
export class NoneProvider implements AlertProvider {
  async send(payload: AlertPayload): Promise<void> {
    // 何もしない（interface整合のためpayloadは受け取る）
    void payload;
  }
}

/**
 * AlertProviderインスタンスを取得
 */
export function getAlertProvider(): AlertProvider {
  const provider = process.env.MAILHUB_ALERTS_PROVIDER || "none";
  const webhookUrl = process.env.MAILHUB_SLACK_WEBHOOK_URL;

  if (provider === "slack") {
    if (!webhookUrl) {
      console.warn("[AlertProvider] Slack webhook URL not configured, falling back to LogProvider");
      return new LogProvider();
    }
    return new SlackProvider(webhookUrl);
  }

  if (provider === "log" || process.env.MAILHUB_TEST_MODE === "1") {
    return new LogProvider();
  }

  return new NoneProvider();
}

/**
 * 重複防止チェック（Activityログで確認）
 */
export async function shouldSkipAlert(
  messageId: string,
  actionName: AuditAction,
  cooldownHours: number = 24
): Promise<boolean> {
  const logs = await getActivityLogs({ limit: 200, action: actionName });
  const cutoffTime = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);
  
  return logs.some((log) => {
    if (log.messageId !== messageId || log.action !== actionName) {
      return false;
    }
    try {
      const logTime = new Date(log.timestamp);
      return logTime >= cutoffTime;
    } catch {
      return false;
    }
  });
}

