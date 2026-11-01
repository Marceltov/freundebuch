// GET /api/e2e/login?name=: signs the browser in as a user of that name without authentik, for the Playwright tests. Answers
// only while config.e2e() (FREUNDEBUCH_E2E=1 outside a production build); otherwise it is an unknown endpoint like any other.
import { config } from "../core/config";
import { NotFoundError } from "../core/errors";
import { errorReply } from "../http/errors";
import { seeOther } from "../http/request";
import { userFromOidc } from "../core/users";
import { instance } from "../db/scope";
import { viewerIn } from "../people/books";
import { invite } from "../people/invitations";
import { sign } from "./tokens";
import { IDENTITY_COOKIE } from "./session";

export async function e2eLoginRoute(req: Request): Promise<Response> {
  if (!config.e2e()) {
    const { status, body } = errorReply(new NotFoundError("no such endpoint"));
    return Response.json(body, { status });
  }
  const name = new URL(req.url).searchParams.get("name")?.trim() || "E2E";
  // A second user joins the instance's oldest book, as an admin, through an invitation made for them: the household tests
  // keep two users in one book.
  const sub = `e2e:${name}`;
  const i = await instance();
  const known = await i.from("users").select("id").where("oidc_sub", "=", sub).executeTakeFirst();
  const first = known ? undefined : await i.from("books").select(["id", "created_by"]).orderBy("created_at").executeTakeFirst();
  const owner = first && (await viewerIn(i, first.created_by, first.id));
  const invitation = owner ? (await invite(owner, "admin")).url.split("/").pop() : undefined;
  const v = await userFromOidc({ sub, name }, { invitation });
  return seeOther("/", { "Set-Cookie": `${IDENTITY_COOKIE}=${sign("identity", { uid: v.userId })}; Path=/; HttpOnly; SameSite=Lax` });
}
