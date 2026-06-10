import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { setTestReadOnlyMode } from "@/lib/read-only";
import { getAssigneeRegistryStore, resetAssigneeRegistryStore } from "@/lib/assigneeRegistryStore";

const routeMocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
}));

vi.mock("@/lib/require-user", () => ({
  requireUser: routeMocks.requireUser,
  authErrorResponse: (result: { status: 401 | 403; message: string }) =>
    Response.json(
      { error: result.status === 401 ? "unauthorized" : "forbidden", message: result.message },
      { status: result.status },
    ),
}));

async function importPost() {
  vi.resetModules();
  const mod = await import("@/app/api/mailhub/assignees/route");
  return mod.POST;
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/mailhub/assignees", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function clearAssigneesMemory(): void {
  delete (globalThis as unknown as Record<string, unknown>).__mailhub_config_assignees;
  resetAssigneeRegistryStore();
}

describe("assignees route POST read-only guard", () => {
  beforeEach(async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("MAILHUB_TEST_MODE", "1");
    vi.stubEnv("MAILHUB_READ_ONLY", "0");
    routeMocks.requireUser.mockReset().mockResolvedValue({
      ok: true,
      user: { email: "test@vtj.co.jp", name: "Test" },
    });
    setTestReadOnlyMode(null);
    clearAssigneesMemory();
    await getAssigneeRegistryStore("memory").clear();
  });

  afterEach(async () => {
    setTestReadOnlyMode(null);
    await getAssigneeRegistryStore("memory").clear();
    clearAssigneesMemory();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns 403 read_only with no-store and does not replace assignees", async () => {
    await getAssigneeRegistryStore("memory").replaceAll([
      { email: "existing@vtj.co.jp", displayName: "Existing" },
    ]);
    setTestReadOnlyMode(true);

    const POST = await importPost();
    const res = await POST(makeRequest({
      assignees: [{ email: "blocked@vtj.co.jp", displayName: "Blocked" }],
    }));

    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await readJson(res)).toMatchObject({
      error: "read_only",
      reason: "assignees_write",
    });
    await expect(getAssigneeRegistryStore("memory").list()).resolves.toEqual([
      { email: "existing@vtj.co.jp", displayName: "Existing" },
    ]);
  });

  it("replaces assignees when read-only override is false", async () => {
    setTestReadOnlyMode(false);

    const POST = await importPost();
    const res = await POST(makeRequest({
      assignees: [{ email: "maki@vtj.co.jp", displayName: "Maki" }],
    }));

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await readJson(res)).toMatchObject({
      success: true,
      assignees: [{ email: "maki@vtj.co.jp", displayName: "Maki" }],
    });
    await expect(getAssigneeRegistryStore("memory").list()).resolves.toEqual([
      { email: "maki@vtj.co.jp", displayName: "Maki" },
    ]);
  });
});
