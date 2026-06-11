import { describe, expect, it, vi, beforeEach } from "vitest";
import type { RegisteredLabel } from "@/lib/labelRegistryStore";
import type { LabelRule } from "@/lib/labelRules";
import {
  buildPreviewToken,
  computeImportPreview,
} from "@/lib/config-import-preview";

const routeState = vi.hoisted(() => ({
  sourceLabels: [] as RegisteredLabel[],
  targetLabels: [] as RegisteredLabel[],
  sourceRules: [] as LabelRule[],
  targetRules: [] as LabelRule[],
  sourceAssignees: [] as Array<{ email: string; displayName?: string }>,
  targetAssignees: [] as Array<{ email: string; displayName?: string }>,
  overwriteAssigneesForImport: vi.fn(),
  overwriteLabelsForImport: vi.fn(),
  overwriteRulesForImport: vi.fn(),
  logAction: vi.fn(),
  requireUser: vi.fn(),
  isAdminEmail: vi.fn(),
  isReadOnlyMode: vi.fn(),
  writeForbiddenResponse: vi.fn(),
  storeType: "sheets",
  isTestMode: vi.fn(),
}));

vi.mock("@/lib/require-user", () => ({
  requireUser: routeState.requireUser,
  authErrorResponse: (result: { status: number; message: string }) =>
    Response.json({ error: "unauthorized", message: result.message }, { status: result.status }),
}));

vi.mock("@/lib/admin", () => ({
  isAdminEmail: routeState.isAdminEmail,
}));

vi.mock("@/lib/configStore", () => ({
  getResolvedConfigStoreType: () => routeState.storeType,
}));

vi.mock("@/lib/read-only", () => ({
  isReadOnlyMode: routeState.isReadOnlyMode,
  writeForbiddenResponse: routeState.writeForbiddenResponse,
}));

vi.mock("@/lib/test-mode", () => ({
  isTestMode: routeState.isTestMode,
}));

vi.mock("@/lib/audit-log", () => ({
  logAction: routeState.logAction,
}));

vi.mock("@/lib/labelRegistryStore", () => ({
  getLabelRegistryFileStoreForImport: () => ({ list: async () => routeState.sourceLabels }),
  getLabelRegistryStore: () => ({ list: async () => routeState.targetLabels }),
  overwriteRegisteredLabelsForImport: routeState.overwriteLabelsForImport,
}));

vi.mock("@/lib/labelRulesStore", () => ({
  getLabelRulesFileStoreForImport: () => ({ getRules: async () => routeState.sourceRules }),
  getLabelRulesStore: () => ({ getRules: async () => routeState.targetRules }),
  overwriteLabelRulesForImport: routeState.overwriteRulesForImport,
}));

vi.mock("@/lib/assigneeRegistryStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assigneeRegistryStore")>();
  return {
    ...actual,
    getAssigneeRegistryFileStoreForImport: () => ({ list: async () => routeState.sourceAssignees }),
    getAssigneeRegistryStore: () => ({ list: async () => routeState.targetAssignees }),
    overwriteAssigneesForImport: routeState.overwriteAssigneesForImport,
  };
});

function label(labelName: string, displayName = labelName): RegisteredLabel {
  return { labelName, displayName, createdAt: "2026-01-01T00:00:00.000Z" };
}

