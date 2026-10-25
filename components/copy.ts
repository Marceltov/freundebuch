// Every string the UI shows, in German. `{name}` placeholders are filled by the component that shows the string.
export const copy = {
  appName: "freundebuch",
  tagline: "Wer ist dir wichtig, und was ist gerade los bei ihnen.",
  signIn: "Mit authentik anmelden",
  signInTitle: "Anmelden",
  connectTitle: "Verbinden",
  signInFailed: "Die Anmeldung hat nicht geklappt. Versuch es noch einmal.",
  tooManyAttempts: "Zu viele Versuche. Versuch es in {seconds} Sekunden noch einmal.",
  tooManyAttemptsSoon: "Zu viele Versuche. Versuch es gleich noch einmal.",
  connectClient: "{client} verbinden",
  connectRedirect: "Nach der Anmeldung geht es zurück zu {host}.",
  unknownClient: "Unbekannter Client. Verbinde freundebuch in deinem MCP-Client neu.",
  badRedirectUri: "Diese Rücksprungadresse hat der Client nicht registriert.",

  // The shell
  home: "Start",
  settings: "Einstellungen",
  logout: "Abmelden",

  // The orbit
  you: "Du",
  orbitTitle: "Deine Leute",
  orbitEmpty: "Noch niemand hier. Verbinde Claude mit freundebuch und erzähl ihm von deinem letzten Treffen.",
  mcpUrl: "MCP-Adresse",
  copyText: "Kopieren",
  copied: "Kopiert",
  copyFailed: "Kopieren fehlgeschlagen",
  badge: { birthday: "Geburtstag bald", promise: "Offenes Versprechen", gift: "Geschenkidee" },

  // The friend page
  now: "Gerade",
  open: "Offen",
  timeline: "Verlauf",
  theirPeople: "Ihre Leute",
  privateItem: "Privat: nur du siehst das",
  byMe: "Du",
  transcript: "Transkript",
  withOthers: "mit {names}",
  everyDays: "alle {n} Tage",
  everyWeeks: "alle {n} Wochen",
  neverSeen: "noch nie",
  seenToday: "heute",
  seenYesterday: "gestern",
  seenDaysAgo: "vor {n} Tagen",
  seenWeeksAgo: "vor {n} Wochen",
  seenMonthsAgo: "vor {n} Monaten",
  lastSeen: "Zuletzt gesehen",
  interval: "Intervall",
  group: "Gruppe",
  age: "wird {n}",

  // Groups
  groupPage: "Gruppe",
  alsoCalled: "auch: {names}",
  people: "{n} Leute",
  onePerson: "1 Person",
  members: "Mitglieder",
  noMembers: "Noch niemand in dieser Gruppe.",
  addGroup: "Gruppe",
  editGroups: "Gruppen bearbeiten",
  groupsFor: "Gruppen für {name}",
  newGroup: "Neue Gruppe",
  newGroupHint: "Neue Gruppe …",
  close: "Fertig",

  // Item actions
  actions: "Aktionen",
  done: "Erledigt",
  outdated: "Veraltet",
  edit: "Bearbeiten",
  changeDate: "Datum ändern",
  save: "Speichern",
  cancel: "Abbrechen",
  makePrivate: "Privat machen",
  makeShared: "Teilen",
  remove: "Löschen",
  confirmRemove: "Wirklich löschen?",
  actionFailed: "Das hat nicht geklappt.",

  // A conversation
  participants: "Dabei",
  transcriptPrivate: "Das Transkript ist privat.",
  conversation: "Gespräch",
  recorded: "Erfasst",

  // Settings
  webhook: "Webhook für Erinnerungen",
  webhookHint: "Einmal am Tag eine Nachricht an diese Adresse, zum Beispiel ein ntfy-Topic.",
  saved: "Gespeichert",
  webhookInvalid: "Bitte eine http- oder https-Adresse.",
  testWebhook: "Test senden",
  testSent: "Gesendet",
  testNotSent: "Nicht angekommen",
  mcpHint: "Diese Adresse in Claude als Connector eintragen.",
};

// The names of the vocabularies the domain stores (backend/types.ts).
export const kindName: Record<string, string> = { in_person: "Treffen", call: "Anruf", message: "Nachricht", video: "Videoanruf", event: "Feier" };

export const dateKindName: Record<string, string> = { birthday: "Geburtstag", anniversary: "Jahrestag", custom: "Datum" };

// What the other person is to the one whose page it is. `out`: the page's person is the `from` side ("from is type of to").
export const relationName: Record<string, { out: string; in: string }> = {
  partner: { out: "Partner:in", in: "Partner:in" },
  spouse: { out: "Ehe", in: "Ehe" },
  parent: { out: "Kind", in: "Elternteil" },
  child: { out: "Elternteil", in: "Kind" },
  sibling: { out: "Geschwister", in: "Geschwister" },
  friend: { out: "Freund:in", in: "Freund:in" },
  colleague: { out: "Kolleg:in", in: "Kolleg:in" },
  introduced_by: { out: "hat vorgestellt", in: "vorgestellt" },
  other: { out: "", in: "" },
};
