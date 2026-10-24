import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkAuthorize } from "@/backend";
import { copy } from "@/components/copy";
import { SignInError } from "@/components/SignInError";

export const dynamic = "force-dynamic";

export const metadata = { title: copy.connectTitle };

// The OAuth authorize step: an MCP client (the Claude app) wants in. Signing in through authentik is the consent: the form
// posts the checked fields to /api/oidc/start, and the callback sends the browser back to the client with a code, or back
// here with ?error=. A form POST, not a link: a cross-site GET must never start an MCP sign-in.
export default async function AuthorizePage({ searchParams }: PageProps<"/oauth/authorize">) {
  const { error, retry, ...rest } = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(rest)) for (const one of [v ?? []].flat()) params.append(k, one);
  const checked = checkAuthorize(params, await headers());
  if (checked.kind === "redirect") redirect(checked.location);
  return (
    <main className="mx-auto mt-[12vh] max-w-sm px-4">
      <div className="rounded-2xl bg-surface p-6 shadow-card">
        {checked.kind === "error" ? (
          <>
            <h1 className="mb-4 text-2xl font-bold tracking-tight">{copy.appName}</h1>
            <p role="alert" className="text-error">
              {checked.reason === "unknown_client" ? copy.unknownClient : copy.badRedirectUri}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-tight">{copy.connectClient.replace("{client}", checked.clientName)}</h1>
            <p className="mt-1 mb-6 text-muted">{copy.connectRedirect.replace("{host}", checked.redirectHost)}</p>
            <form method="post" action="/api/oidc/start">
              {Object.entries(checked.fields).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <button type="submit" aria-describedby="login-error" className="w-full rounded-full bg-carbon px-4 py-2.5 font-bold text-on-carbon">
                {copy.signIn}
              </button>
            </form>
            <SignInError error={error} retry={retry} />
          </>
        )}
      </div>
    </main>
  );
}
