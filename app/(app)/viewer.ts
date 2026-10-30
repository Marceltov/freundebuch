import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { IDENTITY_COOKIE, NotFoundError, userLanguage, viewerFromCookie, type Viewer } from "@/backend";
import { copyFor, type Copy } from "@/components/copy";
import { setRequestLanguage } from "@/components/serverCopy";

// Who is looking at a page. The proxy has checked the cookie's signature; a user deleted since then goes back to /login.
export async function pageViewer(): Promise<Viewer> {
  const v = await viewerFromCookie((await cookies()).get(IDENTITY_COOKIE)?.value);
  if (!v) redirect("/login");
  setRequestLanguage(await userLanguage(v));
  return v;
}

/** The strings of a page in the viewer's language, for its metadata. */
export async function pageCopy(): Promise<Copy> {
  return copyFor(await userLanguage(await pageViewer()));
}

/** The value, or the 404 page for something that doesn't exist or the viewer may not see. */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
}
