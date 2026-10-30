// The iPhone Shortcut "An freundebuch", as source. It shows in the share sheet; importing it asks for one thing, the Zugang
// from Einstellungen → Dateien teilen (the share address and the key, split here at the space). Shared items go one by one to
// POST /api/share with the key and one batch id for the whole share (so Prüfen shows them together, pre-selected). What didn't
// arrive is shown with the server's German reason, then freundebuch opens under Prüfen on what was sent. iOS imports only
// signed Shortcuts: `npm run shortcut:sign` on a Mac signs this into public/shortcuts/An freundebuch.shortcut and records the
// source's hash next to it (checked by source.test.ts).
// Apple doesn't document the format; the keys below are the ones Shortcuts itself writes.
import { createHash } from "node:crypto";
import { build, type PlistValue } from "plist";

const ACCESS = "4B5B1D0E-6A7C-4F1B-9C0D-2E3F4A5B6C0C";
const PARTS = "4B5B1D0E-6A7C-4F1B-9C0D-2E3F4A5B6C0D";
const ADDRESS = "4B5B1D0E-6A7C-4F1B-9C0D-2E3F4A5B6C01";
const KEY = "4B5B1D0E-6A7C-4F1B-9C0D-2E3F4A5B6C02";
const RANDOM = "4B5B1D0E-6A7C-4F1B-9C0D-2E3F4A5B6C03";
const BATCH = "4B5B1D0E-6A7C-4F1B-9C0D-2E3F4A5B6C04";
const LOOP = "4B5B1D0E-6A7C-4F1B-9C0D-2E3F4A5B6C05";
const POST = "4B5B1D0E-6A7C-4F1B-9C0D-2E3F4A5B6C06";
const URL_OF = "4B5B1D0E-6A7C-4F1B-9C0D-2E3F4A5B6C07";
const ERROR_OF = "4B5B1D0E-6A7C-4F1B-9C0D-2E3F4A5B6C08";
const ARRIVED = "4B5B1D0E-6A7C-4F1B-9C0D-2E3F4A5B6C09";
const ANY_ERROR = "4B5B1D0E-6A7C-4F1B-9C0D-2E3F4A5B6C0A";
const ANY_ANSWER = "4B5B1D0E-6A7C-4F1B-9C0D-2E3F4A5B6C0B";
const ANSWER = "Antwort";
const ERRORS = "Fehler";

type Attachment = Record<string, unknown>;
const output = (uuid: string, name: string): Attachment => ({ Type: "ActionOutput", OutputUUID: uuid, OutputName: name });
const variable = (name: string): Attachment => ({ Type: "Variable", VariableName: name });
/** One variable as a parameter. */
const value = (a: Attachment) => ({ Value: a, WFSerializationType: "WFTextTokenAttachment" });
/** Text with variables in it: each "￼" in `text` is the next of `parts`. */
function text(template: string, ...parts: Attachment[]) {
  const attachmentsByRange: Record<string, Attachment> = {};
  let at = 0;
  for (const part of parts) {
    at = template.indexOf("￼", at);
    attachmentsByRange[`{${at}, 1}`] = part;
    at++;
  }
  return { Value: { string: template, attachmentsByRange }, WFSerializationType: "WFTextTokenString" };
}
const action = (id: string, params: Record<string, unknown>) => ({
  WFWorkflowActionIdentifier: `is.workflow.actions.${id}`,
  WFWorkflowActionParameters: params,
});
/** "If `a` has any value" (mode 0), "Otherwise" (1) and "End If" (2) of one block. */
const ifHasValue = (group: string, a: Attachment) =>
  action("conditional", { GroupingIdentifier: group, WFControlFlowMode: 0, WFCondition: 100, WFInput: { Type: "Variable", Variable: value(a) } });
const otherwise = (group: string) => action("conditional", { GroupingIdentifier: group, WFControlFlowMode: 1 });
const endIf = (group: string) => action("conditional", { GroupingIdentifier: group, WFControlFlowMode: 2 });

