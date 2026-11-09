import { test, expect, Page } from "@playwright/test";
async function open(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the local preview" }).click();
}
async function nav(page: Page, panel: string) {
  const mobile = page.viewportSize()!.width <= 800;
  await page
    .locator(mobile ? ".mobile-nav" : ".sidebar")
    .getByRole("button", {
      name:
        panel === "cash"
          ? mobile
            ? "Cash"
            : "Cash ledger"
          : panel === "forecast"
            ? mobile
              ? "Forecast"
              : "Coverage forecast"
            : panel === "types"
              ? mobile
                ? "Types"
                : "Payment types"
              : panel === "settings"
                ? mobile
                  ? "Settings"
                  : "Settings & backup"
                : "Payments",
      exact: true,
    })
    .click();
}
async function addAccount(page: Page) {
  await nav(page, "cash");
  await page
    .getByRole("button", { name: "Add cash account", exact: true })
    .click();
  await page.getByLabel("Opening balance", { exact: true }).fill("1000000.00");
  await page.getByLabel("Opening balance date").fill("2026-01-01");
  await page.getByRole("button", { name: "Save cash account" }).click();
  await expect(
    page.getByRole("button", { name: "Add cash entry" }),
  ).toBeVisible();
}
test("manual cash CRUD, history, backup restore and forecast", async ({
  page,
}) => {
  await open(page);
  await addAccount(page);
  await page.getByRole("button", { name: "Add cash entry" }).click();
  await page.getByLabel("Money movement").selectOption("out");
  await page.getByLabel("Cash amount").fill("2500.29");
  await page.getByLabel("Entry date").fill("2026-01-02");
  await page
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("maintenance");
  await page.getByLabel("Cash description").fill("Roof repair");
  await page.getByRole("button", { name: "Save cash entry" }).click();
  await expect(page.getByText(/997,499.71/)).toBeVisible();
  await page
    .getByRole("button", { name: "Edit cash entry Roof repair" })
    .click();
  await page.getByLabel("Cash amount").fill("3000.00");
  await page.getByRole("button", { name: "Save cash entry" }).click();
  await expect(page.getByText(/997,000.00/)).toBeVisible();
  await nav(page, "forecast");
  await page.getByLabel("Balance date", { exact: true }).fill("2026-10-03");
  await page.getByLabel("Through date").fill("2026-12-31");
  await page
    .getByLabel("Mortgage expense type")
    .selectOption({ label: "Mortgage" });
  await expect(page.getByText("Projected surplus")).toBeVisible();
  await nav(page, "settings");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const file = await (await downloaded).path();
  await page.getByLabel("Import backup").setInputFiles(file!);
  await expect(
    page.getByText("1 cash accounts · 1 cash entries"),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Merge", exact: true }).click();
  await nav(page, "cash");
  await expect(page.getByText(/997,000.00/)).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete cash entry Roof repair" })
    .click();
  await expect(page.getByText(/1,000,000.00/)).toBeVisible();
});
test("income status and total value do not change cash automatically", async ({
  page,
}) => {
  await open(page);
  await addAccount(page);
  await nav(page, "types");
  await page.getByRole("button", { name: "Add type" }).click();
  await page.getByLabel("Payment type name").fill("Rental asset 1");
  await page.getByLabel("Type direction").selectOption("income");
  await page.getByRole("button", { name: "Save type" }).click();
  await nav(page, "payments");
  await page
    .getByRole("button", { name: "Add payment", exact: true })
    .first()
    .click();
  await page.getByLabel("Amount").fill("10000.29");
  await page.getByLabel("Due date").fill("2026-12-01");
  await page
    .getByRole("combobox", { name: "Payment type", exact: true })
    .selectOption({ label: "Rental asset 1" });
  await page.getByLabel("Description").fill("Winter rent");
  await page.getByLabel("Mark as received").check();
  await page.getByLabel("Received date").fill("2026-10-03");
  await page.getByRole("button", { name: "Save payment" }).click();
  if (page.viewportSize()!.width <= 800)
    await page.locator(".views-toggle").click();
  await page
    .locator(".view-list")
    .getByRole("button", { name: /Rental asset 1/ })
    .click();
  await expect(page.getByText("Total received · AED")).toBeVisible();
  await expect(page.getByText("Total value · AED")).toBeVisible();
  await expect(page.getByText("Received", { exact: true })).toBeVisible();
  await nav(page, "cash");
  await expect(page.getByText(/1,000,000.00/)).toBeVisible();
  await expect(
    page.getByText("No entries yet.", { exact: false }),
  ).toBeVisible();
});
test("phone widths, landscape and enlarged text fit all workspaces and forms", async ({
  page,
}) => {
  await open(page);
  for (const width of [360, 390, 412, 844]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 850 });
    for (const panel of ["payments", "types", "cash", "forecast", "settings"]) {
      await nav(page, panel);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
  await page.setViewportSize({ width: 360, height: 850 });
  await page.evaluate(() => (document.documentElement.style.fontSize = "20px"));
  await nav(page, "cash");
  await page
    .getByRole("button", { name: "Add cash account", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await nav(page, "payments");
  await page
    .getByRole("button", { name: "Add payment", exact: true })
    .first()
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
});

test("cash account checkboxes select any subset and keep individual ledgers", async ({
  page,
}) => {
  await open(page);
  await addAccount(page);
  await page
    .getByRole("button", { name: "Add cash account", exact: true })
    .click();
  await page.getByLabel("Account name").fill("Current account");
  await page.getByLabel("Opening balance", { exact: true }).fill("500000.00");
  await page.getByLabel("Opening balance date").fill("2026-01-01");
  await page.getByRole("button", { name: "Save cash account" }).click();
  await expect(page.getByRole("heading",{name:"Add cash account",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Add cash account",exact:true}).click();
  await page.getByLabel("Account name").fill("Reserve account");
  await page.getByLabel("Opening balance",{exact:true}).fill("200000.00");
  await page.getByLabel("Opening balance date").fill("2026-01-01");
  await page.getByRole("button",{name:"Save cash account"}).click();
  await expect(page.getByRole("heading",{name:"Add cash account",exact:true})).toHaveCount(0);
  await nav(page, "payments");
  for (const name of ["Mortgage", "Electricity"]) {
    await page
      .getByRole("button", { name: "Add payment", exact: true })
      .first()
      .click();
    await page.getByLabel("Amount").fill("10000.00");
    await page.getByLabel("Due date").fill("2026-12-01");
    await page
      .getByRole("combobox", { name: "Payment type", exact: true })
      .selectOption({ label: name });
    await page.getByRole("button", { name: "Save payment" }).click();
  }
  await nav(page, "forecast");
  const choices = page.getByRole("group", {name:"Cash accounts", exact:true});
  await expect(page.getByRole("combobox", {name:"Cash account",exact:true})).toHaveCount(0);
  await choices.getByRole("button", {name:"Select all",exact:true}).click();
  await choices.getByRole("checkbox",{name:"Reserve account · AED",exact:true}).uncheck();
  await page.getByLabel("Balance date", { exact: true }).fill("2026-10-03");
  await page.getByLabel("Through date").fill("2026-12-31");
  await page
    .getByLabel("Mortgage expense type")
    .selectOption({ label: "All mortgages" });
  await expect(page.getByText("Combined available cash · AED")).toBeVisible();
  await expect(page.getByText(/1,480,000.00/)).toBeVisible();
  await expect(page.getByText(/20,000.00/)).toBeVisible();
  await page
    .getByLabel("Mortgage expense type")
    .selectOption({ label: "Mortgage" });
  await expect(page.getByText(/1,490,000.00/)).toBeVisible();
  await choices.getByRole("checkbox", {name:"Current account · AED",exact:true}).uncheck();
  await expect(page.getByText(/990,000.00/)).toBeVisible();
  await choices.getByRole("button", {name:"Clear",exact:true}).click();
  await expect(page.getByText("Select at least one cash account to calculate the forecast.")).toBeVisible();
  await expect(page.getByText("Projected surplus", {exact:true})).toHaveCount(0);
  await choices.getByRole("checkbox", {name:"Current account · AED",exact:true}).check();
  await expect(page.getByText(/490,000.00/)).toBeVisible();
  await choices.getByRole("button",{name:"Select all",exact:true}).click();
  await expect(page.getByText(/1,690,000.00/)).toBeVisible();
  await nav(page, "cash");
  await page
    .getByRole("combobox", { name: "Cash account", exact: true })
    .selectOption({ label: "Savings · AED" });
  await expect(page.getByText(/1,000,000.00/)).toBeVisible();
  await expect(
    page.getByRole("option", { name: "All cash accounts" }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Cash account", exact: true })
    .selectOption({ label: "Current account · AED" });
  await expect(page.getByText(/500,000.00/)).toBeVisible();
});

test("cash account and entry proof survives offline use, replacement and backup restore",async({page,context})=>{
 await open(page); await nav(page,"cash");
 const pdf=(name:string)=>({name,mimeType:"application/pdf",buffer:Buffer.from("%PDF-1.4\\n%%EOF")});
 await page.getByRole("button",{name:"Add cash account",exact:true}).click();
 await page.getByLabel("Account name").fill("Bank savings");
 await page.getByLabel("Opening balance",{exact:true}).fill("1000.00");
 await page.getByLabel("Opening balance date").fill("2026-01-01");
 await page.getByLabel("Cash attachment",{exact:true}).setInputFiles(pdf("statement.pdf"));
 await page.getByRole("button",{name:"Save cash account"}).click();
 const accountProof=page.getByRole("region",{name:"Attachment for Bank savings",exact:true});
 await expect(accountProof.getByText("statement.pdf")).toBeVisible();
 await page.getByRole("button",{name:"Add cash entry",exact:true}).click();
 await page.getByLabel("Cash amount").fill("100.00");await page.getByLabel("Cash description").fill("Service charge");
 await page.getByLabel("Cash attachment",{exact:true}).setInputFiles(pdf("invoice.pdf"));
 await page.getByRole("button",{name:"Save cash entry"}).click();
 const entryProof=page.getByRole("region",{name:"Attachment for Service charge",exact:true});
 await expect(entryProof.getByText("invoice.pdf")).toBeVisible();
 await context.setOffline(true);
 let downloaded=page.waitForEvent("download");
 await accountProof.getByRole("button",{name:"Download attachment",exact:true}).click();expect((await downloaded).suggestedFilename()).toBe("statement.pdf");
 downloaded=page.waitForEvent("download");
 await entryProof.getByRole("button",{name:"Download attachment",exact:true}).click();expect((await downloaded).suggestedFilename()).toBe("invoice.pdf");
 await page.getByRole("button",{name:"Edit cash entry Service charge",exact:true}).click();
 await page.getByLabel("Cash attachment",{exact:true}).setInputFiles(pdf("replacement.pdf"));
 await page.getByRole("button",{name:"Save cash entry"}).click();
 await expect(entryProof.getByText("replacement.pdf")).toBeVisible();
 await context.setOffline(false);
 await nav(page,"settings");downloaded=page.waitForEvent("download");await page.getByRole("button",{name:"Export backup",exact:true}).click();const path=await(await downloaded).path();
 await page.getByLabel("Import backup").setInputFiles(path!);page.once("dialog",d=>d.accept());await page.getByRole("button",{name:"Merge",exact:true}).click();
 await nav(page,"cash");await expect(accountProof.getByText("statement.pdf")).toBeVisible();await expect(entryProof.getByText("replacement.pdf")).toBeVisible();
 await page.getByRole("button",{name:"Edit cash entry Service charge",exact:true}).click();await page.getByLabel("Remove current attachment").check();await page.getByRole("button",{name:"Save cash entry"}).click();await expect(entryProof).toHaveCount(0);
 await page.getByRole("button",{name:"Edit cash account",exact:true}).click();await page.getByLabel("Remove current attachment").check();await page.getByRole("button",{name:"Save cash account"}).click();await expect(accountProof).toHaveCount(0);
 await page.reload();await page.getByRole("button",{name:"Explore the local preview"}).click();await nav(page,"cash");await expect(page.getByText("Service charge",{exact:false})).toBeVisible();await expect(accountProof).toHaveCount(0);await expect(entryProof).toHaveCount(0);
});
