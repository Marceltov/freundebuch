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

  // Filed a day late: the recorder moves the conversation to yesterday.
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const header = page.locator("header");
  await header.getByRole("button", { name: "Aktionen" }).click();
  await header.getByRole("button", { name: "Datum ändern" }).click();
  // Editing opens a sheet of its own: the heading keeps its width instead of being squeezed beside the field.
  expect((await page.getByRole("heading", { level: 1 }).boundingBox())!.width).toBeGreaterThan(150);
  await page.getByRole("dialog", { name: "Datum ändern" }).getByLabel("Datum ändern").fill(yesterday);
  await page.getByRole("dialog", { name: "Datum ändern" }).getByRole("button", { name: "Speichern" }).click();
  const day = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${yesterday}T00:00:00Z`));
  await expect(page.getByRole("heading", { name: day })).toBeVisible();

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

test("groups: tick them on the friend page, open the group's page", async ({ page, baseURL }) => {
  const recorded = await page.request.post("/api/v1/conversations", {
    headers: { origin: baseURL! },
    data: { date: today, kind: "call", summary: "Anruf mit Jonas.", transcript: "Anruf mit Jonas Keller.", visibility: "shared", people: [{ name: "Jonas Keller", present: true }] },
  });
  const jonas = (await recorded.json()).people[0].id;
  await page.goto(`/p/${jonas}`);
  await page.getByRole("button", { name: "Gruppen bearbeiten" }).click();
  const sheet = page.getByRole("dialog", { name: "Gruppen für Jonas Keller" });
  await sheet.getByRole("checkbox", { name: "Familie" }).check();
  // Another name of a group ticks that group instead of making a new one.
  await sheet.getByLabel("Neue Gruppe").fill("kollegen");
  await sheet.getByLabel("Neue Gruppe").press("Enter");
  await expect(sheet.getByRole("checkbox", { name: "Arbeit" })).toBeChecked();
  await expectNoSideScroll(page);
  await sheet.getByRole("button", { name: "Fertig" }).click();

  await page.getByRole("link", { name: /Arbeit/ }).click();
  await expect(page.getByRole("heading", { name: "Arbeit" })).toBeVisible();
  await expect(page.getByText("auch: Job, Kollegen")).toBeVisible();
  await expect(page.getByRole("link", { name: /Jonas Keller/ })).toBeVisible();
  await expectNoSideScroll(page);

  // The start page filtered by the group: Jonas stays, the chip says which filter is on, and the phone remembers it.
  await page.goto("/");
  await page.getByRole("link", { name: /^Arbeit/ }).click();
  await expect(page.getByRole("link", { name: /^Arbeit/ })).toHaveAttribute("aria-current", "true");
  await expect(page.locator('[data-in-group="true"]', { hasText: "JK" })).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(/gruppe=/);
  // Choosing the active group again clears the filter.
  await page.getByRole("link", { name: /^Arbeit/ }).click();
  await expect(page).not.toHaveURL(/gruppe=/);
  await expect(page.getByRole("link", { name: "Alle" })).toHaveAttribute("aria-current", "true");
  await expectNoSideScroll(page);
});

test("groups in settings: another name, rename, merge, delete", async ({ page, baseURL }) => {
  const recorded = await page.request.post("/api/v1/conversations", {
    headers: { origin: baseURL! },
    data: { date: today, kind: "call", summary: "Anruf mit Mira.", transcript: "Anruf mit Mira Schulz.", visibility: "shared", people: [{ name: "Mira Schulz", present: true }] },
  });
  const mira = (await recorded.json()).people[0].id;
  await page.goto("/einstellungen");
  const freunde = page.getByRole("group", { name: "Freunde" });
  await freunde.getByLabel("Anderer Name").fill("Kumpels");
  await freunde.getByLabel("Anderer Name").press("Enter");
  await expect(freunde.getByText("Kumpels")).toBeVisible();
  // A name another group already has is refused, in German.
  await freunde.getByLabel("Anderer Name").fill("Kollegen");
  await freunde.getByLabel("Anderer Name").press("Enter");
  await expect(freunde.getByRole("alert")).toHaveText("Diesen Namen hat schon eine andere Gruppe. Führe die beiden zusammen.");
  await expectNoSideScroll(page);

  // The other name now finds Freunde from the friend page.
  await page.goto(`/p/${mira}`);
  await page.getByRole("button", { name: "Gruppen bearbeiten" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Neue Gruppe").fill("kumpels");
  await sheet.getByLabel("Neue Gruppe").press("Enter");
  await expect(sheet.getByRole("checkbox", { name: "Freunde" })).toBeChecked();
  await sheet.getByRole("button", { name: "Fertig" }).click();

  // Rename Familie, then merge Arbeit into it, then delete it.
  await page.goto("/einstellungen");
  const familie = page.getByRole("group", { name: "Familie" });
  await familie.getByRole("button", { name: "Umbenennen" }).click();
  await familie.getByLabel("Name", { exact: true }).fill("Verwandtschaft");
  await familie.getByLabel("Name", { exact: true }).press("Enter");
  const renamed = page.getByRole("group", { name: "Verwandtschaft" });
  await expect(renamed.getByText("Familie")).toBeVisible();
  await renamed.getByLabel("Andere Gruppe hierher übernehmen …").selectOption({ label: "Arbeit" });
  await renamed.getByRole("button", { name: "Übernehmen" }).click();
  await renamed.getByRole("button", { name: "Arbeit wird Teil von Verwandtschaft. Sicher?" }).click();
  await expect(page.getByRole("group", { name: "Arbeit" })).toHaveCount(0);
  await expect(renamed.getByText("Kollegen")).toBeVisible();
  await renamed.getByRole("button", { name: "Löschen" }).click();
  await renamed.getByRole("button", { name: "Wirklich löschen?" }).click();
  await expect(page.getByRole("group", { name: "Verwandtschaft" })).toHaveCount(0);
});

test("conversation links, the bottom bar, Leute, Bald, Verlauf and the person menu", async ({ page, baseURL }) => {
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const recorded = await page.request.post("/api/v1/conversations", {
    headers: { origin: baseURL! },
    data: {
      date: today,
      kind: "in_person",
      summary: "Spaziergang mit Kai, Lea war auch dabei.",
      transcript: "Spaziergang mit Kai Brandt und Lea Brandt. Uwe kennt Kai von der Arbeit.",
      visibility: "shared",
      people: [
        { name: "Kai Brandt", present: true },
        { name: "Lea Brandt", present: true },
        { name: "Uwe Roth", present: false },
      ],
      facts: [{ person: 0, text: "Läuft einen Marathon", category: "hobby" }],
      promises: [{ person: 1, text: "Buch zurückgeben", byMe: true, due: tomorrow }],
      relationships: [
        { from: 0, to: 1, type: "sibling" },
        { from: 2, to: 0, type: "colleague" },
      ],
    },
  });
  const { conversationId, people } = await recorded.json();
  const [kai, lea] = [people[0].id, people[1].id];

  // Who was there, by name; who was only mentioned, apart. What was filed reads as sentences, and links to the people.
  await page.goto(`/c/${conversationId}`);
  await expect(page.getByRole("list", { name: "Dabei" }).getByRole("link", { name: "Kai Brandt" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Erwähnt" }).getByRole("link", { name: "Uwe Roth" })).toBeVisible();
  await expect(page.getByText("Kai Brandt und Lea Brandt sind Geschwister")).toBeVisible();
  await page.getByRole("link", { name: "Bei Kai Brandt öffnen" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${kai}#facts-`));
  await expect(page.locator(":target")).toHaveText(/Läuft einen Marathon/);

  const nav = page.getByRole("navigation", { name: "Hauptmenü" });
  // Leute: anyone, by name or part of it.
  await nav.getByRole("link", { name: "Leute" }).click();
  await page.getByLabel("Suchen").fill("lea");
  await expect(page.getByRole("link", { name: /Lea Brandt/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Kai Brandt/ })).toHaveCount(0);
  await expectNoSideScroll(page);

  // Bald: the promise due tomorrow, ticked off right there.
  await nav.getByRole("link", { name: "Bald" }).click();
  await page.getByRole("button", { name: "Buch zurückgeben: erledigt" }).click();
  await expect(page.getByText("Buch zurückgeben")).toHaveCount(0);
  await expectNoSideScroll(page);

  // Verlauf: the walk, with who was there.
  await nav.getByRole("link", { name: "Verlauf" }).click();
  await expect(page.getByRole("link", { name: /Kai Brandt, Lea Brandt/ })).toBeVisible();
  await expectNoSideScroll(page);

  // The person menu: how often, a nickname, merging a duplicate, a new name.
  await page.request.post("/api/v1/conversations", {
    headers: { origin: baseURL! },
    data: { date: today, kind: "message", summary: "Nachricht von Leah.", transcript: "Leah hat geschrieben.", visibility: "shared", people: [{ name: "Leah B.", present: true }] },
  });
  await page.goto(`/p/${lea}`);
  const menu = () => page.getByRole("button", { name: "Mehr zu Lea Brandt" });
  await menu().click();
  await page.getByRole("radiogroup", { name: "Wie oft sehen?" }).getByText("Monat").click();
  await expect(page.getByText("alle 30 Tage")).toBeVisible();
  await menu().click();
  await page.getByLabel("Spitzname").fill("Leli");
  await page.getByLabel("Spitzname").press("Enter");
  await menu().click();
  await page.getByLabel("Wer ist dieselbe Person?").selectOption({ label: "Leah B." });
  await page.getByRole("button", { name: "Leah B. wird zu Lea Brandt. Sicher?" }).click();
  await menu().click();
  await page.getByLabel("Name", { exact: true }).fill("Lea Marie Brandt");
  await page.getByLabel("Name", { exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "Lea Marie Brandt" })).toBeVisible();
  await expectNoSideScroll(page);
  await page.goto("/leute");
  await page.getByLabel("Suchen").fill("leli");
  await expect(page.getByRole("link", { name: /Lea Marie Brandt/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Leah B\./ })).toHaveCount(0);
});

