import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import fs from "fs";
import path from "path";
import { checkPermission } from "../lib/users.js";
import { getFlashcardsDir } from "../lib/helpers.js";

const SM2_INTERVALS = [0, 1, 3, 7, 14, 30, 60];

function getDeckPath(deckName) {
  const dir = getFlashcardsDir();
  const filename = deckName.trim().toLowerCase().replace(/\s+/g, '-');
  return path.join(dir, `${filename}.json`);
}

function readDeck(deckName) {
  const filePath = getDeckPath(deckName);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeDeck(deck) {
  const dir = getFlashcardsDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getDeckPath(deck.name), JSON.stringify(deck, null, 2), "utf-8");
}

function getAllDecks() {
  const dir = getFlashcardsDir();
  fs.mkdirSync(dir, { recursive: true });
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
      return { name: c.name, cards: c.cards?.length || 0 };
    } catch (_) { return null; }
  }).filter(Boolean);
}

function getDueCards(deck) {
  const now = new Date();
  return deck.cards.filter(c => !c.next_review || new Date(c.next_review) <= now);
}

function updateCardAfterAnswer(card, correct) {
  if (correct) { card.level = Math.min((card.level || 0) + 1, SM2_INTERVALS.length - 1); card.streak = (card.streak || 0) + 1; }
  else { card.level = Math.max((card.level || 0) - 1, 0); card.streak = 0; }
  const next = new Date();
  next.setDate(next.getDate() + SM2_INTERVALS[card.level]);
  next.setHours(9, 0, 0, 0);
  card.next_review = next.toISOString();
  card.last_reviewed = new Date().toISOString();
  return card;
}

function generateCardId() { return Math.random().toString(36).slice(2, 8); }

