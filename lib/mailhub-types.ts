export type InboxListMessage = {
  id: string;
  threadId: string;
  subject: string | null;
  from: string | null;
  messageId: string | null;
  receivedAt: string;
  snippet: string;
  gmailLink: string;
  pinned?: boolean; // テストモード用: 先頭に表示する
};

export type MessageDetail = {
  id: string;
  threadId: string;
  subject: string | null;
  from: string | null;
  messageId: string | null;
  receivedAt: string;
  snippet: string;
  gmailLink: string;
  plainTextBody: string | null;
  bodyNotice: string | null;
  isInProgress?: boolean;
};


