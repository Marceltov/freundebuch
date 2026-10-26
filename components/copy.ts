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
  startTelling: "Erzähl von deinem letzten Treffen: hier über Erzählen, oder verbinde Claude mit dieser Adresse.",
  orbitEmpty: "Noch niemand hier. Verbinde Claude mit freundebuch und erzähl ihm von deinem letzten Treffen.",
  mcpUrl: "MCP-Adresse",
  copyText: "Kopieren",
  copied: "Kopiert",
  copyFailed: "Kopieren fehlgeschlagen",
  badge: { birthday: "Geburtstag bald", promise: "Offenes Versprechen", gift: "Geschenkidee" },

  // The friend page
  now: "Gerade los",
  known: "Gut zu wissen",
  roleUs: "Unsere {role}",
  roleUsM: "Unser {role}",
  roleMe: "{role} von dir",
  rolePartner: "{role} von {name}",
  nudge: "Frag mal nach – seit {weeks} Wochen nichts gehört",
  nudgeWeek: "Frag mal nach – seit einer Woche nichts gehört",
  nudgeSoon: "Frag mal nach",
  askFrom: "nachfragen ab {date}",
  makeSituation: "Ist gerade los",
  makeLasting: "Gut zu wissen",
  askOn: "Nachfragen am …",
  askOnTitle: "Nachfragen am",
  gender: "Geschlecht",
  genderF: "weiblich",
  genderM: "männlich",
  genderX: "divers",
  genderNone: "keine Angabe",
  promised: "Versprochen",
  giftIdeas: "Ideen für Geschenke",
  stillOpen: "Noch offen",
  conversations: "Gespräche",
  theirPeople: "Gehört zu",
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
  ageYears: "{n} Jahre",

  // Erzählen, the chat
  tell: "Erzählen",
  message: "Nachricht",
  tellPlaceholder: "Erzähl, was los war, oder frag …",
  send: "Senden",
  addImage: "Screenshot hinzufügen",
  newChat: "Neues Gespräch",
  closeChat: "Schließen",
  aboutPerson: "Es geht um {name}",
  aboutConversation: "Es geht um dieses Gespräch",
  aboutThisPerson: "Es geht um diese Person",
  removeContext: "Nicht darum",
  chatHello: "Erzähl mir, was passiert ist, oder frag nach jemandem.",
  conversationOn: "Gespräch am {day}",
  thinking: "Claude denkt nach …",
  filedThenFailed: "Erfasst ist es schon, siehe unten. Danach ging etwas schief: {error}",
  chatLimit: "Für heute ist das Limit erreicht. Morgen geht's weiter.",
  chatUnavailable: "Claude ist gerade nicht erreichbar. Dein Text ist noch da, versuch es gleich noch mal.",
  chatRefused: "Darauf kann Claude nicht antworten.",
  chatTooLong: "Das wurde zu lang. Versuch es in kürzeren Schritten.",

  // The tab bar
  mainMenu: "Hauptmenü",
  tabStart: "Start",
  tabHistory: "Verlauf",
  tabPeople: "Leute",
  tabSoon: "Bald",

  // The person menu
  moreAbout: "Mehr zu {name}",
  howOften: "Wie oft sehen?",
  twoWeeks: "2 Wochen",
  month: "Monat",
  quarter: "Quartal",
  never: "Nie",
  addNickname: "Spitzname",
  nickname: "Spitzname",
  nicknameHint: "Unter diesem Namen findest du die Person auch.",
  mergeDuplicate: "Doppelt angelegt?",
  mergeDuplicateHint: "Führe den Eintrag mit dieser Person zusammen; alles davon landet hier.",
  samePerson: "Wer ist dieselbe Person?",
  confirmMergePerson: "{drop} wird zu {keep}. Sicher?",

  // Leute
  search: "Suchen",
  searchPeople: "Name oder Spitzname …",
  noMatch: "Niemand heißt so. Vielleicht unter einem Spitznamen?",
  nobodyYet: "Noch niemand im Buch. Erzähl Claude von deinem letzten Treffen.",
  neverMet: "noch nie getroffen",

  // Bald
  nextTwoWeeks: "Die nächsten zwei Wochen",
  nothingSoon: "Gerade steht nichts an. Genieß die Ruhe.",
  datesSoon: "Geburtstage und Termine",
  youPromisedSoon: "Du hast versprochen",
  wouldBeGlad: "Würden sich freuen",
  sinceWanted: "Zuletzt {since}, du wolltest {every}",
  markDone: "{text}: erledigt",
  until: "bis {day}",
  today: "heute",
  tomorrow: "morgen",
  inDays: "in {n} Tagen",

  // Verlauf
  thisWeek: "Diese Woche",
  lastWeek: "Letzte Woche",
  nothingFiled: "Noch nichts erfasst. Erzähl Claude von deinem letzten Treffen.",

  // Start
  hello: "Hallo {name}",
  helloAnon: "Hallo",
  nobodyWaiting: "Alle sind gut versorgt. Schön, dass du da bist.",
  oneWaiting: "Eine Person würde sich freuen, von dir zu hören.",
  manyWaiting: "{n} Leute würden sich freuen, von dir zu hören.",

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
  all: "Alle",
  groupFilter: "Nach Gruppe filtern",
  groupDue: "{name}: fällig",
  groups: "Gruppen",
  groupsHint: "Andere Namen finden die Gruppe auch, wenn du oder Claude sie benutzt.",
  rename: "Umbenennen",
  groupName: "Name",
  otherName: "Anderer Name",
  removeOtherName: "{name} entfernen",
  mergeInto: "Andere Gruppe hierher übernehmen …",
  merge: "Übernehmen",
  confirmMerge: "{drop} wird Teil von {keep}. Sicher?",
  groupNameTaken: "Diesen Namen hat schon eine andere Gruppe. Führe die beiden zusammen.",
  mergeRefused: "Die andere Person in deinem Haushalt sieht diese Gruppe nicht. Übernimm sie andersherum.",

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
  recorded: "Daraus gemerkt",
  mentioned: "Erwähnt",
  openAt: "Bei {name} öffnen",
  youPromised: "Du hast {name} versprochen:",
  theyPromised: "{name} hat versprochen:",
  partnerPromised: "{by} hat {name} versprochen:",

  // Settings
  webhook: "Webhook für Erinnerungen",
  webhookHint: "Einmal am Tag eine Nachricht an diese Adresse, zum Beispiel ein ntfy-Topic.",
  saved: "Gespeichert",
  webhookInvalid: "Bitte eine http- oder https-Adresse.",
  testWebhook: "Test senden",
  testSent: "Gesendet",
  testNotSent: "Nicht angekommen",
  mcpHint: "Diese Adresse in Claude als Connector eintragen.",

  // Sharing screenshots
  pending: "Zu prüfen",
  pendingHint: "Screenshots, bei denen freundebuch nicht sicher war. Sag, um wen es geht, dann wird es abgelegt.",
  pendingEmpty: "Nichts zu prüfen.",
  pendingCount: "{n} zu prüfen",
  pendingReading: "Wird gelesen …",
  pendingFailed: "Konnte nicht gelesen werden.",
  pendingSensitive: "Sieht persönlich aus. Lieber privat ablegen?",
  pendingWho: "Um wen geht es?",
  pendingSearch: "Andere Person suchen",
  pendingNew: "Neu anlegen: {name}",
  pendingText: "Was ist los",
  pendingPrivate: "Nur für mich",
  pendingFile: "Bei {name} ablegen",
  pendingDiscard: "Verwerfen",
  pendingRetry: "Nochmal lesen",
  pendingFiled: "Abgelegt bei {name}.",
  screenshot: "Screenshot",
  screenshotOf: "Screenshot von {source}",
  calendarTitle: "Kalender abonnieren",
  calendarHint: "Geburtstage, andere Daten und deine Versprechen mit Termin als Kalender-Abo. In Google Kalender: „Weitere Kalender“ → „Per URL“ und die Adresse einfügen. Google holt Änderungen nur alle paar Stunden.",
  calendarUrl: "Kalender-Adresse",
  calendarNew: "Adresse erzeugen",
  calendarReplace: "Neue Adresse erzeugen",
  calendarRevoke: "Abo beenden",
  calendarOpen: "In der Kalender-App öffnen",
  calendarOnce: "Nur jetzt sichtbar. Wer die Adresse kennt, sieht diese Termine. Eine neue Adresse ersetzt sie.",
  calendarActive: "Ein Kalender-Abo ist eingerichtet. Eine neue Adresse ersetzt die alte, ein Abo der alten bleibt dann leer.",
  shareTitle: "Screenshots teilen",
  shareHint: "Mach einen Screenshot von einem Post (Instagram, LinkedIn, …) und teile ihn mit freundebuch, oder füg ihn unter „Erzählen“ mit dem Bild-Knopf hinzu. freundebuch liest, wer was erlebt hat, und legt es bei der Person ab.",
  shareAndroid: "Android: freundebuch über das Browser-Menü zum Startbildschirm hinzufügen. Danach steht freundebuch beim Teilen eines Bildes zur Auswahl.",
  shareIphone: "iPhone: Lege einen Kurzbefehl an, der das geteilte Bild an diese Adresse schickt, mit deinem Teilen-Schlüssel.",
  shareSteps: [
    "Kurzbefehle-App öffnen, neuen Kurzbefehl „An freundebuch“ anlegen.",
    "In den Details „Im Share-Sheet anzeigen“ einschalten, Eingabe: Bilder.",
    "Aktion „Inhalte von URL abrufen“: die Adresse unten, Methode POST, Header „Authorization“ mit „Bearer “ und dem Schlüssel, Hauptteil: Datei, Kurzbefehleingabe.",
    "Optional: Aktion „Ergebnis anzeigen“ mit „message“ aus der Antwort.",
  ],
  shareUrl: "Adresse zum Teilen",
  shareKey: "Teilen-Schlüssel",
  shareKeyNew: "Schlüssel erzeugen",
  shareKeyReplace: "Neuen Schlüssel erzeugen",
  shareKeyRevoke: "Schlüssel löschen",
  shareKeyOnce: "Nur jetzt sichtbar. Der Schlüssel kann nur Screenshots abgeben, sonst nichts.",
  shareKeyActive: "Ein Schlüssel ist eingerichtet. Ein neuer ersetzt ihn.",
  shareReceiving: "Screenshot wird übergeben …",
  shareReceived: "Danke! freundebuch liest den Screenshot. Wenn es unsicher ist, landet er unter „Zu prüfen“.",
  shareDuplicate: "Diesen Screenshot hat freundebuch schon.",
  shareFailed: "Das hat nicht geklappt. Teile den Screenshot bitte noch einmal.",
  shareNothing: "Hier landen Screenshots, die du mit freundebuch teilst. Wie das geht, steht in den Einstellungen.",
};

