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

test("someone new sees the book's people and how to start telling", async ({ page }) => {
  await page.goto("/api/e2e/login?name=Neu Hier");
  // Erika signed in before: she is on the orbit as someone Neu Hier hasn't met yet.
  await expect(page.locator('[data-unseen="true"]', { hasText: "Erika" })).toBeVisible();
  await expect(page.getByText("Erzähl von deinem letzten Treffen")).toBeVisible();
  await expect(page.getByText(/\/mcp$/)).toBeVisible();
  await expectNoSideScroll(page);
});

test("soft colour bubbles behind the page, still when the phone asks for less motion", async ({ page }) => {
  const layer = () =>
    page.evaluate(() => {
      const style = getComputedStyle(document.body, "::before");
      return { image: style.backgroundImage, position: style.position, animation: style.animationName };
    });
  const moving = await layer();
  expect(moving.image).toContain("radial-gradient");
  expect(moving.position).toBe("fixed");
  expect(moving.animation).not.toBe("none");
  await expectNoSideScroll(page);

  await page.emulateMedia({ reducedMotion: "reduce" });
  expect((await layer()).animation).toBe("none");
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
  // Tom was only mentioned, never met: he is on the orbit anyway, set apart, with his first name readable.
  await expect(page.locator('[data-unseen="true"]', { hasText: "Tom" })).toBeVisible();
  // The chat sheet shrinks with the phone's keyboard instead of the page sliding away under it.
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /interactive-widget=resizes-content/);
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

  // Gehört zu: a relationship gets a note, and a wrong one goes through its menu.
  const uwe = page.locator("li", { has: page.getByRole("link", { name: /Uwe Roth/ }) });
  await uwe.getByRole("button", { name: "Aktionen" }).click();
  await uwe.getByRole("button", { name: "Bearbeiten" }).click();
  await page.getByRole("dialog", { name: "Bearbeiten" }).getByRole("textbox").fill("vom Bau");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(uwe).toContainText("Kolleg:in · vom Bau");
  await uwe.getByRole("button", { name: "Aktionen" }).click();
  await uwe.getByRole("button", { name: "Löschen" }).click();
  await uwe.getByRole("button", { name: "Wirklich löschen?" }).click();
  await expect(page.getByRole("link", { name: /Uwe Roth/ })).toHaveCount(0);
  await expect(page.locator("li", { has: page.getByRole("link", { name: /Lea Brandt/ }) })).toContainText("Geschwister");

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
  // While Claude works, the message already sits in the chat, the field is empty and Claude is shown thinking.
  await page.route("**/api/chat", async (r) => {
    await new Promise((done) => setTimeout(done, 1500));
    await r.continue();
  });
  // Enter starts a new line (on a phone there is no other way to); the button, or Ctrl+Enter, sends.
  await field.fill("Notiz: Nele");
  await field.press("Enter");
  await field.pressSequentially("hat einen Hund adoptiert");
  await expect(field).toHaveValue("Notiz: Nele\nhat einen Hund adoptiert");
  await field.fill("Notiz: Nele hat einen Hund adoptiert");
  await field.press("Control+Enter");
  await expect(sheet.getByText("Notiz: Nele hat einen Hund adoptiert")).toBeVisible();
  await expect(field).toHaveValue("");
  await expect(sheet.getByRole("status")).toHaveText(/Claude denkt nach/);
  await expect(sheet.getByText("Erfasst.")).toBeVisible();
  await expect(sheet.getByRole("status")).toHaveCount(0);
  await page.unroute("**/api/chat");
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
  await expect(sheet.locator("p", { hasText: /^Fehlertest$/ })).toHaveCount(0);

  // The keyboard stays in the sheet while it is open, and Escape takes it back to the button.
  await expect(field).toBeFocused();
  for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
  expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Hauptmenü" }).getByRole("button", { name: "Erzählen" })).toBeFocused();

  // Moving to another friend with the sheet open names that friend, never the one before.
  await page.goto(`/p/${nele}`);
  await page.getByRole("navigation", { name: "Hauptmenü" }).getByRole("button", { name: "Erzählen" }).click();
  await expect(sheet.getByText("Es geht um Nele Sommer")).toBeVisible();
  const other = (await (await page.request.get("/api/v1/people?q=Kai")).json())[0]?.id ?? (await (await page.request.get("/api/v1/people")).json()).find((p: { id: string }) => p.id !== nele).id;
  // The new name takes a while to load; until then the chip must not keep the old one.
  await page.route(`**/api/v1/people/${other}`, async (r) => {
    await new Promise((done) => setTimeout(done, 2000));
    await r.continue();
  });
  await page.evaluate((id) => (window as unknown as { next: { router: { push(u: string): void } } }).next.router.push(`/p/${id}`), other);
  await expect(page).toHaveURL(new RegExp(`/p/${other}`));
  await expect(sheet.getByText("Es geht um diese Person")).toBeVisible();
  await expect(sheet.getByText("Es geht um Nele Sommer")).toHaveCount(0);
  await page.keyboard.press("Escape");

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

test("a screenshot added in Erzählen waits under Zu prüfen, is filed on a new person and shows on their page", async ({ page }) => {
  const sharp = (await import("sharp")).default;
  const png = await sharp({ create: { width: 300, height: 600, channels: 3, background: { r: 1, g: 120, b: 200 } } }).png().toBuffer();
  await page.goto("/");
  await page.getByRole("navigation", { name: "Hauptmenü" }).getByRole("button", { name: "Erzählen" }).click();
  const sheet = page.getByRole("dialog", { name: "Erzählen" });
  await expect(sheet.getByRole("button", { name: "Screenshot hinzufügen" })).toBeVisible();
  await sheet.locator('input[type="file"]').setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: png });
  await expect(sheet.getByRole("status")).toContainText("Danke! freundebuch liest den Screenshot.");
  await sheet.getByRole("button", { name: "Schließen" }).click();

  // The stand-in model is never sure: the badge appears once it has read the screenshot.
  await expect(async () => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "1 zu prüfen" })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.getByRole("link", { name: "1 zu prüfen" }).click();
  await expect(page).toHaveURL("/pruefen");
  await expect(page.getByRole("textbox").first()).toHaveValue("Urlaub in Lissabon");
  await expectNoSideScroll(page);
  await page.getByRole("button", { name: "Neu anlegen: Anna Reise" }).click();
  await page.getByRole("button", { name: "Bei Anna Reise ablegen" }).click();
  await expect(page.getByText("Nichts zu prüfen.")).toBeVisible();

  const people = await (await page.request.get("/api/v1/people?q=Anna Reise")).json();
  await page.goto(new URL(people[0].url).pathname);
  await expect(page.getByText("Urlaub in Lissabon")).toBeVisible();
  await expect(page.getByText(/· Instagram/)).toBeVisible();
  await expect(page.getByRole("img", { name: "Screenshot" })).toBeVisible();
  // the handle is one of her other names now
  expect(people[0].aliases).toContain("anna.reist");
});

test("settings make a share key, and the key hands in a screenshot", async ({ page, baseURL }) => {
  await page.goto("/einstellungen");
  await expect(page.getByRole("heading", { name: "Screenshots teilen" })).toBeVisible();
  await expect(page.getByText(/\/api\/share$/)).toBeVisible();
  await page.getByRole("button", { name: /Schlüssel erzeugen/ }).click();
  const key = (await page.getByText(/^fbs_/).textContent())!;
  await expectNoSideScroll(page);

  const sharp = (await import("sharp")).default;
  const img = await sharp({ create: { width: 200, height: 400, channels: 3, background: { r: 9, g: 9, b: 9 } } }).png().toBuffer();
  const res = await fetch(`${baseURL}/api/share`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "image/png" }, body: img });
  expect(res.status).toBe(202);
  expect((await res.json()).message).toBe("Danke! freundebuch liest den Screenshot.");
});
