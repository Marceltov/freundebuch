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
  more: "+{n} weitere",
  today: "heute",
  tomorrow: "morgen",
  anniversary: "Jahrestag",
  testTitle: "🔔 freundebuch-Test",
  testBody: "So sehen Benachrichtigungen aus.",
};
