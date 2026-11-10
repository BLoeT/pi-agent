import { readJson, atomicWrite } from "../lib/storage.js";
import { resolveWithin } from "../lib/security.js";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import fs from "fs";
import path from "path";
import { getCurrentUserId, getUserWorkspacePath, checkPermission } from "../lib/users.js";

function getExpensesDir() {
  const userId = getCurrentUserId();
  return resolveWithin(getUserWorkspacePath(userId), "expenses");
}

function getMonthFile(year, month) {
  if (!Number.isInteger(year) || year < 1900 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12) throw new Error("Ungültiger Monat/Jahr");
  const dir = getExpensesDir();
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${year}-${String(month).padStart(2, "0")}.json`;
  return resolveWithin(dir, filename);
}

function readMonthExpenses(year, month) {
  const filePath = getMonthFile(year, month);
  if (!fs.existsSync(filePath)) return [];
  const entries=readJson(filePath,[]);
  if(!Array.isArray(entries)) throw new Error("Ungültige Ausgabendatei");
  return entries;
}

function writeMonthExpenses(year, month, expenses) {
  const filePath = getMonthFile(year, month);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  atomicWrite(filePath, JSON.stringify(expenses, null, 2));
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

const CATEGORIES = [
  "Lebensmittel", "Restaurant", "Transport", "Wohnen", "Kleidung",
  "Gesundheit", "Unterhaltung", "Spielzeug", "Elektronik", "Haushalt",
  "Bildung", "Geschenke", "Abos", "Sonstiges"
];

export default defineTool({
  name: "expenses",
  label: "Ausgaben-Tracker",
  description: "Trackt Ausgaben. Actions: add (Ausgabe hinzufügen), list (Ausgaben anzeigen), summary (Monatsübersicht nach Kategorie), delete (Ausgabe löschen), categories (verfügbare Kategorien).",
  parameters: Type.Object({
    action: Type.String({ description: "add, list, summary, delete, categories" }),
    amount: Type.Optional(Type.Number({ description: "Betrag in Euro (z.B. 33.50)" })),
    category: Type.Optional(Type.String({ description: "Kategorie (z.B. Lebensmittel, Spielzeug, Transport)" })),
    description: Type.Optional(Type.String({ description: "Beschreibung (z.B. 'Amazon Bestellung', 'REWE Einkauf')" })),
    shop: Type.Optional(Type.String({ description: "Geschäft/Quelle (z.B. Amazon, REWE, DM)" })),
    date: Type.Optional(Type.String({ description: "Datum (TT.MM.YYYY oder TT.MM.) — default: heute" })),
    month: Type.Optional(Type.Number({ description: "Monat für list/summary (1-12, default: aktueller Monat)" })),
    year: Type.Optional(Type.Number({ description: "Jahr für list/summary (default: aktuelles Jahr)" })),
    expense_id: Type.Optional(Type.String({ description: "ID der Ausgabe (für delete)" })),
  }),
  execute: async (_toolCallId, { action, amount, category, description, shop, date, month, year, expense_id }) => {
    const denied = checkPermission("expenses");
    if (denied) return denied;

    try {
      const now = new Date();
      const currentYear = year || now.getFullYear();
      const currentMonth = month || (now.getMonth() + 1);

      switch (action) {
        case "categories": {
          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Kategorien: ${CATEGORIES.join(", ")}`, categories: CATEGORIES }) }], details: {} };
        }

        case "add": {
          if (!Number.isFinite(amount) || amount <= 0) return { content: [{ type: "text", text: JSON.stringify({ error: "Betrag erforderlich (z.B. 33.50)" }) }], details: {} };
          if (!category?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "Kategorie erforderlich. Verfügbar: " + CATEGORIES.join(", ") }) }], details: {} };

          // Parse date or use today
          let expenseDate = now;
          if (date?.trim()) {
            const match = date.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})?$/);
            if (!match) throw new Error("Datum nicht erkannt; bitte TT.MM.YYYY oder TT.MM. verwenden");
            if (match) {
              const day = parseInt(match[1], 10);
              const mon = parseInt(match[2], 10) - 1;
              const yr = match[3] ? parseInt(match[3], 10) : now.getFullYear();
              expenseDate = new Date(yr, mon, day);
              if(expenseDate.getFullYear()!==yr || expenseDate.getMonth()!==mon || expenseDate.getDate()!==day) throw new Error("Ungültiges Datum");
            }
          }

          const expYear = expenseDate.getFullYear();
          const expMonth = expenseDate.getMonth() + 1;

          const entry = {
            id: generateId(),
            amount: Math.round(amount * 100) / 100,
            category: category.trim(),
            description: description?.trim() || "",
            shop: shop?.trim() || "",
            date: `${expYear}-${String(expMonth).padStart(2, "0")}-${String(expenseDate.getDate()).padStart(2, "0")}`,
            created_at: now.toISOString(),
          };

          const expenses = readMonthExpenses(expYear, expMonth);
          expenses.push(entry);
          writeMonthExpenses(expYear, expMonth, expenses);

          const totalThisMonth = expenses.reduce((sum, e) => sum + e.amount, 0);
          let msg = `${entry.amount.toFixed(2)}€ gespeichert`;
          if (entry.shop) msg += ` (${entry.shop})`;
          msg += ` — Kategorie: ${entry.category}.`;
          msg += ` Gesamt diesen Monat: ${totalThisMonth.toFixed(2)}€.`;

          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: msg, expense: entry, month_total: totalThisMonth }) }], details: {} };
        }

        case "list": {
          const expenses = readMonthExpenses(currentYear, currentMonth);
          if (expenses.length === 0) {
            return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Keine Ausgaben im ${String(currentMonth).padStart(2, "0")}/${currentYear}.`, expenses: [] }) }], details: {} };
          }

          // Sort by date descending
          expenses.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

          const total = expenses.reduce((sum, e) => sum + e.amount, 0);
          const formatted = expenses.slice(0, 20).map(e => {
            const parts = [`${e.date} [${e.id}]: ${e.amount.toFixed(2)}€ ${e.category}`];
            if (e.shop) parts.push(`(${e.shop})`);
            if (e.description) parts.push(`— ${e.description}`);
            return parts.join(" ");
          }).join(". ");

          const expenseList = expenses.slice(0, 20).map(e => ({
            id: e.id,
            date: e.date,
            amount: e.amount,
            category: e.category,
            shop: e.shop,
            description: e.description,
          }));

          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `${expenses.length} Ausgaben, gesamt ${total.toFixed(2)}€: ${formatted}`, total, count: expenses.length, expenses: expenseList }) }], details: {} };
        }

        case "summary": {
          const expenses = readMonthExpenses(currentYear, currentMonth);
          if (expenses.length === 0) {
            return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Keine Ausgaben im ${String(currentMonth).padStart(2, "0")}/${currentYear}.` }) }], details: {} };
          }

          // Group by category
          const byCategory = Object.create(null);
          let total = 0;
          for (const e of expenses) {
            if (!byCategory[e.category]) byCategory[e.category] = { total: 0, count: 0 };
            byCategory[e.category].total += e.amount;
            byCategory[e.category].count++;
            total += e.amount;
          }

          // Sort by total descending
          const sorted = Object.entries(byCategory)
            .sort((a, b) => b[1].total - a[1].total)
            .map(([cat, data]) => `${cat}: ${data.total.toFixed(2)}€ (${data.count}x)`);

          const monthName = new Date(currentYear, currentMonth - 1, 1).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
          const message = `Ausgaben ${monthName}: ${total.toFixed(2)}€ gesamt.\n${sorted.join(", ")}`;

          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message, total, categories: byCategory }) }], details: {} };
        }

        case "delete": {
          if (!expense_id?.trim()) return { content: [{ type: "text", text: JSON.stringify({ error: "expense_id erforderlich" }) }], details: {} };

          const expenses = readMonthExpenses(currentYear, currentMonth);
          const idx = expenses.findIndex(e => e.id === expense_id.trim());
          if (idx === -1) return { content: [{ type: "text", text: JSON.stringify({ error: "Ausgabe nicht gefunden" }) }], details: {} };

          const removed = expenses.splice(idx, 1)[0];
          writeMonthExpenses(currentYear, currentMonth, expenses);

          return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: `Ausgabe gelöscht: ${removed.amount.toFixed(2)}€ ${removed.category}${removed.shop ? ` (${removed.shop})` : ""}` }) }], details: {} };
        }

        default:
          return { content: [{ type: "text", text: JSON.stringify({ error: "Unbekannte Aktion. Verfügbar: add, list, summary, delete, categories" }) }], details: {} };
      }
    } catch (e) {
      console.error(`❌ Expenses Tool error (${action}):`, e.message);
      return { content: [{ type: "text", text: `Error: Ausgaben-Fehler: ${e.message}` }], details: {} };
    }
  },
});
