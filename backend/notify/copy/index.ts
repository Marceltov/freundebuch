// The text of the reminders, the calendar feed and the Shortcut's answers, one module per language with the same keys (de.ts gives
// the type; en.ts). It lives here, not in components/copy/: backend/ never imports the frontend. `{name}` placeholders are filled by daily.ts.
import type { Language } from "../../core/types";
import { de, type NotifyCopy } from "./de";
import { en } from "./en";

export type { NotifyCopy };

const COPY: Record<Language, NotifyCopy> = { de, en };

/** The notification text in `language`. */
export const notifyCopy = (language: Language): NotifyCopy => COPY[language];
