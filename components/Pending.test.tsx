import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { PendingFile } from "@/backend";
import { idOfHash, PendingList } from "./Pending";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

const file = (over: Partial<PendingFile>): PendingFile => ({
  id: "f1",
  status: "pending",
  createdAt: 0,
  sharedOn: "2026-10-20",
  url: "/api/files/f1",
  type: "image/webp",
  summary: "WhatsApp-Gruppe Sunshine: Freitag Spieleabend",
  transcript: "[19:20] Patrick: Freitag Spieleabend",
  people: [{ name: "Patrick", person: null, candidates: [] }],
  error: null,
  batchId: null,
  ...over,
});

test("a waiting file shows its preview, the suggestion, who is in it, and the way into Erzählen", () => {
  const html = renderToStaticMarkup(<PendingList items={[file({})]} />);
  expect(html).toContain('alt="Geteiltes Bild"');
  expect(html).toContain("WhatsApp-Gruppe Sunshine: Freitag Spieleabend");
  expect(html).toContain("Patrick");
  expect(html).toContain("In Erzählen öffnen");
  expect(html).toContain("Verwerfen");
  expect(html).not.toContain("ablegen");
});

test("a PDF shows as a file, and a failed one says why and offers to read it again", () => {
  const html = renderToStaticMarkup(<PendingList items={[file({ type: "application/pdf", status: "failed", summary: null, error: "400 image too large" })]} />);
  expect(html).toContain(">PDF<");
  expect(html).toContain("Konnte nicht gelesen werden.");
  expect(html).toContain("400 image too large");
  expect(html).toContain("Nochmal lesen");
  expect(html).not.toContain("In Erzählen öffnen");
});

test("files shared together sit in one group, marked as shared together; every card can be selected", () => {
  const html = renderToStaticMarkup(
    <PendingList items={[file({ id: "a", batchId: "run-12345678" }), file({ id: "b", batchId: "run-12345678" }), file({ id: "c" })]} />,
  );
  expect(html.match(/data-batch="run-12345678"/g)).toHaveLength(1);
  expect(html).toContain("Zusammen geteilt");
  expect(html.match(/type="checkbox"/g)).toHaveLength(3);
  expect(html).toContain('aria-label="Auswählen"');
});

test("the file a link opens Prüfen on: its id from #id, nothing from a broken one", () => {
  expect(idOfHash("#abc123")).toBe("abc123");
  expect(idOfHash("#%")).toBe("");
  expect(idOfHash("")).toBe("");
});
