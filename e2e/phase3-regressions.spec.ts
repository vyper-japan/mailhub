import { expect, type Locator, type Page, test } from "@playwright/test";

async function resetAndOpen(page: Page, path = "/") {
  console.log(`progress: reset test state and open ${path}`);
  await page.request.post("/api/mailhub/test/reset", { data: { readOnly: false } }).catch(() => {});
  await page.addInitScript(() => {
    localStorage.setItem("mailhub-onboarding-shown", "true");
  });
  await page.goto(path);
  await page.waitForSelector('[data-testid="message-row"]', { timeout: 10000 });
}

async function closeInterferingOverlays(page: Page) {
  const onboardingModal = page.getByTestId("onboarding-modal");
  if (await onboardingModal.isVisible().catch(() => false)) {
    await onboardingModal.getByTestId("onboarding-start").click().catch(() => {});
  }

  const settingsDrawer = page.getByTestId("settings-drawer");
  if (await settingsDrawer.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape").catch(() => {});
    await expect(settingsDrawer).not.toBeVisible({ timeout: 5000 }).catch(() => {});
  }
}

async function selectTargetRow(
  page: Page,
  preferredId: string,
  options: { excludeIds?: string[] } = {},
): Promise<{ row: Locator; id: string }> {
  const list = page.getByTestId("message-list");
  const preferredRow = list.locator(`[data-message-id="${preferredId}"]`);
  if (!options.excludeIds?.includes(preferredId) && (await preferredRow.count()) > 0) {
    return { row: preferredRow.first(), id: preferredId };
  }

  const rows = list.getByTestId("message-row");
  await expect(rows.first()).toBeVisible({ timeout: 5000 });
  const count = await rows.count();
  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const id = await row.getAttribute("data-message-id");
    if (id && !options.excludeIds?.includes(id)) {
      return { row, id };
    }
  }
  throw new Error("no selectable fallback row found");
}

async function openMessage(page: Page, row: Locator) {
  await row.click();
  await expect(page.getByTestId("detail-subject")).toBeVisible({ timeout: 5000 });
}

async function moveSelectedToWaiting(page: Page) {
  const statusRespP = page.waitForResponse(
    (r) => r.url().includes("/api/mailhub/status") && r.request().method() === "POST" && r.status() === 200,
    { timeout: 10000 },
  );
  await page.getByTestId("action-waiting").click();
  await statusRespP;
}

async function insertFirstReplyTemplate(page: Page) {
  const templateSelectButton = page.getByTestId("reply-template-select");
  await expect(templateSelectButton).toBeVisible({ timeout: 3000 });
  await templateSelectButton.click();

  const picker = page.getByTestId("template-picker");
  await expect(picker).toBeVisible({ timeout: 3000 });
  await page
    .waitForResponse(
      (r) => r.url().includes("/api/mailhub/templates") && r.request().method() === "GET" && r.status() === 200,
      { timeout: 5000 },
    )
    .catch(() => {});

  const firstTemplate = page.getByTestId(/^reply-template-item-/).first();
  await expect(firstTemplate).toBeVisible({ timeout: 5000 });
  const templateTestId = await firstTemplate.getAttribute("data-testid");
  const templateId = templateTestId?.match(/^reply-template-item-(.+)$/)?.[1];
  if (!templateId) throw new Error("template id parse failed");

  await firstTemplate.click();
  await page.getByTestId(`reply-template-insert-${templateId}`).click();
  await expect(picker).not.toBeVisible({ timeout: 3000 });
}

