// GET /api/e2e/login?name=: signs the browser in as a user of that name without authentik, for the Playwright tests. Answers
// only while config.e2e() (FREUNDEBUCH_E2E=1 outside a production build); otherwise it is an unknown endpoint like any other.
import { config } from "../core/config";
import { NotFoundError } from "../core/errors";
import { errorReply } from "../http/errors";
import { seeOther } from "../http/request";
import { userFromOidc } from "../core/users";
import { sign } from "./tokens";
import { IDENTITY_COOKIE } from "./session";

export async function e2eLoginRoute(req: Request): Promise<Response> {
  if (!config.e2e()) {
    const { status, body } = errorReply(new NotFoundError("no such endpoint"));
    return Response.json(body, { status });
  }
  const name = new URL(req.url).searchParams.get("name")?.trim() || "E2E";
  const v = await userFromOidc({ sub: `e2e:${name}`, name });
  return seeOther("/", { "Set-Cookie": `${IDENTITY_COOKIE}=${sign("identity", { uid: v.userId })}; Path=/; HttpOnly; SameSite=Lax` });
}
