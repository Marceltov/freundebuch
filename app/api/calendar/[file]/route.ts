import { calendarRoute } from "@/backend";

// The calendar feed (backend/sharing/calendar.ts): /api/calendar/{key}.ics, read by calendar apps without a sign-in.
export async function GET(req: Request, { params }: RouteContext<"/api/calendar/[file]">) {
  return calendarRoute(req, (await params).file);
}
