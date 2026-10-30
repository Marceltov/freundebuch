import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "plist";
import { expect, test } from "vitest";
import { shortcutPlist, shortcutSourceHash, shortcutXml } from "./source";

type Action = { WFWorkflowActionIdentifier: string; WFWorkflowActionParameters: Record<string, unknown> };
const sc = shortcutPlist() as { WFWorkflowActions: Action[]; WFWorkflowImportQuestions: Array<{ ActionIndex: number; ParameterKey: string; Text: string }>; WFWorkflowTypes: string[] };
const actions = sc.WFWorkflowActions;
const HASH_FILE = join(__dirname, "..", "public", "shortcuts", "an-freundebuch.shortcut.sha256");

// `npm run shortcut:build` (and shortcut:sign on a Mac) runs this with UPDATE_SHORTCUT=1: it writes the unsigned property list
// and the source's hash. The hash test below keeps a source change from shipping without a newly signed file.
if (process.env.UPDATE_SHORTCUT) {
  mkdirSync(join(__dirname, "..", ".shortcut-build"), { recursive: true });
  writeFileSync(join(__dirname, "..", ".shortcut-build", "an-freundebuch.plist"), shortcutXml());
  writeFileSync(HASH_FILE, `${shortcutSourceHash()}\n`);
}

test("it shows in the share sheet for images, PDFs, files and text", () => {
  expect(sc.WFWorkflowTypes).toContain("ActionExtension");
  expect((sc as unknown as { WFWorkflowInputContentItemClasses: string[] }).WFWorkflowInputContentItemClasses).toEqual(
    expect.arrayContaining(["WFImageContentItem", "WFPDFContentItem", "WFGenericFileContentItem", "WFStringContentItem"]),
  );
});

test("importing it asks for the share address and the share key, in German, on the text actions holding them", () => {
  const qs = sc.WFWorkflowImportQuestions;
  expect(qs.map((q) => q.Text)).toEqual(["Adresse zum Teilen (aus den freundebuch-Einstellungen)", "Teilen-Schlüssel (aus den freundebuch-Einstellungen)"]);
  for (const q of qs) {
    expect(q.ParameterKey).toBe("WFTextActionText");
    expect(actions[q.ActionIndex].WFWorkflowActionIdentifier).toBe("is.workflow.actions.gettext");
  }
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
  expect(ids.at(-2)).toBe("is.workflow.actions.getvalueforkey");
  expect(actions.at(-2)!.WFWorkflowActionParameters.WFDictionaryKey).toBe("url");
  expect(ids.at(-1)).toBe("is.workflow.actions.openurl");
});

test("it builds into a property list that reads back the same", () => {
  expect(parse(shortcutXml())).toEqual(sc);
});

test("the signed Shortcut is from this source", () => {
  const signed = readFileSync(HASH_FILE, "utf8").trim();
  expect(signed, "Shortcut source changed: run npm run shortcut:sign on a Mac and commit public/shortcuts/").toBe(shortcutSourceHash());
});