test.describe("Phase 3 regressions E2E", () => {
  test("T-5: clearing search removes q even when list fetch aborts", async ({ page }) => {
    console.log("progress: T-5 start");
    await resetAndOpen(page);
    await closeInterferingOverlays(page);

    const searchInput = page.getByTestId("topbar-search");
    const searchQuery = "楽天";
    console.log("progress: T-5 submit search");
    await searchInput.fill(searchQuery);

    const searchRespP = page.waitForResponse(
      (r) =>
        r.url().includes("/api/mailhub/list") &&
        r.url().includes("q=") &&
        r.request().method() === "GET" &&
        r.status() === 200,
      // next dev のコールドコンパイル直後は初回API応答が遅いため長めに待つ
      { timeout: 15000 },
    );
    await searchInput.press("Enter");
    await searchRespP;

    await expect(page.getByTestId("search-active-chip")).toBeVisible({ timeout: 3000 });
    await expect(page.getByTestId("message-list").getByTestId("message-row").first()).toBeVisible({ timeout: 5000 });
    expect(new URL(page.url()).searchParams.get("q")).toBe(searchQuery);

    let abortedClearFetch = false;
    console.log("progress: T-5 install abort route for clear fetch");
    await page.route("**/api/mailhub/list**", async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (!abortedClearFetch && req.method() === "GET" && !url.searchParams.has("q")) {
        abortedClearFetch = true;
        await route.abort();
        return;
      }
      await route.continue();
    });

    console.log("progress: T-5 click clear");
    await page.getByTestId("search-clear").click();

    await expect
      .poll(() => abortedClearFetch, { timeout: 3000 })
      .toBe(true);
    expect(new URL(page.url()).searchParams.has("q")).toBe(false);
    await expect(searchInput).toHaveValue("");
    await expect(page.getByTestId("search-active-chip")).not.toBeVisible({ timeout: 3000 });
  });

  test("T-6: undo restores the waiting target detail panel", async ({ page }) => {
    console.log("progress: T-6 start");
    await resetAndOpen(page, "/?label=todo");
    await closeInterferingOverlays(page);
    const list = page.getByTestId("message-list");
    const rows = list.getByTestId("message-row");
    const initialCount = await rows.count();
    expect(initialCount).toBeGreaterThan(1);

    const { row, id: targetId } = await selectTargetRow(page, "msg-022");
    console.log(`progress: T-6 open target ${targetId}`);
    await openMessage(page, row);
    const targetSubject = (await page.getByTestId("detail-subject").textContent())?.trim();
    expect(targetSubject).toBeTruthy();

    console.log("progress: T-6 move target to waiting");
    await moveSelectedToWaiting(page);
    await expect(list.locator(`[data-message-id="${targetId}"]`)).not.toBeVisible({ timeout: 5000 });

    console.log("progress: T-6 undo waiting move");
    const undoRespP = page.waitForResponse(
      (r) => r.url().includes("/api/mailhub/status") && r.request().method() === "POST" && r.status() === 200,
      { timeout: 10000 },
    );
    await page.getByTestId("toast-undo").click();
    await undoRespP;

    await expect(list.locator(`[data-message-id="${targetId}"]`)).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(new RegExp(`id=${targetId}`), { timeout: 5000 });
    await expect(page.getByTestId("detail-subject")).toHaveText(targetSubject!, { timeout: 5000 });
  });

  test("T-7: undo stack TTL prunes by fake clock and expired undo does not call API", async ({ page }) => {
    console.log("progress: T-7 start and install fake clock");
    await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
    await resetAndOpen(page, "/?label=todo");
    await closeInterferingOverlays(page);

    const list = page.getByTestId("message-list");
    const statusRequests: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/mailhub/status")) {
        statusRequests.push(request.postData() ?? "");
      }
    });

    const first = await selectTargetRow(page, "msg-022");
    console.log(`progress: T-7 first action ${first.id}`);
    await openMessage(page, first.row);
    await moveSelectedToWaiting(page);
    await expect(list.locator(`[data-message-id="${first.id}"]`)).not.toBeVisible({ timeout: 5000 });

    console.log("progress: T-7 advance fake clock 2s");
    await page.clock.runFor(2000);

    const second = await selectTargetRow(page, "msg-023");
    console.log(`progress: T-7 second action ${second.id}`);
    await openMessage(page, second.row);
    await moveSelectedToWaiting(page);

    const undoButton = page.getByTestId("action-undo");
    await expect(undoButton).toHaveAttribute("title", /2件/, { timeout: 5000 });

    console.log("progress: T-7 advance fake clock 29.5s");
    await page.clock.runFor(29500);
    await expect(undoButton).toHaveAttribute("title", /1件/, { timeout: 5000 });

    const now = await page.evaluate(() => Date.now());
    console.log("progress: T-7 expire remaining undo and click");
    await page.clock.setFixedTime(now + 31_000);
    statusRequests.length = 0;
    await undoButton.click();

    await expect(page.getByText("Undoの期限が切れました")).toBeVisible({ timeout: 3000 });
    expect(statusRequests).toEqual([]);
  });

  test("T-8: reply template state does not leak while InternalOps draft is retained", async ({ page }) => {
    console.log("progress: T-8 start");
    // all view keeps enough fixture rows visible for cross-message draft/template isolation.
    await resetAndOpen(page, "/?label=all");
    await closeInterferingOverlays(page);
    const list = page.getByTestId("message-list");

    const messageA = list.locator('[data-message-id="msg-021"]');
    await expect(messageA).toBeVisible({ timeout: 5000 });
    console.log("progress: T-8 open message A msg-021");
    await openMessage(page, messageA);

    await expect(page.getByTestId("reply-panel")).toBeVisible({ timeout: 5000 });
    const draftText = `phase3-draft-${Date.now()}`;
    const draftTextarea = page.getByTestId("draft-textarea");
    await expect(draftTextarea).toBeVisible({ timeout: 5000 });
    await draftTextarea.fill(draftText);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("mailhub:draft:msg-021")), { timeout: 3000 })
      .toBe(draftText);

    console.log("progress: T-8 insert first reply template");
    await insertFirstReplyTemplate(page);
    const replyBody = page.getByTestId("reply-body");
    await expect(replyBody).not.toHaveValue("", { timeout: 5000 });
    await expect(page.getByTestId("reply-template-applied")).toBeVisible({ timeout: 5000 });

    const { row: messageB, id: messageBId } = await selectTargetRow(page, "msg-022", { excludeIds: ["msg-021"] });
    await expect(messageB).toBeVisible({ timeout: 5000 });
    console.log(`progress: T-8 switch to message B ${messageBId}`);
    await openMessage(page, messageB);

    await expect(replyBody).toHaveValue("", { timeout: 5000 });
    await expect(page.getByTestId("reply-template-applied")).not.toBeVisible({ timeout: 3000 });

    console.log("progress: T-8 switch back to message A");
    await openMessage(page, messageA);
    await expect(draftTextarea).toHaveValue(draftText, { timeout: 5000 });
  });

  test("T-9: icon.svg route serves an SVG favicon", async ({ page }) => {
    console.log("progress: T-9 request /icon.svg");
    const response = await page.request.get("/icon.svg");
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain("<svg");
    expect(response.headers()["content-type"] ?? "").toMatch(/image\/svg\+xml|text\/xml|application\/octet-stream/);
  });

  test("T-10: selecting Todo from a stale store channel clears channel from URL", async ({ page }) => {
    console.log("progress: T-10 start");
    await resetAndOpen(page, "/?channel=store-a");
    await closeInterferingOverlays(page);

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/mailhub/list") && r.request().method() === "GET" && r.status() === 200,
        { timeout: 10000 },
      ),
      page.getByTestId("label-item-todo").click(),
    ]);

    await expect
      .poll(() => {
        const params = new URL(page.url()).searchParams;
        return {
          label: params.get("label"),
          hasChannel: params.has("channel"),
        };
      }, { timeout: 5000 })
      .toEqual({ label: "todo", hasChannel: false });
  });

  test("T-11: READ ONLY initial load does not fire rules apply POST", async ({ page }) => {
    console.log("progress: T-11 start");
    await page.request.post("/api/mailhub/test/reset", { data: { readOnly: true } }).catch(() => {});
    await page.addInitScript(() => {
      localStorage.setItem("mailhub-onboarding-shown", "true");
    });

    const rulesApplyPosts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/mailhub/rules/apply")) {
        rulesApplyPosts.push(request.postData() ?? "");
      }
    });

    await page.goto("/?label=all");
    await page.waitForSelector('[data-testid="message-row"]', { timeout: 10000 });
    await expect(page.getByTestId("readonly-badge")).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);

    expect(rulesApplyPosts).toEqual([]);
    await page.request.post("/api/mailhub/test/reset", { data: { readOnly: false } }).catch(() => {});
  });
});