/** The Shortcut as the dictionary its file holds. */
export function shortcutPlist(): Record<string, unknown> {
  return {
    // Shortcuts on iOS 26.
    WFWorkflowClientVersion: "4033.0.4.3",
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowMinimumClientVersionString: "900",
    // An open book, in pink.
    WFWorkflowIcon: { WFWorkflowIconStartColor: 3980825855, WFWorkflowIconGlyphNumber: 59465 },
    WFWorkflowTypes: ["ActionExtension"],
    WFWorkflowHasShortcutInputVariables: true,
    WFWorkflowInputContentItemClasses: ["WFImageContentItem", "WFPDFContentItem", "WFGenericFileContentItem", "WFStringContentItem", "WFRichTextContentItem"],
    // One thing to paste: the Zugang from Einstellungen, "<share address> <key>", split here at the space.
    WFWorkflowImportQuestions: [
      { ActionIndex: 0, Category: "Parameter", DefaultValue: "", ParameterKey: "WFTextActionText", Text: "Zugang (aus den freundebuch-Einstellungen)" },
    ],
    WFWorkflowActions: [
      action("gettext", { UUID: ACCESS, WFTextActionText: "" }),
      action("text.split", { UUID: PARTS, text: value(output(ACCESS, "Text")), WFTextSeparator: "Custom", WFTextCustomSeparator: " " }),
      action("getitemfromlist", { UUID: ADDRESS, WFInput: value(output(PARTS, "Text teilen")), WFItemSpecifier: "First Item" }),
      action("getitemfromlist", { UUID: KEY, WFInput: value(output(PARTS, "Text teilen")), WFItemSpecifier: "Last Item" }),
      // One id for the whole share: the time to the second and a random number.
      action("number.random", { UUID: RANDOM, WFRandomNumberMinimum: 100000, WFRandomNumberMaximum: 999999 }),
      action("gettext", {
        UUID: BATCH,
        WFTextActionText: text(
          "ios-￼-￼",
          {
            Type: "CurrentDate",
            Aggrandizements: [{ Type: "WFDateFormatVariableAggrandizement", WFDateFormatStyle: "Custom", WFDateFormat: "yyyyMMddHHmmss" }],
          },
          output(RANDOM, "Zufallszahl"),
        ),
      }),
      action("repeat.each", { UUID: LOOP, GroupingIdentifier: LOOP, WFControlFlowMode: 0, WFInput: value({ Type: "ExtensionInput" }) }),
      action("downloadurl", {
        UUID: POST,
        WFURL: text("￼", output(ADDRESS, "Element aus Liste")),
        WFHTTPMethod: "POST",
        WFHTTPBodyType: "File",
        WFRequestVariable: value(variable("Repeat Item")),
        ShowHeaders: true,
        WFHTTPHeaders: {
          Value: {
            WFDictionaryFieldValueItems: [
              { WFItemType: 0, WFKey: text("Authorization"), WFValue: text("Bearer ￼", output(KEY, "Element aus Liste")) },
              { WFItemType: 0, WFKey: text("X-Freundebuch-Batch"), WFValue: text("￼", output(BATCH, "Text")) },
            ],
          },
          WFSerializationType: "WFDictionaryFieldValue",
        },
      }),
      // An answer with a url arrived (the last one is opened); one without says why not (a wrong key, a file too large).
      action("getvalueforkey", { UUID: URL_OF, WFInput: value(output(POST, "Inhalte von URL")), WFDictionaryKey: "url" }),
      ifHasValue(ARRIVED, output(URL_OF, "Wörterbuchwert")),
      action("setvariable", { WFVariableName: ANSWER, WFInput: value(output(URL_OF, "Wörterbuchwert")) }),
      otherwise(ARRIVED),
      action("getvalueforkey", { UUID: ERROR_OF, WFInput: value(output(POST, "Inhalte von URL")), WFDictionaryKey: "message" }),
      action("appendvariable", { WFVariableName: ERRORS, WFInput: value(output(ERROR_OF, "Wörterbuchwert")) }),
      endIf(ARRIVED),
      action("repeat.each", { GroupingIdentifier: LOOP, WFControlFlowMode: 2 }),
      ifHasValue(ANY_ERROR, variable(ERRORS)),
      action("showresult", { Text: text("Nicht angekommen: \uFFFC", variable(ERRORS)) }),
      endIf(ANY_ERROR),
      ifHasValue(ANY_ANSWER, variable(ANSWER)),
      action("openurl", { WFInput: value(variable(ANSWER)) }),
      endIf(ANY_ANSWER),
    ],
  };
}

/** The Shortcut as an XML property list (unsigned; `plutil -convert binary1` and `shortcuts sign` make the file iOS imports). */
export const shortcutXml = (): string => build(shortcutPlist() as PlistValue);

/** The source's fingerprint, recorded next to the signed file when it is signed. */
export const shortcutSourceHash = (): string => createHash("sha256").update(shortcutXml()).digest("hex");
