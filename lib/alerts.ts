import "server-only";
import { getActivityLogs, type AuditAction } from "./audit-log";
import { isTestMode } from "./test-mode";
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

function truncateChatworkLine(value: string, max = 500): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

function formatChatworkPayload(payload: AlertPayload): string {
  const lines: string[] = [];
  lines.push(`[info][title]${payload.title}[/title]`);
  lines.push(payload.text);
  if (payload.openUrl || payload.openCriticalUrl) {
    lines.push("");
    lines.push("MailHubで確認:");
    if (payload.openUrl) lines.push(`- SLA Focus: ${payload.openUrl}`);
    if (payload.openCriticalUrl) lines.push(`- Critical-only: ${payload.openCriticalUrl}`);
  }

  if (payload.items.length > 0) {
    lines.push("");
    lines.push("超過メール（上位5件）:");
    for (const item of payload.items.slice(0, 5)) {
      const status = item.status === "critical" ? "CRITICAL" : "WARN";
      lines.push(`- [${status}] ${truncateChatworkLine(item.subject || "(no subject)")}`);
      lines.push(`  経過: ${item.age}${item.assignee ? ` / 担当: ${item.assignee}` : ""}`);
      if (item.url) lines.push(`  MailHub: ${item.url}`);
      if (item.takeUrl) lines.push(`  Take: ${item.takeUrl}`);
      lines.push(`  Gmail: ${item.gmailLink}`);
    }
  }
  lines.push("[/info]");
  return lines.join("\n");
}

// Chatwork通知プロバイダー
export class ChatworkProvider implements AlertProvider {
  private apiToken: string;
  private roomId: string;
  private baseUrl: string;

  constructor(apiToken: string, roomId: string, baseUrl: string = "https://api.chatwork.com/v2") {
    this.apiToken = apiToken;
    this.roomId = roomId;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async send(payload: AlertPayload): Promise<void> {
    const body = formatChatworkPayload(payload);
    const response = await fetch(`${this.baseUrl}/rooms/${encodeURIComponent(this.roomId)}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-ChatWorkToken": this.apiToken,
      },
      body: new URLSearchParams({ body, self_unread: "0" }).toString(),
    });

    if (!response.ok) {
      throw new Error(`Chatwork API failed: ${response.status}`);
    }
  }
}

// テストモード用（ログ出力のみ）
export class LogProvider implements AlertProvider {
  async send(payload: AlertPayload): Promise<void> {
    console.log("[AlertProvider] Alert would be sent:", JSON.stringify(payload, null, 2));
  }
}

export class MisconfiguredProvider implements AlertProvider {
  private reason: string;

  constructor(reason: string) {
    this.reason = reason;
  }

  async send(): Promise<void> {
    throw new Error(this.reason);
  }
}

// 無効化プロバイダー
export class NoneProvider implements AlertProvider {
  async send(): Promise<void> {
    throw new Error("alerts_provider_disabled");
  }
}

/**
 * AlertProviderインスタンスを取得
 */
export function getAlertProvider(): AlertProvider {
  const provider = (process.env.MAILHUB_ALERTS_PROVIDER || "none").trim().toLowerCase();
  const webhookUrl = process.env.MAILHUB_SLACK_WEBHOOK_URL;
  const chatworkToken = process.env.MAILHUB_CHATWORK_API_TOKEN;
  const chatworkRoomId = process.env.MAILHUB_CHATWORK_ROOM_ID;

  if (provider === "log" || isTestMode()) {
    return new LogProvider();
  }

  if (provider === "slack") {
    if (!webhookUrl) {
      return new MisconfiguredProvider("slack_webhook_missing");
    }
    return new SlackProvider(webhookUrl);
  }

  if (provider === "chatwork") {
    if (!chatworkToken || !chatworkRoomId) {
      return new MisconfiguredProvider("chatwork_config_missing");
    }
    return new ChatworkProvider(chatworkToken, chatworkRoomId);
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
