/** Actual Telegram commands, answered locally without a model call. */
export const COMMAND_HELP = `Das sind meine Telegram-Befehle:

/audio – anzeigen, ob Sprachantworten an sind
/audio an oder /audio aus – Sprachantworten umschalten

/modell – aktuelles Modell und verfügbare Modelle anzeigen
/modell MODELLNAME – Modell wechseln (genauen Namen aus der Liste einsetzen)
/modell aktualisieren – neu installierte Modelle einlesen

/modus – verfügbare Denkmodi anzeigen
/modus schnell, normal, gruendlich oder maximal – Denkmodus wählen

/vorschau – anzeigen, ob die Textvorschau an ist
/vorschau an oder /vorschau aus – Textvorschau umschalten

/reset – neuer Chat; gespeichertes Wissen bleibt erhalten
/id – deine Telegram-Chat-ID anzeigen
/start – Begrüßung und Einstieg
/hilfe – diese Übersicht anzeigen

Du musst dir das nicht merken. Frag einfach: „Was sind deine Commands?“ oder „Welche Befehle gibt es?“`;

export function isCommandHelp(text) {
  if (typeof text !== 'string') return false;
  const normalized=text.normalize('NFC').toLocaleLowerCase('de-DE').trim();
  if (/^\/(?:hilfe|help|commands|befehle)(?:@\w+)?\s*$/.test(normalized)) return true;
  const words=normalized.replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
  if (/^(?:commands?|befehle|kommandos?|befehlsübersicht)$/.test(words)) return true;
  if (!/\b(?:commands?|befehle[n]?|kommandos?|befehlsübersicht)\b/u.test(words)) return false;
  if (/^(?:welche|was für) (?:commands?|befehle|kommandos?) (?:gibt es|gibts)(?: denn| nochmal| noch mal| hier| bei dir| in telegram)*$/.test(words)) return true;
  return /\b(?:was|welche|wie|zeig|zeige|zeigen|auflisten|nennen|gib|liste|übersicht|hilfe|hast)\b/u.test(words)
    && /\b(?:deine[nr]?|du|ribo|telegram)\b/u.test(words)
    || /^(?:bitte )?(?:zeig|zeige|gib|liste)(?: mir)? (?:alle |die |eine liste der |eine übersicht der )?(?:commands?|befehle|kommandos?)(?: auf| an| bitte)?$/.test(words);
}
