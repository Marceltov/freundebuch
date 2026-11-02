import { expect, test, type Page } from "@playwright/test";

// A user with books of their own (?own=1, a new name each run, so the household tests' book stays as it is): the lists merge
// every book, each entry with its book; Einstellungen manages the books; a person moves from their page.
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function meet(page: Page, origin: string, name: string, book?: string) {
  const res = await page.request.post(`/api/v1/rambles${book ? `?book=${encodeURIComponent(book)}` : ""}`, {
    headers: { origin },
    data: {
      date: today,
      transcript: `Kaffee mit ${name}.`,
      visibility: "shared",
      people: [{ name }],
      conversations: [{ kind: "in_person", summary: `Kaffee mit ${name}.`, present: [0] }],
    },
  });
  expect(res.ok()).toBe(true);
}

test.beforeEach(async ({ page, baseURL }) => {
  // Erika first: on a fresh instance the first sign-in makes the household book, which the phone tests share, whichever file
  // runs first.
  await page.goto("/api/e2e/login?name=Erika Muster");
  await page.goto(`/api/e2e/login?own=1&name=Bea ${Math.random().toString(36).slice(2, 8)}`);
  await expect(page).toHaveURL("/");
  const made = await page.request.post("/api/v1/books", { headers: { origin: baseURL! }, data: { name: "Arbeit" } });
  expect(made.status()).toBe(201);
  await meet(page, baseURL!, "Nachbar Nils");
  await meet(page, baseURL!, "Kollegin Kim", "Arbeit");
});

test("a second book's people show in Leute with their book", async ({ page }) => {
  await page.goto("/leute");
  const kim = page.getByRole("link", { name: /Kollegin Kim/ });
  await expect(kim.getByLabel("Buch: Arbeit")).toBeVisible();
  await expect(page.getByRole("link", { name: /Nachbar Nils/ }).getByLabel(/^Buch: /)).toBeVisible();
});

test("moving a person to Arbeit opens them there with its book mark", async ({ page }) => {
  await page.goto("/leute");
  await page.getByRole("link", { name: /Nachbar Nils/ }).click();
  const old = page.url();
  await page
    .getByRole("button", { name: /Mehr zu Nachbar Nils|Nachbar Nils/ })
    .last()
    .click();
  await page.getByLabel("In ein anderes Buch").selectOption({ label: "Arbeit" });
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "In ein anderes Buch: Arbeit" }).click();
  await expect(page).not.toHaveURL(old);
  await expect(page.getByRole("heading", { level: 1, name: "Nachbar Nils" })).toBeVisible();
  await expect(page.getByLabel("Buch: Arbeit")).toBeVisible();
});

test("Einstellungen: invite into a book shows the link once, deleting asks first", async ({ page }) => {
  await page.goto("/einstellungen#buecher");
  const arbeit = page.getByRole("region", { name: "Arbeit" });
  await arbeit.getByRole("button", { name: "Einladen als Mitglied" }).click();
  await expect(arbeit.getByText("Der Link gilt einmal, 7 Tage lang.")).toBeVisible();
  await expect(arbeit.getByText(/\/einladung\/fbi_/)).toBeVisible();
  await expect(arbeit.getByText("Offene Einladungen")).toBeVisible();
  // The owner can't leave; deleting asks first, and declining keeps the book.
  await expect(arbeit.getByRole("button", { name: "Verlassen" })).toHaveCount(0);
  let asked = "";
  page.once("dialog", (d) => {
    asked = d.message();
    void d.dismiss();
  });
  await arbeit.getByRole("button", { name: "Buch löschen" }).click();
  expect(asked).toContain("Arbeit");
  await expect(page.getByRole("region", { name: "Arbeit" })).toBeVisible();
});