// The names of the vocabularies the domain stores (backend/types.ts).
export const kindName: Record<string, string> = { in_person: "Treffen", call: "Anruf", message: "Nachricht", video: "Videoanruf", event: "Feier" };

export const dateKindName: Record<string, string> = { birthday: "Geburtstag", anniversary: "Jahrestag", custom: "Datum" };

// A relationship as a sentence: `from` is {a}, `to` is {b} ("from is type of to").
export const relationSentence: Record<string, string> = {
  partner: "{a} und {b} sind ein Paar",
  spouse: "{a} und {b} sind verheiratet",
  parent: "{a} ist Elternteil von {b}",
  child: "{a} ist Kind von {b}",
  sibling: "{a} und {b} sind Geschwister",
  friend: "{a} und {b} sind befreundet",
  colleague: "{a} und {b} arbeiten zusammen",
  introduced_by: "{a} kam über {b} dazu",
  other: "{a} und {b} kennen sich",
};

// A relationship's name for the person at one end, by their gender (f, m, x: nonbinary or unknown). `from` is `type` of `to`.
type Forms = { f: string; m: string; x: string };
const same = (w: string): Forms => ({ f: w, m: w, x: w });
const forms = (f: string, m: string, x: string): Forms => ({ f, m, x });
export const relationName: Record<string, { from: Forms; to: Forms }> = {
  partner: { from: forms("Partnerin", "Partner", "Partner:in"), to: forms("Partnerin", "Partner", "Partner:in") },
  spouse: { from: forms("Ehefrau", "Ehemann", "Ehepartner:in"), to: forms("Ehefrau", "Ehemann", "Ehepartner:in") },
  parent: { from: forms("Mutter", "Vater", "Elternteil"), to: forms("Tochter", "Sohn", "Kind") },
  child: { from: forms("Tochter", "Sohn", "Kind"), to: forms("Mutter", "Vater", "Elternteil") },
  sibling: { from: forms("Schwester", "Bruder", "Geschwister"), to: forms("Schwester", "Bruder", "Geschwister") },
  friend: { from: forms("Freundin", "Freund", "Freund:in"), to: forms("Freundin", "Freund", "Freund:in") },
  colleague: { from: forms("Kollegin", "Kollege", "Kolleg:in"), to: forms("Kollegin", "Kollege", "Kolleg:in") },
  introduced_by: { from: same("vorgestellt"), to: same("hat vorgestellt") },
  other: { from: same(""), to: same("") },
  landlord: { from: forms("Vermieterin", "Vermieter", "Vermieter:in"), to: forms("Mieterin", "Mieter", "Mieter:in") },
  neighbour: { from: forms("Nachbarin", "Nachbar", "Nachbar:in"), to: forms("Nachbarin", "Nachbar", "Nachbar:in") },
  doctor: { from: forms("Ärztin", "Arzt", "Ärzt:in"), to: forms("Patientin", "Patient", "Patient:in") },
  service: { from: forms("Dienstleisterin", "Dienstleister", "Dienstleister:in"), to: forms("Kundin", "Kunde", "Kund:in") },
};

