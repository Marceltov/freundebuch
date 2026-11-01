import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { IDENTITY_COOKIE, NotFoundError, inBookOf, userLanguage, viewerFromCookie, type Viewer } from "@/backend";
import { copyFor, type Copy } from "@/components/copy";
import { setRequestLanguage } from "@/components/serverCopy";

// Who is looking at a page. With the page's id (a person, a conversation, …), in that thing's book; without one, the user in
// all their books (`bookId` the oldest), which a page reads only through the …Across reads, one book at a time. The proxy has
// checked the cookie's signature; a user deleted since then goes back to /login.
export async function pageViewer(id?: string): Promise<Viewer> {
  const v = await viewerFromCookie((await cookies()).get(IDENTITY_COOKIE)?.value);
  if (!v) redirect("/login");
  setRequestLanguage(await userLanguage(v));
  return (await orNotFound(inBookOf(v, [id]))) ?? v;
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
