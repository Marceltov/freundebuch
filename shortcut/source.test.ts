import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "plist";
import { expect, test } from "vitest";
import { shortcutPlist, shortcutSourceHash, shortcutXml } from "./source";

type Action = { WFWorkflowActionIdentifier: string; WFWorkflowActionParameters: Record<string, unknown> };
const sc = shortcutPlist() as { WFWorkflowActions: Action[]; WFWorkflowImportQuestions: Array<{ ActionIndex: number; ParameterKey: string; Text: string }>; WFWorkflowTypes: string[] };
const actions = sc.WFWorkflowActions;
const SIGNED_FILE = join(__dirname, "..", "public", "shortcuts", "An freundebuch.shortcut");
const HASH_FILE = `${SIGNED_FILE}.sha256`;

// `npm run shortcut:build` runs this with UPDATE_SHORTCUT=1: it writes the unsigned property list to .shortcut-build/. Only
// `npm run shortcut:sign`, after `shortcuts sign` succeeded on a Mac, runs it with SIGNED_SHORTCUT=1 to record the source's hash
// next to the signed file. The last test keeps a source change from shipping without a newly signed file.
if (process.env.UPDATE_SHORTCUT) {
  mkdirSync(join(__dirname, "..", ".shortcut-build"), { recursive: true });
  writeFileSync(join(__dirname, "..", ".shortcut-build", "an-freundebuch.plist"), shortcutXml());
}
if (process.env.SIGNED_SHORTCUT) writeFileSync(HASH_FILE, `${shortcutSourceHash()}\n`);

test("it shows in the share sheet for images, PDFs, files and text", () => {
  expect(sc.WFWorkflowTypes).toContain("ActionExtension");
  expect((sc as unknown as { WFWorkflowInputContentItemClasses: string[] }).WFWorkflowInputContentItemClasses).toEqual(
    expect.arrayContaining(["WFImageContentItem", "WFPDFContentItem", "WFGenericFileContentItem", "WFStringContentItem"]),
  );
});

test("it is called \"An freundebuch\" (iOS names it after its file), with an open book in pink, made for a current Shortcuts", () => {
  expect(SIGNED_FILE.endsWith("/An freundebuch.shortcut")).toBe(true);
  expect((sc as unknown as { WFWorkflowIcon: unknown }).WFWorkflowIcon).toEqual({ WFWorkflowIconStartColor: 3980825855, WFWorkflowIconGlyphNumber: 59465 });
  expect((sc as unknown as { WFWorkflowClientVersion: string }).WFWorkflowClientVersion).toBe("4033.0.4.3");
});

test("importing it asks one thing, the Zugang from Einstellungen, and splits it into address and key at the space", () => {
  const qs = sc.WFWorkflowImportQuestions;
  expect(qs.map((q) => q.Text)).toEqual(["Zugang (aus den freundebuch-Einstellungen)"]);
  expect(qs[0].ParameterKey).toBe("WFTextActionText");
  expect(actions[qs[0].ActionIndex].WFWorkflowActionIdentifier).toBe("is.workflow.actions.gettext");
  const split = actions.find((a) => a.WFWorkflowActionIdentifier === "is.workflow.actions.text.split")!;
  expect(split.WFWorkflowActionParameters).toMatchObject({ WFTextSeparator: "Custom", WFTextCustomSeparator: " " });
  const items = actions.filter((a) => a.WFWorkflowActionIdentifier === "is.workflow.actions.getitemfromlist").map((a) => a.WFWorkflowActionParameters.WFItemSpecifier);
  expect(items).toEqual(["First Item", "Last Item"]);
});

test("every shared item is posted with the key and one batch id for the whole share, then Prüfen opens on what was sent", () => {
  const ids = actions.map((a) => a.WFWorkflowActionIdentifier);
  const post = actions.find((a) => a.WFWorkflowActionIdentifier === "is.workflow.actions.downloadurl")!;
  expect(ids.indexOf("is.workflow.actions.repeat.each")).toBeLessThan(ids.indexOf("is.workflow.actions.downloadurl"));
  expect(post.WFWorkflowActionParameters.WFHTTPMethod).toBe("POST");
  expect(post.WFWorkflowActionParameters.WFHTTPBodyType).toBe("File");
  const headers = JSON.stringify(post.WFWorkflowActionParameters.WFHTTPHeaders);
  expect(headers).toContain("Authorization");
  expect(headers).toContain("Bearer ￼");
  expect(headers).toContain("X-Freundebuch-Batch");
  // The batch id is made once, before the loop.
  expect(ids.lastIndexOf("is.workflow.actions.gettext")).toBeLessThan(ids.indexOf("is.workflow.actions.repeat.each"));
});

const params = (id: string) => actions.filter((a) => a.WFWorkflowActionIdentifier === `is.workflow.actions.${id}`).map((a) => a.WFWorkflowActionParameters);

test("only an answer with a url is kept to open; an answer without one adds its German message to what is shown", () => {
  const keys = params("getvalueforkey").map((p) => p.WFDictionaryKey);
  expect(keys).toEqual(["url", "message"]);
  expect(params("setvariable").map((p) => p.WFVariableName)).toEqual(["Antwort"]);
  expect(params("appendvariable").map((p) => p.WFVariableName)).toEqual(["Fehler"]);
  // Each item: if the answer has a url keep it, otherwise collect the error; after the loop show errors, then open.
  const ifs = params("conditional").filter((p) => p.WFControlFlowMode === 0);
  expect(ifs).toHaveLength(3);
  for (const c of ifs) expect(c.WFCondition).toBe(100);
});

test("after sending, errors are shown in German with the server's words, and Prüfen opens on what arrived", () => {
  const ids = actions.map((a) => a.WFWorkflowActionIdentifier);
  const shown = JSON.stringify(params("showresult"));
  expect(shown).toContain("Nicht angekommen");
  expect(ids.indexOf("is.workflow.actions.showresult")).toBeLessThan(ids.indexOf("is.workflow.actions.openurl"));
  expect(ids.indexOf("is.workflow.actions.openurl")).toBeGreaterThan(ids.lastIndexOf("is.workflow.actions.repeat.each"));
  expect(JSON.stringify(params("openurl"))).toContain('"VariableName":"Antwort"');
});

test("it builds into a property list that reads back the same", () => {
  expect(parse(shortcutXml())).toEqual(sc);
});

test("the signed Shortcut is there, and from this source", () => {
  const stale = "Shortcut source changed or never signed: run npm run shortcut:sign on a Mac and commit public/shortcuts/";
  expect(existsSync(SIGNED_FILE), stale).toBe(true);
  expect(existsSync(HASH_FILE) && readFileSync(HASH_FILE, "utf8").trim(), stale).toBe(shortcutSourceHash());
});
