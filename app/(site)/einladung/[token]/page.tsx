import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { IDENTITY_COOKIE, invitationFor, viewerFromCookie } from "@/backend";
import { siteCopy } from "@/app/language";
import { JoinBook } from "@/components/JoinBook";

export const dynamic = "force-dynamic";

export const generateMetadata = async () => ({ title: (await siteCopy()).invitationTitle });

// An invitation's link. Signed out, the proxy sends the browser to /login first and back here; a new user joins the book on the
// way (oidc/routes.ts) and lands here as a member, so a member goes straight home. Anyone else sees the book and joins it.
export default async function InvitationPage({ params }: PageProps<"/einladung/[token]">) {
  const copy = await siteCopy();
  const { token } = await params;
  const v = await viewerFromCookie((await cookies()).get(IDENTITY_COOKIE)?.value);
  if (!v) redirect(`/login?next=${encodeURIComponent(`/einladung/${token}`)}`);
  const inv = await invitationFor(token);
  if (inv && v.books.includes(inv.bookId)) redirect("/");
  return (
    <main className="mx-auto mt-[12vh] max-w-sm px-4">
      <div className="rounded-2xl bg-surface p-6 shadow-card">
        <h1 className="text-2xl font-bold tracking-tight">{copy.invitationTitle}</h1>
        {inv ? (
          <>
            <p className="mt-1 mb-6 text-muted">{copy.invitationBy.replace("{name}", inv.by).replace("{book}", inv.bookName)}</p>
            <JoinBook token={token} join={copy.invitationJoin} failed={copy.invitationJoinFailed} />
          </>
        ) : (
          <>
            <p className="mt-1 mb-6 text-muted">{copy.invitationGone}</p>
            <Link href="/" className="block rounded-full bg-carbon px-4 py-2.5 text-center font-bold text-on-carbon">
              {copy.invitationHome}
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