type Gender = "female" | "male" | "nonbinary" | null;
/** What the person at `side` of a relationship is ("Vermieterin" for the `from` of landlord, when she is female). */
export function relationLabel(type: string, side: "from" | "to", gender: Gender): string {
  const f = relationName[type]?.[side];
  if (!f) return "";
  return gender === "female" ? f.f : gender === "male" ? f.m : f.x;
}

// Words that take "unser", not "unsere": neuter forms.
const NEUTER = new Set(["Kind", "Elternteil"]);

/**
 * The role line under a person's name: who they are to us, read from the viewer's side ("Unsere Vermieterin", "Kollegin von
 * dir", "Kolleg:in von Marcel"), several joined with " · ". For `other` and `service` the note says what they are.
 */
export function roleLine(roles: { type: string; direction: "out" | "in"; with: "me" | "partner" | "us"; partnerName?: string; note: string | null }[], gender: Gender): string {
  return roles
    .map((r) => {
      const name = (r.type === "other" || r.type === "service") && r.note ? r.note : relationLabel(r.type, r.direction === "out" ? "from" : "to", gender);
      if (!name) return "";
      if (r.with === "us") return (gender === "male" || NEUTER.has(name) ? copy.roleUsM : copy.roleUs).replace("{role}", name);
      if (r.with === "me") return copy.roleMe.replace("{role}", name);
      return copy.rolePartner.replace("{role}", name).replace("{name}", r.partnerName ?? "");
    })
    .filter(Boolean)
    .join(" · ");
}
