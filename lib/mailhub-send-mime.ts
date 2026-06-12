import { createRequire } from "node:module";

export type BuildReplyMimeInput = {
  fromAlias: string;
  fromDisplayName: string;
  to: string;
  originalSubject: string | null;
  bodyText: string;
  threadId: string;
  originalMessageId: string;
  originalReferences: string[];
  date?: Date;
};

export type BuildReplyMimeOutput = {
  subject: string;
  threadId: string;
  rfc822: string;
  raw: string;
  headers: {
    from: string;
    to: string;
    subject: string;
    inReplyTo: string;
    references: string;
    mimeVersion: "1.0";
    contentType: "text/plain; charset=utf-8";
    contentTransferEncoding: "base64";
  };
};

type MailAddress = { name?: string; address: string };
type MailComposerOptions = {
  from: MailAddress;
  to: string;
  subject: string;
  text: string;
  textEncoding: "base64";
  encoding: "base64";
  date?: Date;
  headers: Record<string, string>;
};
type MailComposerInstance = {
  compile(): {
    build(): Promise<Buffer>;
  };
};
type MailComposerConstructor = new (options: MailComposerOptions) => MailComposerInstance;

const require = createRequire(import.meta.url);
const MailComposer = require("nodemailer/lib/mail-composer") as MailComposerConstructor;

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function normalizeBodyText(bodyText: string): string {
  return bodyText.replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n");
}

function buildFromHeader(displayName: string, alias: string): { name?: string; address: string } {
  const name = displayName.trim();
  return name ? { name, address: alias } : { address: alias };
}

export async function buildReplyMime(
  input: BuildReplyMimeInput,
): Promise<BuildReplyMimeOutput> {
  const base = input.originalSubject?.trim() || "(no subject)";
  const subject = /^\s*re\s*:/i.test(base) ? base : `Re: ${base}`;
  const references = dedupePreserveOrder([
    ...input.originalReferences,
    input.originalMessageId,
  ]).join(" ");

  const composer = new MailComposer({
    from: buildFromHeader(input.fromDisplayName, input.fromAlias),
    to: input.to,
    subject,
    text: normalizeBodyText(input.bodyText),
    textEncoding: "base64",
    encoding: "base64",
    date: input.date,
    headers: {
      "In-Reply-To": input.originalMessageId,
      References: references,
    },
  });

  const rfc822 = (await composer.compile().build()).toString("utf8");

  return {
    subject,
    threadId: input.threadId,
    rfc822,
    raw: Buffer.from(rfc822, "utf8").toString("base64url"),
    headers: {
      from: rfc822.match(/^From: (.+)$/im)?.[1] ?? "",
      to: rfc822.match(/^To: (.+)$/im)?.[1] ?? "",
      subject: rfc822.match(/^Subject: (.+)$/im)?.[1] ?? "",
      inReplyTo: input.originalMessageId,
      references,
      mimeVersion: "1.0",
      contentType: "text/plain; charset=utf-8",
      contentTransferEncoding: "base64",
    },
  };
}
