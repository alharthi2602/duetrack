import { test, expect } from "@playwright/test";
test("create, edit, persist, transition, receipt, backup and delete", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the local preview" }).click();
  await page
    .getByRole("button", { name: "Add payment", exact: true })
    .first()
    .click();
  await page.getByLabel("Amount").fill("1234.56");
  await page.getByLabel("Due date").fill("2026-10-10");
  await page.getByLabel("Description").fill("Home mortgage");
  await page.getByRole("button", { name: "Save payment" }).click();
  await expect(
    page.getByRole("button", { name: /Home mortgage/ }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Explore the local preview" }).click();
  await page.getByRole("button", { name: /Home mortgage/ }).click();
  await page.getByRole("button", { name: "Mark paid", exact: true }).click();
  await page.getByRole("button", { name: "Save payment" }).click();
  await page.getByRole("button", { name: /Home mortgage/ }).click();
  await expect(
    page.getByRole("dialog").getByText("Paid", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mark unpaid" }).click();
  await page.getByRole("button", { name: /Home mortgage/ }).click();
  await page.getByRole("button", { name: "Edit payment" }).click();
  await page.getByLabel("Amount").fill("100.29");
  await page.getByLabel("Proof of payment").setInputFiles({
    name: "receipt.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF"),
  });
  await page.getByRole("button", { name: "Save payment" }).click();
  await page.getByRole("button", { name: /Home mortgage/ }).click();
  await expect(page.getByText("Receipt available offline")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("button", { name: /Home mortgage/ })).toHaveCount(
    0,
  );
});
test("mobile layout does not overflow and has accessible navigation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the local preview" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Payments", exact: true }),
  ).toBeVisible();
});

test("PWA shell opens offline and restores a backup", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the local preview" }).click();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "Explore the local preview" }).click();
  await expect(
    page.getByRole("heading", { name: "Payments", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add payment", exact: true })
    .first()
    .click();
  await page.getByLabel("Amount").fill("99.29");
  await page.getByLabel("Due date").fill("2026-11-01");
  await page.getByLabel("Description").fill("Offline payment");
  await page.getByRole("button", { name: "Save payment" }).click();
  await context.setOffline(false);
  const mobile = page.viewportSize()!.width < 800;
  await page
    .getByRole("button", {
      name: mobile ? "Settings" : "Settings & backup",
      exact: true,
    })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const download = await downloadPromise;
  const path = (await download.path())!;
  await page.getByLabel("Import backup").setInputFiles(path);
  await expect(page.getByText("Restore preview")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Merge", exact: true }).click();
  await expect(
    page.getByText("Restore applied locally.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Payments", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Offline payment/ }),
  ).toHaveCount(1);
});
