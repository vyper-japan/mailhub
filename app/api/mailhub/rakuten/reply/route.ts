import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { logAction } from "@/lib/audit-log";
import { isReadOnlyMode, writeForbiddenResponse } from "@/lib/read-only";
import { getRmsEnvPrefix } from "@/lib/channels";
import { isTestMode } from "@/lib/test-mode";

type RakutenReplyRequest = {
  storeId: string;
  inquiryNumber: string;
  message: string;
  emailId?: string; // 元メールのID（ログ用）
};

/**
 * 楽天RMS返信API
 * POST /api/mailhub/rakuten/reply
 */
export async function POST(req: NextRequest) {
  const authResult = await requireUser();
  if (!authResult.ok) {
    return NextResponse.json(
      { ok: false, error: authResult.message },
      { status: authResult.status },
    );
  }
  if (isReadOnlyMode()) return writeForbiddenResponse("rakuten_reply");

  const user = authResult.user;

  try {
    const body: RakutenReplyRequest = await req.json();
    const { storeId, inquiryNumber, message, emailId } = body;
    const testMode = isTestMode();

    if (!storeId || !inquiryNumber || !message) {
      return NextResponse.json(
        { ok: false, error: "storeId, inquiryNumber, message are required" },
        { status: 400 },
      );
    }

    // テストモードの場合は成功を返すだけ
    if (testMode) {
      console.log(
        `[TEST MODE] Rakuten RMS Reply: storeId=${storeId}, inquiryNumber=${inquiryNumber}, message=${message.substring(0, 50)}...`,
      );
      logAction({
        actorEmail: user.email,
        action: "rakutenReply",
        messageId: emailId || "unknown",
        metadata: {
          storeId,
          inquiryNumber,
        },
      }).catch(() => {
        // ログ失敗は無視
      });
      return NextResponse.json({ ok: true });
    }

    // 環境変数からRMS APIキーを取得
    const rmsEnvPrefix = getRmsEnvPrefix(storeId, testMode);
    const shopId = rmsEnvPrefix ? process.env[`${rmsEnvPrefix}_SHOP_ID`] : undefined;
    const serviceSecret = rmsEnvPrefix ? process.env[`${rmsEnvPrefix}_SERVICE_SECRET`] : undefined;
    const licenseKey = rmsEnvPrefix ? process.env[`${rmsEnvPrefix}_LICENSE_KEY`] : undefined;

    if (!shopId || !serviceSecret || !licenseKey) {
      return NextResponse.json(
        {
          ok: false,
          error: `RMS API credentials not configured for ${storeId}`,
          fallback: true, // フォールバック可能であることを示す
        },
        { status: 400 },
      );
    }

    // TODO: 実際のRMS API呼び出しを実装
    // 現時点では、APIキーが設定されている場合でも「未実装」として返す
    // （RMS APIの詳細仕様が確定次第、実装を追加）

    // ログ出力
    logAction({
      actorEmail: user.email,
      action: "rakutenReply",
      messageId: emailId || "unknown",
      metadata: {
        storeId,
        inquiryNumber,
        messageLength: message.length,
      },
    }).catch(() => {
      // ログ失敗は無視
    });

    // 暫定: APIキーがあるが実装が未完了の場合
    return NextResponse.json({
      ok: false,
      error: "RMS API implementation pending",
      fallback: true,
    });
  } catch (e) {
    console.error("[Rakuten Reply API Error]", e);
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
