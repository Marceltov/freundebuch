import { safeNext } from "@/backend";
import { copy } from "@/components/copy";
import { SignInError } from "@/components/SignInError";

export const dynamic = "force-dynamic";

export const metadata = { title: "Anmelden" };

// One way in: authentik. The link starts the sign-in (GET /api/oidc/start), which comes back to `next`, or here with ?error=.
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error, retry } = await searchParams;
  const to = safeNext(next);
  return (
    <main className="mx-auto mt-[12vh] max-w-sm px-4">
      <div className="rounded-2xl bg-surface p-6 shadow-card">
        <h1 className="text-2xl font-bold tracking-tight">{copy.appName}</h1>
        <p className="mt-1 mb-6 text-muted">{copy.tagline}</p>
        <a
          href={to === "/" ? "/api/oidc/start" : `/api/oidc/start?next=${encodeURIComponent(to)}`}
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
