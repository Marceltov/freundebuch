import { copy } from "./copy";

type Param = string | string[] | undefined;

// The message for ?error= after a failed sign-in (oidc/routes.ts sends sign_in_failed or too_many_attempts&retry=<s>).
// Always rendered, empty without an error, so the button can point at it.
export function SignInError({ error, retry }: { error: Param; retry: Param }) {
  const seconds = typeof retry === "string" && /^\d{1,4}$/.test(retry) ? retry : undefined;
  const message =
    error === undefined ? "" : error === "too_many_attempts" ? (seconds ? copy.tooManyAttempts.replace("{seconds}", seconds) : copy.tooManyAttemptsSoon) : copy.signInFailed;
  return (
    <p id="login-error" role="alert" className="mt-3 text-sm text-error">
      {message}
    </p>
  );
}
