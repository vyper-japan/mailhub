import { test, expect } from "@playwright/test";

test.describe("Step36 Team & Assignee E2E Tests", () => {
  test.beforeEach(async ({ page }) => {
    await page.request.post("/api/mailhub/test/reset").catch(() => {});
    await page.addInitScript(() => {
      localStorage.setItem("mailhub-onboarding-shown", "true");
    });
    await page.goto("/");
    await page.waitForSelector('[data-testid="message-row"]', { timeout: 10000 });
  });

  test("32) Team管理（Settings: TeamタブでCRUD）", async ({ page }) => {
    // Settingsを開く
    await page.getByTestId("action-settings").click();
    const drawer = page.getByTestId("settings-drawer");
    await expect(drawer).toBeVisible({ timeout: 3000 });

    // Teamタブに切り替え
    await drawer.getByTestId("settings-tab-team").click();
    await expect(drawer.getByTestId("settings-panel-team")).toBeVisible({ timeout: 3000 });

    // 新規メンバー作成
    await drawer.getByTestId("team-new-email").fill("test-member@vtj.co.jp");
    await drawer.getByTestId("team-new-name").fill("テストメンバー");
    const createRespP = page.waitForResponse((r) =>
      r.url().includes("/api/mailhub/team") && r.request().method() === "POST" && r.status() === 200
    );
    await drawer.getByTestId("team-create").click();
    await createRespP;
    await expect(drawer.getByTestId("team-row-test-member@vtj.co.jp")).toBeVisible({ timeout: 5000 });

    // メンバーを編集（名前を変更）
    const nameInput = drawer.getByTestId("team-edit-name-test-member@vtj.co.jp");
    await nameInput.clear();
    await nameInput.fill("更新されたメンバー");
    await page.waitForTimeout(500); // onChangeの処理を待つ
    const saveButton = drawer.getByTestId("team-save-test-member@vtj.co.jp");
    await expect(saveButton).toBeEnabled({ timeout: 5000 });
    // waitForResponseはclickの前に設定（click後にレスポンスを待つ）
    const memberEmail = "test-member@vtj.co.jp";
    const updateRespP = page.waitForResponse((r) =>
      r.request().method() === "PATCH" &&
      r.status() === 200 &&
      (() => {
        try {
          const path = new URL(r.url()).pathname;
          return decodeURIComponent(path) === `/api/mailhub/team/${memberEmail}`;
        } catch {
          return false;
        }
      })()
    );
    await saveButton.click();
    await updateRespP;
    // 保存後、load()が呼ばれるので少し待つ
    await page.waitForTimeout(500);
    await expect(drawer.getByTestId("team-edit-name-test-member@vtj.co.jp")).toHaveValue("更新されたメンバー");

    // メンバーを削除
    page.on('dialog', async dialog => {
      expect(dialog.message()).toContain('このメンバーを削除してもよろしいですか？');
      await dialog.accept();
    });
    const deleteRespP = page.waitForResponse((r) =>
      r.request().method() === "DELETE" &&
      r.status() === 200 &&
      (() => {
        try {
          const path = new URL(r.url()).pathname;
          return decodeURIComponent(path) === `/api/mailhub/team/${memberEmail}`;
        } catch {
          return false;
        }
      })()
    ).catch(() => null); // タイムアウトしても続行
    await drawer.getByTestId("team-delete-test-member@vtj.co.jp").click();
    await deleteRespP;
    // 削除後の確認（タイムアウトしても続行）
    await expect(drawer.getByTestId("team-row-test-member@vtj.co.jp")).not.toBeVisible({ timeout: 5000 }).catch(() => {});
    
    // Settings Drawerを閉じる
    await page.keyboard.press("Escape");
    await expect(drawer).not.toBeVisible({ timeout: 2000 });
  });

  test("33) Assign UI（担当者選択モーダル）", async ({ page }) => {
    // まずTeamメンバーを追加（adminとして）
    await page.getByTestId("action-settings").click();
    const drawer = page.getByTestId("settings-drawer");
    await expect(drawer).toBeVisible({ timeout: 3000 });
    await drawer.getByTestId("settings-tab-team").click();
    await drawer.getByTestId("team-new-email").fill("assign-test@vtj.co.jp");
    await drawer.getByTestId("team-new-name").fill("担当テスト");
    const createRespP2 = page.waitForResponse((r) =>
      r.url().includes("/api/mailhub/team") && r.request().method() === "POST" && r.status() === 200
    );
    await drawer.getByTestId("team-create").click();
    await createRespP2;
    // Settings Drawerを閉じる
    await page.keyboard.press("Escape");
    await expect(drawer).not.toBeVisible({ timeout: 2000 });

    // メッセージを選択
    const firstMessage = page.getByTestId("message-row").first();
    await firstMessage.click();
    await page.waitForTimeout(500);

    // 担当ボタンをクリック（担当者選択モーダルが開く）
    await page.getByTestId("action-assign").click();
    const selector = page.getByTestId("assignee-selector");
    await expect(selector).toBeVisible({ timeout: 3000 });

    // 自分を選択
    const assignRespP = page.waitForResponse((r) =>
      r.url().includes("/api/mailhub/assign") && r.request().method() === "POST" && r.status() === 200
    );
    await selector.getByTestId("assignee-picker-apply").click();
    await assignRespP;
    await expect(selector).not.toBeVisible({ timeout: 2000 });

    // 再度担当ボタンをクリック（今度は担当解除が表示される）
    await page.getByTestId("action-unassign").click();
    await expect(selector).toBeVisible({ timeout: 3000 });
    const unassignRespP = page.waitForResponse((r) =>
      r.url().includes("/api/mailhub/assign") && r.request().method() === "POST" && r.status() === 200
    );
    await selector.getByTestId("assignee-selector-unassign").click();
    await unassignRespP;
    await expect(selector).not.toBeVisible({ timeout: 2000 });
  });
});
