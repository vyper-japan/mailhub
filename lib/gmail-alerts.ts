import "server-only";
import { google } from "googleapis";
import { mustGetEnv } from "@/lib/env";
import { isTestMode } from "@/lib/test-mode";
import type { InboxListMessage } from "./mailhub-types";
import { buildGmailLink } from "./gmail";
import messagesFixture from "@/fixtures/messages.json";

/**
 * Gmail検索クエリで候補を抽出（ページング対応）
 * 古いメールが漏れないように、複数ページを取得する
 */
export async function listCandidatesByQuery(options: {
  q: string;
  maxPages?: number;
  maxTotal?: number;
}): Promise<{ messages: InboxListMessage[]; truncated: boolean }> {
  const { q, maxPages = 10, maxTotal = 1500 } = options;

  // テストモード: fixtureから返す（簡易マッチ）
  if (isTestMode()) {
    const all = messagesFixture as InboxListMessage[];
    const filtered = all.filter((m) => {
      // qに含まれるキーワードで簡易マッチ
      const keywords = q.toLowerCase().split(/\s+/);
      return keywords.some((kw) => {
        if (kw.includes("older_than")) {
          // older_than:1d の場合は、receivedAtが1日以上前のものを返す
          // older_than:2d の場合は、receivedAtが2日以上前のものを返す
          let daysAgo = 1;
          if (kw.includes("2d")) {
            daysAgo = 2;
          }
          const threshold = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
          if (m.receivedAt) {
            try {
              const received = new Date(m.receivedAt);
              return received.getTime() < threshold;
            } catch {
              return false;
            }
          }
          return false;
        }
        if (kw.includes("label:")) {
          // label検索は簡易スキップ（テストでは全件返す）
          // ただし、Waitingラベルの場合は、Test Modeの状態を確認
          if (kw.includes("waiting")) {
            // Test Modeでは、getTestMessageStatus()でWaiting状態を確認
            // ここでは簡易的に、subjectに"Waiting"が含まれるか、idがmsg-030の場合はWaiting扱い
            return m.id === "msg-030" || m.subject?.toLowerCase().includes("waiting");
          }
          return true;
        }
        if (kw.startsWith("-label:")) {
          // 除外ラベル（-label:"MailHub/Waiting"等）の場合は、該当しないものを返す
          if (kw.includes("waiting")) {
            // Waitingラベルが付いていないもの（msg-030以外）
            return m.id !== "msg-030" && !m.subject?.toLowerCase().includes("waiting");
          }
          return true;
        }
        return (
          m.subject?.toLowerCase().includes(kw) ||
          m.from?.toLowerCase().includes(kw)
        );
      });
    });
    return {
      messages: filtered.slice(0, maxTotal),
      truncated: false, // テストモードではtruncatedなし
    };
  }

  // 本番: Gmail APIでページング取得
  const sharedInboxEmail = mustGetEnv("GOOGLE_SHARED_INBOX_EMAIL");
  const refreshToken = mustGetEnv("GOOGLE_SHARED_INBOX_REFRESH_TOKEN");
  const clientId = mustGetEnv("GOOGLE_CLIENT_ID");
  const clientSecret = mustGetEnv("GOOGLE_CLIENT_SECRET");

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const results: InboxListMessage[] = [];
  let pageToken: string | undefined;
  let pageCount = 0;
  let truncated = false;

  while (pageCount < maxPages && results.length < maxTotal) {
    const listRes = await gmail.users.messages.list({
      userId: sharedInboxEmail,
      q,
      maxResults: 500,
      pageToken,
    });

    const messages = listRes.data.messages || [];
    if (messages.length === 0) {
      break;
    }

    // メッセージ詳細を取得（5並列）
    const messageDetails = await Promise.all(
      messages.slice(0, Math.min(100, maxTotal - results.length)).map(async (msg) => {
        try {
          const detailRes = await gmail.users.messages.get({
            userId: sharedInboxEmail,
            id: msg.id!,
            format: "metadata",
            metadataHeaders: ["Subject", "From", "Date", "Message-ID"],
          });

          const headers = detailRes.data.payload?.headers || [];
          const subject = headers.find((h) => h.name === "Subject")?.value || null;
          const from = headers.find((h) => h.name === "From")?.value || null;
          const internalDate = detailRes.data.internalDate
            ? parseInt(detailRes.data.internalDate, 10)
            : Date.now();

          const messageId = headers.find((h) => h.name === "Message-ID")?.value || null;
          const threadId = detailRes.data.threadId || "";
          
          const result: InboxListMessage = {
            id: msg.id!,
            threadId,
            messageId,
            subject,
            from,
            receivedAt: new Date(internalDate).toLocaleString("ja-JP", {
              timeZone: "Asia/Tokyo",
            }),
            snippet: detailRes.data.snippet || "",
            gmailLink: buildGmailLink(sharedInboxEmail, messageId, threadId),
            assigneeSlug: null,
          };
          return result;
        } catch {
          return null;
        }
      })
    );

    const validMessages = messageDetails.filter((m): m is InboxListMessage => m !== null && m !== undefined);
    results.push(...validMessages);

    pageToken = listRes.data.nextPageToken || undefined;
    
    // 上限到達チェック
    if (pageToken && (pageCount + 1 >= maxPages || results.length >= maxTotal)) {
      truncated = true;
      break;
    }
    
    if (!pageToken) {
      break;
    }
    pageCount++;
  }

  // 古い順にソート（internalDate基準）
  results.sort((a, b) => {
    try {
      const dateA = new Date(a.receivedAt).getTime();
      const dateB = new Date(b.receivedAt).getTime();
      return dateA - dateB;
    } catch {
      return 0;
    }
  });

  return {
    messages: results.slice(0, maxTotal),
    truncated,
  };
}
