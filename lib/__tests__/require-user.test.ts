import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  auth: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({
  auth: authMock.auth,
}));

async function importRequireUser() {
  vi.resetModules();
  return import("@/lib/require-user");
}

describe("requireUser", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.MAILHUB_TEST_MODE = "0";
    process.env.MAILHUB_ADMINS = "";
    process.env.MAILHUB_TEAM_MEMBERS = "";
    authMock.auth.mockReset();
  });

  it("returns a deterministic test user in test mode", async () => {
    process.env.MAILHUB_TEST_MODE = "1";
    authMock.auth.mockResolvedValue(null);
    const { requireUser } = await importRequireUser();

    await expect(requireUser()).resolves.toEqual({
      ok: true,
      user: { email: "test@vtj.co.jp", name: "Test" },
    });
    expect(authMock.auth).not.toHaveBeenCalled();
  });

  it("keeps the vtj domain check before staff allowlist checks", async () => {
    authMock.auth.mockResolvedValue({ user: { email: "user@example.com", name: "User" } });
    const { requireUser } = await importRequireUser();

    await expect(requireUser()).resolves.toEqual({
      ok: false,
      status: 403,
      message: "Forbidden: Only vtj.co.jp users are allowed",
    });
  });

  it("allows configured staff and blocks unlisted vtj users", async () => {
    process.env.MAILHUB_ADMINS = "admin@vtj.co.jp";
    process.env.MAILHUB_TEAM_MEMBERS = "Staff <staff@vtj.co.jp>";
    const { requireUser } = await importRequireUser();

    authMock.auth.mockResolvedValueOnce({ user: { email: "Staff@VTJ.CO.JP", name: "Staff" } });
    await expect(requireUser()).resolves.toEqual({
      ok: true,
      user: { email: "Staff@VTJ.CO.JP", name: "Staff" },
    });

    authMock.auth.mockResolvedValueOnce({ user: { email: "other@vtj.co.jp", name: "Other" } });
    await expect(requireUser()).resolves.toEqual({
      ok: false,
      status: 403,
      message: "Forbidden: MailHub access is limited to configured staff members",
    });
  });
});
