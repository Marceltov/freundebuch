import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import LoginPage from "./page";

let acceptLanguage = "";
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "accept-language": acceptLanguage }), cookies: async () => ({ get: () => undefined }) }));

const render = async (q: Record<string, string>) => renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve(q) } as PageProps<"/login">));
const links = (html: string) => [...html.matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[1].replace(/&amp;/g, "&"), m[2]]);
const alert = (html: string) => /<p id="login-error" role="alert"[^>]*>([^<]*)<\/p>/.exec(html)?.[1];

test("one link: Mit authentik anmelden, keeping next", async () => {
  expect(links(await render({ next: "/p/x" }))).toEqual([["/api/oidc/start?next=%2Fp%2Fx", "Mit authentik anmelden"]]);
  expect(links(await render({}))).toEqual([["/api/oidc/start", "Mit authentik anmelden"]]);
});

test("next is checked: another site becomes /", async () => {
  for (const next of ["//evil.example", "https://evil.example"]) expect(links(await render({ next }))[0][0]).toBe("/api/oidc/start");
});

test("no password form, ever", async () => {
  expect(await render({})).not.toContain("<form");
});

test("a failed sign-in shows its German message; too many attempts names the wait", async () => {
  expect(alert(await render({}))).toBe("");
  expect(alert(await render({ error: "sign_in_failed" }))).toBe("Die Anmeldung hat nicht geklappt. Versuch es noch einmal.");
  expect(alert(await render({ error: "too_many_attempts", retry: "9" }))).toBe("Zu viele Versuche. Versuch es in 9 Sekunden noch einmal.");
  expect(alert(await render({ error: "too_many_attempts", retry: "<b>" }))).toBe("Zu viele Versuche. Versuch es gleich noch einmal.");
  expect(alert(await render({ error: "something_else" }))).toBe("Die Anmeldung hat nicht geklappt. Versuch es noch einmal.");
});

test("signed out, the page speaks the browser's language", async () => {
  acceptLanguage = "en-GB,en;q=0.9,de;q=0.5";
  expect(links(await render({}))).toEqual([["/api/oidc/start", "Sign in with authentik"]]);
  acceptLanguage = "fr-FR,de;q=0.8,en;q=0.5";
  expect(links(await render({}))).toEqual([["/api/oidc/start", "Mit authentik anmelden"]]);
  acceptLanguage = "";
});
