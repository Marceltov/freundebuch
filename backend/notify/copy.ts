// The German text of the reminders. It lives here, not in components/copy.ts: backend/ never imports the frontend.
// `{name}` placeholders are filled by daily.ts.
export const copy = {
  birthday: "🎂 {name} hat {when} Geburtstag",
  birthdayAge: "🎂 {name} hat {when} Geburtstag ({age})",
  date: "📅 {label} {when}: {name}",
  overdue: "⏳ Lange nicht gesehen: {name}",
  overdueBody: "Zuletzt am {date}",
  promise: "📌 Versprochen: {text}",
  promiseBody: "für {name}",
  promiseTheirs: "📌 {name} wollte: {text}",
  more: "+{n} weitere",
  today: "heute",
  tomorrow: "morgen",
  anniversary: "Jahrestag",
  testTitle: "🔔 freundebuch-Test",
  testBody: "So sehen Benachrichtigungen aus.",
  shotWho: "📷 Wer ist das?",
  shotSensitive: "📷 Bitte kurz ansehen, bevor es abgelegt wird",
  shotNothing: "📷 Auf dem Screenshot war nichts für freundebuch",
  shotFailed: "📷 Der Screenshot konnte nicht gelesen werden",
  shotLimit: "📷 Tageslimit erreicht, der Screenshot wartet",
};