function rule(id: string, labelNames = ["MailHub/Label/VIP"]): LabelRule {
  return {
    id,
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    match: { fromEmail: `${id}@example.com` },
    labelNames,
  };
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/mailhub/config/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("config import preview", () => {
  it("computes assignee add/update/skip buckets with normalized email keys", () => {
    const preview = computeImportPreview({
      sourceLabels: [],
      targetLabels: [],
      sourceRules: [],
      targetRules: [],
      sourceAssignees: [
        { email: " ADD@VTJ.CO.JP ", displayName: " Add " },
        { email: "update@vtj.co.jp", displayName: "After" },
        { email: "skip@vtj.co.jp", displayName: "Same" },
      ],
      targetAssignees: [
        { email: "update@vtj.co.jp", displayName: "Before" },
        { email: "skip@vtj.co.jp", displayName: "Same" },
      ],
    });

    expect(preview.assignees).toMatchObject({
      sourceCount: 3,
      targetCount: 2,
      willAdd: 1,
      willUpdate: 1,
      willSkip: 1,
      add: [{ email: "add@vtj.co.jp", afterDisplayName: "Add" }],
      update: [{ email: "update@vtj.co.jp", beforeDisplayName: "Before", afterDisplayName: "After" }],
      skip: [{ email: "skip@vtj.co.jp", afterDisplayName: "Same" }],
    });
  });

  it("includes assignee changes in totalChanges and keeps the threshold at 50", () => {
    const sourceLabels = Array.from({ length: 49 }, (_, i) => label(`MailHub/Label/${i}`));
    const preview = computeImportPreview({
      sourceLabels,
      targetLabels: [],
      sourceRules: [],
      targetRules: [],
      sourceAssignees: [{ email: "one@vtj.co.jp" }],
      targetAssignees: [],
    });

    expect(preview.requiresConfirm).toBe(true);
    expect(preview.warnings[0]).toMatchObject({ totalChanges: 50, threshold: 50 });
  });

  it("changes previewToken when assignee diff changes", () => {
    const base = computeImportPreview({
      sourceLabels: [],
      targetLabels: [],
      sourceRules: [],
      targetRules: [],
      sourceAssignees: [{ email: "one@vtj.co.jp", displayName: "One" }],
      targetAssignees: [],
    });
    const changed = computeImportPreview({
      sourceLabels: [],
      targetLabels: [],
      sourceRules: [],
      targetRules: [],
      sourceAssignees: [{ email: "one@vtj.co.jp", displayName: "Changed" }],
      targetAssignees: [],
    });

    expect(buildPreviewToken(base)).not.toBe(buildPreviewToken(changed));
  });

  it("keeps labels and rules behavior equivalent when source assignees are empty", () => {
    const preview = computeImportPreview({
      sourceLabels: [label("MailHub/Label/VIP", "VIP")],
      targetLabels: [],
      sourceRules: [rule("r-1")],
      targetRules: [],
      sourceAssignees: [],
      targetAssignees: [{ email: "target-only@example.com" }],
    });

    expect(preview.labels.willAdd).toBe(1);
    expect(preview.rules.willAdd).toBe(1);
    expect(preview.assignees).toMatchObject({
      sourceCount: 0,
      willAdd: 0,
      willUpdate: 0,
      willSkip: 0,
    });
  });

  it("computes label and rule add/update/skip buckets and normalizes legacy labelName rules", () => {
    const preview = computeImportPreview({
      sourceLabels: [
        label("MailHub/Label/Add", "Add"),
        label("MailHub/Label/Update", "After"),
        label("MailHub/Label/Skip", "Same"),
      ],
      targetLabels: [
        label("MailHub/Label/Update", "Before"),
        label("MailHub/Label/Skip", "Same"),
      ],
      sourceRules: [
        rule("rule-add"),
        { ...rule("rule-update"), enabled: false },
        { ...rule("rule-skip"), labelNames: undefined, labelName: "MailHub/Label/Legacy" },
      ],
      targetRules: [
        rule("rule-update"),
        { ...rule("rule-skip"), labelNames: ["MailHub/Label/Legacy"] },
      ],
      sourceAssignees: [],
      targetAssignees: [],
    });

    expect(preview.labels).toMatchObject({
      sourceCount: 3,
      targetCount: 2,
      willAdd: 1,
      willUpdate: 1,
      willSkip: 1,
      add: [{ labelName: "MailHub/Label/Add", afterDisplayName: "Add" }],
      update: [
        {
          labelName: "MailHub/Label/Update",
          beforeDisplayName: "Before",
          afterDisplayName: "After",
        },
      ],
      skip: [{ labelName: "MailHub/Label/Skip", afterDisplayName: "Same" }],
    });
    expect(preview.rules).toMatchObject({
      sourceCount: 3,
      targetCount: 2,
      willAdd: 1,
      willUpdate: 1,
      willSkip: 1,
      add: [{ id: "rule-add" }],
      update: [{ id: "rule-update" }],
      skip: [{ id: "rule-skip" }],
    });
  });

  it("puts a rule in update when only assignTo differs", () => {
    const preview = computeImportPreview({
      sourceLabels: [],
      targetLabels: [],
      sourceRules: [{ ...rule("rule-assign"), assignTo: "me" }],
      targetRules: [rule("rule-assign")],
      sourceAssignees: [],
      targetAssignees: [],
    });

    expect(preview.rules).toMatchObject({
      willAdd: 0,
      willUpdate: 1,
      willSkip: 0,
      update: [{ id: "rule-assign" }],
    });
  });

  it("skips a rule when assignTo is canonically identical", () => {
    const preview = computeImportPreview({
      sourceLabels: [],
      targetLabels: [],
      sourceRules: [{ ...rule("rule-same-assign"), assignTo: { assigneeEmail: "owner@vtj.co.jp" } }],
      targetRules: [{ ...rule("rule-same-assign"), assignTo: { assigneeEmail: "owner@vtj.co.jp" } }],
      sourceAssignees: [],
      targetAssignees: [],
    });

    expect(preview.rules).toMatchObject({
      willAdd: 0,
      willUpdate: 0,
      willSkip: 1,
      skip: [{ id: "rule-same-assign" }],
    });
  });

  it("changes previewToken and totalChanges when assignTo diff changes", () => {
    const base = computeImportPreview({
      sourceLabels: [],
      targetLabels: [],
      sourceRules: [rule("rule-token")],
      targetRules: [{ ...rule("rule-token"), assignTo: null } as unknown as LabelRule],
      sourceAssignees: [],
      targetAssignees: [],
    });
    const changed = computeImportPreview({
      sourceLabels: [],
      targetLabels: [],
      sourceRules: [{ ...rule("rule-token"), assignTo: "me" }],
      targetRules: [{ ...rule("rule-token"), assignTo: null } as unknown as LabelRule],
      sourceAssignees: [],
      targetAssignees: [],
    });

    expect(base.rules.willSkip).toBe(1);
    expect(base.rules.willUpdate).toBe(0);
    expect(changed.rules.willSkip).toBe(0);
    expect(changed.rules.willUpdate).toBe(1);
    expect(changed.rules.willAdd + changed.rules.willUpdate).toBe(
      base.rules.willAdd + base.rules.willUpdate + 1,
    );
    expect(buildPreviewToken(base)).not.toBe(buildPreviewToken(changed));
  });

  it("returns empty buckets and no warning when every source bucket is empty", () => {
    const preview = computeImportPreview({
      sourceLabels: [],
      targetLabels: [label("MailHub/Label/TargetOnly")],
      sourceRules: [],
      targetRules: [rule("target-only")],
      sourceAssignees: [],
      targetAssignees: [{ email: "target@vtj.co.jp", displayName: "Target" }],
    });

    expect(preview.labels).toMatchObject({ willAdd: 0, willUpdate: 0, willSkip: 0, add: [], update: [], skip: [] });
    expect(preview.rules).toMatchObject({ willAdd: 0, willUpdate: 0, willSkip: 0, add: [], update: [], skip: [] });
    expect(preview.assignees).toMatchObject({ willAdd: 0, willUpdate: 0, willSkip: 0, add: [], update: [], skip: [] });
    expect(preview.warnings).toEqual([]);
    expect(preview.requiresConfirm).toBe(false);
  });

  it("requires confirmation when total changes exceed the danger threshold", () => {
    const sourceLabels = Array.from({ length: 51 }, (_, i) => label(`MailHub/Label/Danger${i}`));

    const preview = computeImportPreview({
      sourceLabels,
      targetLabels: [],
      sourceRules: [],
      targetRules: [],
      sourceAssignees: [],
      targetAssignees: [],
    });

    expect(preview.requiresConfirm).toBe(true);
    expect(preview.warnings).toEqual([
      expect.objectContaining({ level: "danger", totalChanges: 51, threshold: 50 }),
    ]);
  });
});

describe("POST /api/mailhub/config/import assignee validation", () => {
  beforeEach(() => {
    vi.resetModules();
    routeState.sourceLabels = [];
    routeState.targetLabels = [];
    routeState.sourceRules = [];
    routeState.targetRules = [];
    routeState.sourceAssignees = [];
    routeState.targetAssignees = [];
    routeState.storeType = "sheets";
    routeState.overwriteAssigneesForImport.mockReset();
    routeState.overwriteLabelsForImport.mockReset();
    routeState.overwriteRulesForImport.mockReset();
    routeState.logAction.mockReset();
    routeState.isAdminEmail.mockReset().mockReturnValue(true);
    routeState.isReadOnlyMode.mockReset().mockReturnValue(false);
    routeState.writeForbiddenResponse.mockReset().mockImplementation((reason: string) =>
      Response.json({ error: "read_only", reason }, { status: 403 }),
    );
    routeState.isTestMode.mockReset().mockReturnValue(false);
    routeState.requireUser.mockReset().mockResolvedValue({
      ok: true,
      user: { email: "admin@vtj.co.jp", name: "Admin" },
    });
  });

  it("returns 400 on dryRun when source assignee domain is invalid", async () => {
    routeState.sourceAssignees = [{ email: "bad@example.com", displayName: "Bad" }];
    const { POST } = await import("@/app/api/mailhub/config/import/route");

    const res = await POST(post({ dryRun: true }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "import_invalid_assignee_domain",
      emails: ["bad@example.com"],
    });
  });

  it("does not block labels/rules import on target-only invalid assignee rows", async () => {
    routeState.sourceLabels = [label("MailHub/Label/New", "New")];
    routeState.sourceRules = [rule("r-new")];
    routeState.targetAssignees = [{ email: "target-only@example.com", displayName: "Target Only" }];
    const { POST } = await import("@/app/api/mailhub/config/import/route");

    const previewRes = await POST(post({ dryRun: true }));
    const previewBody = (await previewRes.json()) as { previewToken: string };
    const applyRes = await POST(post({ dryRun: false, previewToken: previewBody.previewToken }));

    expect(applyRes.status).toBe(200);
    expect(routeState.overwriteLabelsForImport).toHaveBeenCalledTimes(1);
    expect(routeState.overwriteRulesForImport).toHaveBeenCalledTimes(1);
    expect(routeState.overwriteAssigneesForImport).not.toHaveBeenCalled();
  });

  it("logs dry-run preview only when requested", async () => {
    routeState.sourceLabels = [label("MailHub/Label/New", "New")];
    const { POST } = await import("@/app/api/mailhub/config/import/route");

    const silentRes = await POST(post({ dryRun: true }));
    const loggedRes = await POST(post({ dryRun: true, log: true }));

    expect(silentRes.status).toBe(200);
    expect(loggedRes.status).toBe(200);
    expect(routeState.logAction).toHaveBeenCalledTimes(1);
    expect(routeState.logAction).toHaveBeenCalledWith(expect.objectContaining({
      actorEmail: "admin@vtj.co.jp",
      action: "config_import_preview",
      messageId: "meta",
    }));
  });

  it("returns preview_required when applying without a preview token", async () => {
    routeState.sourceLabels = [label("MailHub/Label/New", "New")];
    const { POST } = await import("@/app/api/mailhub/config/import/route");

    const res = await POST(post({ dryRun: false }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "preview_required",
      previewToken: expect.any(String),
      preview: { labels: expect.objectContaining({ willAdd: 1 }) },
    });
    expect(routeState.overwriteLabelsForImport).not.toHaveBeenCalled();
  });

  it("returns preview_outdated when source config changes after preview", async () => {
    routeState.sourceLabels = [label("MailHub/Label/Before", "Before")];
    const { POST } = await import("@/app/api/mailhub/config/import/route");
    const previewRes = await POST(post({ dryRun: true }));
    const previewBody = (await previewRes.json()) as { previewToken: string };
    routeState.sourceLabels = [label("MailHub/Label/After", "After")];

    const res = await POST(post({ dryRun: false, previewToken: previewBody.previewToken }));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "preview_outdated",
      previewToken: expect.not.stringMatching(previewBody.previewToken),
    });
    expect(routeState.overwriteLabelsForImport).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation for dangerous apply previews", async () => {
    routeState.sourceLabels = Array.from({ length: 50 }, (_, i) => label(`MailHub/Label/Bulk${i}`));
    const { POST } = await import("@/app/api/mailhub/config/import/route");
    const previewRes = await POST(post({ dryRun: true }));
    const previewBody = (await previewRes.json()) as { previewToken: string };

    const res = await POST(post({ dryRun: false, previewToken: previewBody.previewToken }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "preview_confirm_required",
      preview: { requiresConfirm: true },
    });
    expect(routeState.overwriteLabelsForImport).not.toHaveBeenCalled();
  });

  it("honors guard order before reading import sources", async () => {
    const { POST } = await import("@/app/api/mailhub/config/import/route");

    routeState.requireUser.mockResolvedValueOnce({ ok: false, status: 401, message: "sign in" });
    const authRes = await POST(post({ dryRun: true }));
    expect(authRes.status).toBe(401);
    await expect(authRes.json()).resolves.toMatchObject({ error: "unauthorized", message: "sign in" });

    routeState.isAdminEmail.mockReturnValueOnce(false);
    const adminRes = await POST(post({ dryRun: true }));
    expect(adminRes.status).toBe(403);
    await expect(adminRes.json()).resolves.toEqual({ error: "forbidden_admin_only" });

    routeState.isReadOnlyMode.mockReturnValueOnce(true);
    const readOnlyRes = await POST(post({ dryRun: true }));
    expect(readOnlyRes.status).toBe(403);
    await expect(readOnlyRes.json()).resolves.toEqual({ error: "read_only", reason: "config_import" });

    routeState.storeType = "memory";
    const storeRes = await POST(post({ dryRun: true }));
    expect(storeRes.status).toBe(400);
    await expect(storeRes.json()).resolves.toEqual({ error: "import_only_for_sheets", storeType: "memory" });

    expect(routeState.overwriteLabelsForImport).not.toHaveBeenCalled();
  });
});
