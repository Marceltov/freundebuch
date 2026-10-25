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
  now: "Gerade los",
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
  age: "wird {n}",

  // Erzählen, the chat
  tell: "Erzählen",
  message: "Nachricht",
  tellPlaceholder: "Erzähl, was los war, oder frag …",
  send: "Senden",
  newChat: "Neues Gespräch",
  closeChat: "Schließen",
  aboutPerson: "Es geht um {name}",
  aboutConversation: "Es geht um dieses Gespräch",
  aboutThisPerson: "Es geht um diese Person",
  removeContext: "Nicht darum",
  chatHello: "Erzähl mir, was passiert ist, oder frag nach jemandem.",
  conversationOn: "Gespräch am {day}",
  thinking: "Claude denkt nach …",
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