export default defineTool({
  name: "flashcards",
  label: "Flashcards",
  description: "Lernkarten mit Spaced Repetition. Actions: create_deck, add_card, generate_cards, study, answer, stats, list_decks.",
  parameters: Type.Object({
    action: Type.String({ description: "create_deck, add_card, generate_cards, study, answer, stats, list_decks" }),
    deck: Type.Optional(Type.String()),
    front: Type.Optional(Type.String()),
    back: Type.Optional(Type.String()),
    cards: Type.Optional(Type.Array(Type.Object({ front: Type.String(), back: Type.String() }))),
    card_id: Type.Optional(Type.String()),
    correct: Type.Optional(Type.Boolean()),
  }),
  execute: async (_toolCallId, { action, deck, front, back, cards, card_id, correct }) => {
    const denied = checkPermission("flashcards");
    if (denied) return denied;
    try {
      switch (action) {
        case "list_decks": {
          const decks = getAllDecks();
          if (decks.length === 0) return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: "Keine Decks. Erstelle eines mit create_deck.", decks: [] }) }], details: {} };
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Decks: ${decks.map(d => `${d.name} (${d.cards})`).join(", ")}`, decks }) }], details: {} };
        }
        case "create_deck": {
          if (!deck?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "Deck-Name erforderlich" }) }], details: {} };
          if (readDeck(deck)) return { content: [{ type: "text", text: JSON.stringify({ error: `"${deck}" existiert bereits` }) }], details: {} };
          writeDeck({ name: deck.trim(), cards: [], created_at: new Date().toISOString() });
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Deck "${deck}" erstellt.` }) }], details: {} };
        }
        case "add_card": {
          if (!deck || !front || !back) return { content: [{ type: "text", text: JSON.stringify({ error: "deck, front, back erforderlich" }) }], details: {} };
          let deckData = readDeck(deck) || { name: deck.trim(), cards: [], created_at: new Date().toISOString() };
          if (deckData.cards.some(c => c.front.toLowerCase() === front.trim().toLowerCase())) return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `"${front}" existiert bereits` }) }], details: {} };
          deckData.cards.push({ id: generateCardId(), front: front.trim(), back: back.trim(), level: 0, streak: 0, next_review: new Date().toISOString(), created_at: new Date().toISOString() });
          writeDeck(deckData);
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Karte: "${front}" → "${back}". ${deckData.cards.length} Karten.` }) }], details: {} };
        }
        case "generate_cards": {
          if (!deck || !cards?.length) return { content: [{ type: "text", text: JSON.stringify({ error: "deck und cards erforderlich" }) }], details: {} };
          let deckData = readDeck(deck) || { name: deck.trim(), cards: [], created_at: new Date().toISOString() };
          const existingFronts = new Set(deckData.cards.map(c => c.front.toLowerCase()));
          const newCards = cards.filter(c => c.front && c.back && !existingFronts.has(c.front.trim().toLowerCase()));
          for (const card of newCards) {
            deckData.cards.push({ id: generateCardId(), front: card.front.trim(), back: card.back.trim(), level: 0, streak: 0, next_review: new Date().toISOString(), created_at: new Date().toISOString() });
          }
          writeDeck(deckData);
          const skipped = cards.length - newCards.length;
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `${newCards.length} neue Karten.${skipped > 0 ? ` ${skipped} Duplikate übersprungen.` : ""} Gesamt: ${deckData.cards.length}`, added: newCards.length }) }], details: {} };
        }
        case "study": {
          if (!deck) return { content: [{ type: "text", text: JSON.stringify({ error: "Deck-Name erforderlich" }) }], details: {} };
          const deckData = readDeck(deck);
          if (!deckData) return { content: [{ type: "text", text: JSON.stringify({ error: `"${deck}" nicht gefunden` }) }], details: {} };
          if (deckData.cards.length === 0) return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: "Keine Karten im Deck." }) }], details: {} };
          const dueCards = getDueCards(deckData);
          if (dueCards.length === 0) {
            const nextReviews = deckData.cards.filter(c => c.next_review).map(c => new Date(c.next_review));
            const next = nextReviews.length > 0 ? new Date(Math.min(...nextReviews)) : null;
            return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: next ? `Keine fälligen Karten. Nächste: ${next.toLocaleDateString("de-DE")}` : "Keine fälligen Karten.", due: 0 }) }], details: {} };
          }
          dueCards.sort((a, b) => (a.level || 0) - (b.level || 0));
          const card = dueCards[0];
          const reverse = Math.random() < 0.4;
          const question = reverse ? card.back : card.front;
          const expected = reverse ? card.front : card.back;
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Was heißt "${question}"?`, card_id: card.id, deck, direction: reverse ? "reverse" : "normal", expected, due_remaining: dueCards.length }) }], details: {} };
        }
        case "answer": {
          if (!deck || !card_id || correct == null) return { content: [{ type: "text", text: JSON.stringify({ error: "deck, card_id, correct erforderlich" }) }], details: {} };
          const deckData = readDeck(deck);
          if (!deckData) return { content: [{ type: "text", text: JSON.stringify({ error: `"${deck}" nicht gefunden` }) }], details: {} };
          const cardIdx = deckData.cards.findIndex(c => c.id === card_id);
          if (cardIdx === -1) return { content: [{ type: "text", text: JSON.stringify({ error: "Karte nicht gefunden" }) }], details: {} };
          const card = deckData.cards[cardIdx];
          const oldLevel = card.level || 0;
          updateCardAfterAnswer(card, correct);
          deckData.cards[cardIdx] = card;
          writeDeck(deckData);
          const remaining = getDueCards(deckData).length;
          const emoji = correct ? "✅" : "❌";
          let msg = correct ? `${emoji} Richtig! Level ${oldLevel}→${card.level}.` : `${emoji} Falsch. Antwort: "${card.back}". Level ${oldLevel}→${card.level}.`;
          msg += remaining > 0 ? ` (${remaining} übrig)` : " Alle geschafft! 🎉";
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: msg, correct, remaining_due: remaining }) }], details: {} };
        }
        case "stats": {
          if (deck) {
            const d = readDeck(deck);
            if (!d) return { content: [{ type: "text", text: JSON.stringify({ error: `"${deck}" nicht gefunden` }) }], details: {} };
            const due = getDueCards(d).length;
            const mastered = d.cards.filter(c => (c.level || 0) >= 5).length;
            return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `${deck}: ${d.cards.length} Karten, ${due} fällig, ${mastered} gemeistert` }) }], details: {} };
          }
          const decks = getAllDecks();
          if (decks.length === 0) return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: "Keine Decks." }) }], details: {} };
          let total = 0, totalDue = 0;
          const info = decks.map(d => { const data = readDeck(d.name); if (data) { const due = getDueCards(data).length; total += data.cards.length; totalDue += due; return `${d.name}: ${data.cards.length} Karten, ${due} fällig`; } return null; }).filter(Boolean);
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `${total} Karten, ${totalDue} fällig. ${info.join(". ")}` }) }], details: {} };
        }
        default:
          return { content: [{ type: "text", text: JSON.stringify({ error: "Unbekannte Aktion" }) }], details: {} };
      }
    } catch (e) {
      return { content: [{ type: "text", text: `Error: Lernkarten-Fehler: ${e.message}` }], details: {} };
    }
  },
});
