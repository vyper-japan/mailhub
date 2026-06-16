import { getMessageAttachment } from "@/lib/gmail";
import { parseGmailError } from "@/lib/gmail-error";
import { authErrorResponse, requireUser } from "@/lib/require-user";

export const dynamic = "force-dynamic";

function safeFilename(filename: string): string {
  const cleaned = filename.replace(/[\r\n"]/g, "_").trim();
  return cleaned || "attachment";
}

function asciiFallbackFilename(filename: string): string {
  const safe = safeFilename(filename);
  const extensionMatch = safe.match(/\.[A-Za-z0-9]{1,8}$/);
  return `attachment${extensionMatch?.[0] ?? ""}`;
}

function contentDisposition(type: "inline" | "attachment", filename: string): string {
  const safe = safeFilename(filename);
  const encoded = encodeURIComponent(safe).replace(/['()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${asciiFallbackFilename(safe)}"; filename*=UTF-8''${encoded}`;
}

function normalizeMimeType(mimeType: string | null): string {
  return (mimeType || "application/octet-stream").split(";")[0].trim().toLowerCase() || "application/octet-stream";
}

function safeDisposition(requested: "inline" | "attachment", mimeType: string | null): "inline" | "attachment" {
  if (requested === "attachment") return "attachment";
  const lower = normalizeMimeType(mimeType);
  if (
    lower === "application/pdf" ||
    lower === "text/plain" ||
    lower === "image/png" ||
    lower === "image/jpeg" ||
    lower === "image/gif" ||
    lower === "image/webp"
  ) {
    return "inline";
  }
  return "attachment";
}

export async function GET(req: Request) {
  const authResult = await requireUser();
  if (!authResult.ok) {
    return authErrorResponse(authResult);
  }

  const url = new URL(req.url);
  const messageId = url.searchParams.get("messageId");
  const attachmentId = url.searchParams.get("attachmentId");
  const disposition = url.searchParams.get("disposition") === "inline" ? "inline" : "attachment";

  if (!messageId || !attachmentId) {
    return Response.json({ error: "missing_attachment_params" }, { status: 400 });
  }

  try {
    const attachment = await getMessageAttachment({ messageId, attachmentId });
    const contentType = normalizeMimeType(attachment.mimeType);
    const responseDisposition = safeDisposition(disposition, attachment.mimeType);
    return new Response(new Uint8Array(attachment.data), {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": contentDisposition(responseDisposition, attachment.filename),
        "content-length": String(attachment.data.byteLength),
        "content-security-policy": "sandbox",
        "content-type": contentType,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    console.error(
      `[Attachment API Error] messageId=${messageId}, attachmentId=${attachmentId}, user=${authResult.user.email}`,
      e,
    );
    const errorInfo = parseGmailError(e);
    return Response.json(
      {
        error: "gmail_attachment_error",
        error_code: errorInfo.error_code,
        message: errorInfo.message,
        debug: process.env.NODE_ENV === "development" ? errorInfo.debug : undefined,
      },
      { status: errorInfo.httpStatus, headers: { "cache-control": "no-store" } },
    );
  }
}
