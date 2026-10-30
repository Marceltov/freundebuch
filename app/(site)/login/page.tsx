import { safeNext } from "@/backend";
import { siteCopy } from "@/app/language";
import { SignInError } from "@/components/SignInError";

export const dynamic = "force-dynamic";

export const generateMetadata = async () => ({ title: (await siteCopy()).signInTitle });

// One way in: authentik. The link starts the sign-in (GET /api/oidc/start), which comes back to `next`, or here with ?error=.
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const copy = await siteCopy();
  const { next, error, retry, invite } = await searchParams;
  const to = safeNext(next);
  // An invitation into a household (instance.ts) goes along to the sign-in; the sign-in checks it.
  const start = new URLSearchParams({ ...(to === "/" ? {} : { next: to }), ...(typeof invite === "string" ? { invite } : {}) }).toString();
  return (
    <main className="mx-auto mt-[12vh] max-w-sm px-4">
      <div className="rounded-2xl bg-surface p-6 shadow-card">
        <h1 className="text-2xl font-bold tracking-tight">{copy.appName}</h1>
        <p className="mt-1 mb-6 text-muted">{typeof invite === "string" ? copy.invited : copy.tagline}</p>
        <a
          href={start ? `/api/oidc/start?${start}` : "/api/oidc/start"}
          aria-describedby="login-error"
          className="block rounded-full bg-carbon px-4 py-2.5 text-center font-bold text-on-carbon"
        >
          {copy.signIn}
        </a>
        <SignInError error={error} retry={retry} />
      </div>
    </main>
  );
}
