import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { DEFAULT_KINDS, type TodoistStatus } from "@/backend";
import { commitLeadDays, TodoistSettings } from "./Settings";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

const connected = (over: Partial<Extract<TodoistStatus, { connected: true }>> = {}): TodoistStatus => ({
  connected: true,
  projectId: "p1",
  projectName: "Freunde",
  broken: false,
  kinds: DEFAULT_KINDS,
  ...over,
});
const render = (
  status: TodoistStatus,
  delivery: "push" | "todoist" | "both" = "push",
  webhookUrl: string | null = "https://ntfy.sh/x",
  projects?: { id: string; name: string }[],
) => renderToStaticMarkup(<TodoistSettings status={status} delivery={delivery} webhookUrl={webhookUrl} projects={projects} />);

test("not connected: a password field for the token, empty, and no project or kinds", () => {
  const html = render({ connected: false });
  expect(html).toMatch(/<input[^>]*type="password"[^>]*value=""/);
  expect(html).toContain("Verbinden");
  expect(html).not.toContain("Trennen");
  expect(html).not.toContain("Tage vorher");
});

test("connected without a project: the project picker with the projects", () => {
  const html = render(connected({ projectId: null, projectName: null }), "push", "https://ntfy.sh/x", [
    { id: "p1", name: "Freunde" },
    { id: "p2", name: "Inbox" },
  ]);
  expect(html).toContain('<option value="p1" selected="">Freunde</option>');
  expect(html).toContain('<option value="p2">Inbox</option>');
  expect(html).not.toContain("Tage vorher");
});

test("connected with a project: the kinds with days ahead and placement, and disconnect", () => {
  const html = render(connected());
  expect(html).toContain("Freunde");
  expect(html).toContain("Trennen");
  expect(html).toMatch(/type="number"[^>]*min="0"[^>]*max="60"/);
  expect(html).toContain("Frist");
  expect(html.match(/type="number"/g)).toHaveLength(4);
});

test("broken: a notice with a reconnect field", () => {
  const html = render(connected({ broken: true }));
  expect(html).toContain('role="alert"');
  expect(html).toMatch(/<input[^>]*type="password"/);
});

test("delivery: push is off without a webhook; todoist unusable says the push stands in", () => {
  expect(render({ connected: false }, "push", null)).toMatch(/<input[^>]*disabled=""[^>]*value="push"/);
  expect(render({ connected: false }, "push", "https://ntfy.sh/x")).not.toMatch(/<input[^>]*disabled=""[^>]*value="push"/);
  expect(render({ connected: false }, "todoist")).toContain("Push");
  expect(render({ connected: false }, "todoist")).toContain('data-testid="delivery-fallback"');
  expect(render(connected(), "todoist")).not.toContain('data-testid="delivery-fallback"');
  expect(render(connected({ broken: true }), "both")).toContain('data-testid="delivery-fallback"');
  expect(render({ connected: false }, "push")).not.toContain('data-testid="delivery-fallback"');
});

test("leaving a days field sends one save; invalid, unchanged or refused entries go back to the saved value", async () => {
  const save = vi.fn().mockResolvedValue(true);
  expect(await commitLeadDays("14", 1, save)).toBe(14);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith(14);
  expect(await commitLeadDays("1", 1, save)).toBe(1);
  expect(await commitLeadDays("", 1, save)).toBe(1);
  expect(await commitLeadDays("61", 1, save)).toBe(1);
  expect(await commitLeadDays("2.5", 1, save)).toBe(1);
  expect(save).toHaveBeenCalledTimes(1);
  expect(await commitLeadDays("7", 1, vi.fn().mockResolvedValue(false))).toBe(1);
});
