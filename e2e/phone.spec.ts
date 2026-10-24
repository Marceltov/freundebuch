import { expect, test, type Page } from "@playwright/test";

// The signed-in app on a phone (390 × 844): one recorded conversation, then orbit → friend page → conversation.
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// The page fits the screen: nothing to scroll sideways.
async function expectNoSideScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/api/e2e/login?name=Erika Muster");
  await expect(page).toHaveURL("/");
});

test("before anything is recorded, the start page says how to connect Claude", async ({ page }) => {
  await page.goto("/api/e2e/login?name=Neu Hier");
  await expect(page.getByText("Noch niemand hier.")).toBeVisible();
  await expect(page.getByText(/\/mcp$/)).toBeVisible();
  await expectNoSideScroll(page);
});

test("orbit → friend page → conversation", async ({ page, baseURL }) => {
  const recorded = await page.request.post("/api/v1/conversations", {
    headers: { origin: baseURL! },
    data: {
      date: today,
      kind: "in_person",
      summary: "Kaffee mit Anna, sie fängt im Museum an.",
      transcript: "Kaffee mit Anna Weber. Sie hat einen neuen Job im Museum, ab November.",
      visibility: "shared",
      people: [
        { name: "Anna Weber", present: true },
        { name: "Tom Weber", present: false },
      ],
      facts: [{ person: 0, text: "Neuer Job im Museum", category: "work" }],
      // Private, so it stays Erika's: another user's orbit doesn't get Anna through it.
      promises: [{ person: 0, text: "Umzugsfirma schicken", byMe: true, private: true }],
      relationships: [{ from: 0, to: 1, type: "partner" }],
    },
  });
  expect(recorded.status()).toBe(201);

  await page.goto("/");
  const face = page.getByRole("link", { name: "Anna Weber" });
  await expect(face).toBeVisible();
  await expectNoSideScroll(page);

  await face.click();
  await expect(page.getByRole("heading", { name: "Anna Weber" })).toBeVisible();
  await expect(page.getByText("Neuer Job im Museum")).toBeVisible();
  await expect(page.getByText("Umzugsfirma schicken")).toBeVisible();
  await expect(page.getByLabel("Privat: nur du siehst das")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Tom Weber" })).toBeVisible();
  await expect(page.getByText("Kaffee mit Anna, sie fängt im Museum an.")).toBeVisible();
  await expectNoSideScroll(page);

  await page.getByRole("link", { name: "Transkript" }).click();
  await expect(page.getByText("Sie hat einen neuen Job im Museum, ab November.")).toBeVisible();
  await expectNoSideScroll(page);

  // Done: the promise leaves the "Offen" section.
  await page.goBack();
  const promise = page.locator("div", { hasText: /^Du: Umzugsfirma schicken/ }).last();
  await promise.getByRole("button", { name: "Aktionen" }).click();
  await promise.getByRole("button", { name: "Erledigt" }).click();
  await expect(page.getByText("Umzugsfirma schicken")).toHaveCount(0);

  // The links Claude hands out: a fact opens its highlighted row on the friend page; the done promise still has its row, on the
  // conversation's page, which lists everything filed from it.
  const { conversationId } = await recorded.json();
  const c = await (await page.request.get(`/api/v1/conversations/${conversationId}`)).json();
  await page.goto(c.facts[0].url);
  await expect(page.locator(":target")).toHaveText(/Neuer Job im Museum/);
  await page.goto(c.promises[0].url);
  await expect(page.locator(":target")).toHaveText(/Umzugsfirma schicken.*Erledigt/);
  await expectNoSideScroll(page);
});

test("settings fit the screen and offer the MCP address", async ({ page }) => {
  await page.getByRole("link", { name: "Einstellungen" }).click();
  await expect(page.getByLabel("Webhook für Erinnerungen")).toBeVisible();
  await expect(page.getByText(/\/mcp$/)).toBeVisible();
  await expectNoSideScroll(page);
});
