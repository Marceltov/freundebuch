import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import AuthorizePage from "./page";

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
const checked = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/backend", async (orig) => ({
  ...(await orig<typeof import("@/backend")>()),
  checkAuthorize: () => checked.value,
}));

beforeEach(() => {
  checked.value = { kind: "page", clientName: "Claude", redirectHost: "claude.ai", fields: { client_id: "x", state: "s" } };
});

const render = async (q: Record<string, string>) =>
  renderToStaticMarkup(await AuthorizePage({ searchParams: Promise.resolve(q) } as PageProps<"/oauth/authorize">));
const alert = (html: string) => /<p id="login-error" role="alert"[^>]*>([^<]*)<\/p>/.exec(html)?.[1];

test("shows the client's name and the redirect host, and one form posting the fields to the sign-in", async () => {
  const html = await render({});
  expect(html).toContain("Claude verbinden");
  expect(html).toContain("claude.ai");
  const forms = [...html.matchAll(/<form action="\/api\/oidc\/start" method="post">(.*?)<\/form>/g)];
  expect(forms).toHaveLength(1);
  expect([...forms[0][1].matchAll(/<input type="hidden" name="([^"]*)" value="([^"]*)"\/>/g)].map((m) => [m[1], m[2]])).toEqual([
    ["client_id", "x"],
    ["state", "s"],
  ]);
  expect(forms[0][1]).toMatch(/<button[^>]*>Mit authentik anmelden<\/button>/);
  expect(html).not.toContain('name="password"');
});

test("German messages for a failed sign-in and too many attempts", async () => {
  expect(alert(await render({ error: "sign_in_failed" }))).toBe("Die Anmeldung hat nicht geklappt. Versuch es noch einmal.");
  expect(alert(await render({ error: "too_many_attempts", retry: "9" }))).toBe("Zu viele Versuche. Versuch es in 9 Sekunden noch einmal.");
});

test.each([
  ["unknown_client", "Unbekannter Client. Verbinde freundebuch in deinem MCP-Client neu."],
  ["bad_redirect_uri", "Diese Rücksprungadresse hat der Client nicht registriert."],
])("an invalid request (%s) shows a German error and no form", async (reason, message) => {
  checked.value = { kind: "error", reason };
  const html = await render({});
  expect(html).not.toContain("<form");
  expect(/<p role="alert"[^>]*>([^<]*)<\/p>/.exec(html)?.[1]).toBe(message);
});