test("Erzählen files from a friend's page and keeps the chat across pages", async ({ page, baseURL }) => {
  const recorded = await page.request.post("/api/v1/conversations", {
    headers: { origin: baseURL! },
    data: { date: today, kind: "call", summary: "Anruf mit Nele.", transcript: "Anruf mit Nele Sommer.", visibility: "shared", people: [{ name: "Nele Sommer", present: true }] },
  });
  const nele = (await recorded.json()).people[0].id;
  await page.goto(`/p/${nele}`);
  await page.getByRole("navigation", { name: "Hauptmenü" }).getByRole("button", { name: "Erzählen" }).click();
  const sheet = page.getByRole("dialog", { name: "Erzählen" });
  // Sent right away: the page it was opened on goes along even before the chip has its name.
  const field = sheet.getByLabel("Nachricht");
  await field.fill("Notiz: Nele hat einen Hund adoptiert");
  await sheet.getByRole("button", { name: "Senden" }).click();
  await expect(sheet.getByText("Erfasst.")).toBeVisible();
  await expect(sheet.getByText("Es geht um Nele Sommer")).toBeVisible();
  await expectNoSideScroll(page);
  await sheet.getByRole("link", { name: /Gespräch am/ }).click();
  await expect(page.getByText("Nele hat einen Hund adoptiert").first()).toBeVisible();

  // The chat is still there on another page; an unreachable Claude keeps the text in the field.
  await page.goto("/leute");
  await page.getByRole("navigation", { name: "Hauptmenü" }).getByRole("button", { name: "Erzählen" }).click();
  await expect(sheet.getByText("Notiz: Nele hat einen Hund adoptiert")).toBeVisible();
  await field.fill("Fehlertest");
  await sheet.getByRole("button", { name: "Senden" }).click();
  await expect(sheet.getByRole("alert")).toHaveText("Claude ist gerade nicht erreichbar. Dein Text ist noch da, versuch es gleich noch mal.");
  await expect(field).toHaveValue("Fehlertest");

  // Someone else signing in on this device doesn't see this chat.
  await page.goto("/api/e2e/login?name=Bodo Gast");
  await page.getByRole("navigation", { name: "Hauptmenü" }).getByRole("button", { name: "Erzählen" }).click();
  await expect(sheet.getByText("Notiz: Nele hat einen Hund adoptiert")).toHaveCount(0);
  await page.goto("/api/e2e/login?name=Erika Muster");
  await page.getByRole("navigation", { name: "Hauptmenü" }).getByRole("button", { name: "Erzählen" }).click();
  await expect(sheet.getByText("Notiz: Nele hat einen Hund adoptiert")).toBeVisible();

  await sheet.getByRole("button", { name: "Neues Gespräch" }).click();
  await expect(sheet.getByText("Erfasst.")).toHaveCount(0);
});

test("settings fit the screen and offer the MCP address", async ({ page }) => {
  await page.getByRole("link", { name: "Einstellungen" }).click();
  await expect(page.getByLabel("Webhook für Erinnerungen")).toBeVisible();
  await expect(page.getByText(/\/mcp$/)).toBeVisible();
  await expectNoSideScroll(page);
});
