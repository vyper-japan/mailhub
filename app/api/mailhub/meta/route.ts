import "server-only";

import { join } from "path";
import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { isReadOnlyMode } from "@/lib/read-only";
import { createConfigStore, type ConfigStore, type ConfigStoreType } from "@/lib/configStore";

type MessageMeta = {
  tags: string[]; // work tags（slug）
  updatedAt: string; // ISO
  updatedBy: string; // email
};

type MessageMetas = Record<string, MessageMeta>; // messageId -> meta

const FILE_PATH = join(process.cwd(), ".mailhub", "messageMeta.json");
const MAX_TAGS_PER_MESSAGE = 20;
const MAX_TAG_LENGTH = 32;

function normalizeTagSlug(raw: string): string {
  // 安全なslugに正規化（Gmailは汚さないのでMailHub内規約）
  const s = raw.trim().toLowerCase();
  if (!s) return "";
  const replaced = s
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return replaced.slice(0, MAX_TAG_LENGTH);
}

function parseMetas(raw: string): MessageMetas {
  const s = raw.trim();
  if (!s) return {};
  try {
    const parsed = JSON.parse(s) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const result: MessageMetas = {};
    for (const [messageId, metaRaw] of Object.entries(parsed)) {
      if (typeof messageId !== "string" || !messageId.trim()) continue;
      const meta = metaRaw && typeof metaRaw === "object" ? (metaRaw as Record<string, unknown>) : {};
      const tagsRaw = Array.isArray(meta.tags) ? meta.tags : [];
      const tags = Array.from(
        new Set(
          tagsRaw
            .filter((t): t is string => typeof t === "string")
            .map(normalizeTagSlug)
            .filter(Boolean),
        ),
      ).slice(0, MAX_TAGS_PER_MESSAGE);
      const updatedAt = typeof meta.updatedAt === "string" ? meta.updatedAt : new Date().toISOString();
      const updatedBy = typeof meta.updatedBy === "string" ? meta.updatedBy : "";
      if (tags.length > 0 && updatedBy) {
        result[messageId] = { tags, updatedAt, updatedBy };
      }
    }
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`config_json_corrupt_meta:${message}`);
  }
}

function serializeMetas(data: MessageMetas): string {
  return JSON.stringify(data, null, 2);
}

function buildConfigStore(forceType?: ConfigStoreType): ConfigStore<MessageMetas> {
  return createConfigStore<MessageMetas>({
    key: "__mailhub_config_meta",
    empty: {},
    forceType,
    file: {
      primaryPath: FILE_PATH,
      parse: parseMetas,
      serialize: serializeMetas,
    },
    sheets: {
      sheetName: "ConfigMeta",
      sheetNameEnv: "MAILHUB_SHEETS_TAB_META",
      mode: "json_blob",
      toJson: (metas) => JSON.stringify(metas),
      fromJson: (json) => parseMetas(json),
    },
  });
}

class Store {
  constructor(private cfg: ConfigStore<MessageMetas>) {}

  async list(): Promise<MessageMetas> {
    const { data } = await this.cfg.read();
    return { ...data };
  }

  async get(messageId: string): Promise<MessageMeta | null> {
    const metas = await this.list();
    return metas[messageId] ?? null;
  }

  private async writeAll(metas: MessageMetas): Promise<void> {
    await this.cfg.write(metas);
  }

  async setTags(messageId: string, tags: string[], updatedBy: string): Promise<MessageMeta | null> {
    const normalized = Array.from(new Set(tags.map(normalizeTagSlug).filter(Boolean))).slice(0, MAX_TAGS_PER_MESSAGE);
    if (normalized.length === 0) {
      await this.delete(messageId);
      return null;
    }
    const cur = await this.list();
    const next: MessageMetas = {
      ...cur,
      [messageId]: {
        tags: normalized,
        updatedAt: new Date().toISOString(),
        updatedBy,
      },
    };
    await this.writeAll(next);
    return next[messageId];
  }

  async delete(messageId: string): Promise<void> {
    const cur = await this.list();
    if (!(messageId in cur)) return;
    const next = { ...cur };
    delete next[messageId];
    await this.writeAll(next);
  }
}

let _instance: Store | null = null;
function getStore(): Store {
  if (_instance) return _instance;
  _instance = new Store(buildConfigStore());
  return _instance;
}

/**
 * Work Tags / Message Meta API
 * GET /api/mailhub/meta?messageId=... → meta
 * GET /api/mailhub/meta?list=1 → 全件（表示用）
 * GET /api/mailhub/meta?hasTag=1 → ids
 * GET /api/mailhub/meta?tag=<slug> → ids
 * PUT /api/mailhub/meta { messageId, tags: string[] }
 */
export async function GET(req: Request) {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);

  try {
    const url = new URL(req.url);
    const messageId = url.searchParams.get("messageId");
    const list = url.searchParams.get("list") === "1";
    const hasTag = url.searchParams.get("hasTag") === "1";
    const tag = normalizeTagSlug(url.searchParams.get("tag") ?? "");

    const store = getStore();

    if (messageId) {
      const meta = await store.get(messageId);
      return NextResponse.json({ meta }, { headers: { "cache-control": "no-store" } });
    }

    if (list) {
      const metas = await store.list();
      const items = Object.entries(metas).map(([id, meta]) => ({ messageId: id, tags: meta.tags }));
      return NextResponse.json({ items }, { headers: { "cache-control": "no-store" } });
    }

    if (hasTag) {
      const metas = await store.list();
      const ids = Object.entries(metas)
        .filter(([, meta]) => Array.isArray(meta.tags) && meta.tags.length > 0)
        .map(([id]) => id);
      return NextResponse.json({ ids }, { headers: { "cache-control": "no-store" } });
    }

    if (tag) {
      const metas = await store.list();
      const ids = Object.entries(metas)
        .filter(([, meta]) => Array.isArray(meta.tags) && meta.tags.includes(tag))
        .map(([id]) => id);
      return NextResponse.json({ ids }, { headers: { "cache-control": "no-store" } });
    }

    return NextResponse.json({ error: "missing_messageId_or_query" }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "meta_get_failed", message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);

  if (isReadOnlyMode()) {
    return NextResponse.json({ error: "read_only" }, { status: 403 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { messageId?: string; tags?: unknown };
    const messageId = typeof body.messageId === "string" ? body.messageId : "";
    const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : [];
    if (!messageId) return NextResponse.json({ error: "missing_messageId" }, { status: 400 });

    const store = getStore();
    const meta = await store.setTags(messageId, tags, authResult.user.email);
    return NextResponse.json({ meta }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "meta_put_failed", message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);

  if (isReadOnlyMode()) {
    return NextResponse.json({ error: "read_only" }, { status: 403 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { messageId?: string };
    const messageId = typeof body.messageId === "string" ? body.messageId : "";
    if (!messageId) return NextResponse.json({ error: "missing_messageId" }, { status: 400 });
    const store = getStore();
    await store.delete(messageId);
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "meta_delete_failed", message }, { status: 500 });
  }
}

