import fs from "node:fs";
import path from "node:path";
import { readJson, updateJson } from "../../shared/storage.js";
import { claimDelivery, finishDelivery, localDateKey } from "../../shared/delivery.js";
import { nextReminder } from "../../shared/reminders.js";

export function createProactiveJobs({ workspace, bot, loadUsersConfig, sendToAgent, deliver }) {
const REMINDER_SENT_FILE = path.join(workspace, "reminder_sent.json");
const PROACTIVE_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const HABITS_ANALYSIS_INTERVAL = 24 * 60 * 60 * 1000; // once per day
const PROACTIVE_RULES_FILE = path.join(workspace, "proactive_rules.json");
const HABITS_LAST_ANALYSIS = path.join(workspace, "habits_last_analysis.json");

function loadProactiveRules() {
  try {
    if (!fs.existsSync(PROACTIVE_RULES_FILE)) return [];
    return readJson(PROACTIVE_RULES_FILE,[]);
  } catch (error) { throw error; }
}

function saveProactiveRules(additions) {
  updateJson(PROACTIVE_RULES_FILE,[], rules=>{
    for(const rule of additions) if(!rules.some(r=>r.id===rule.id && r.userId===rule.userId)) rules.push(rule);
  });
}

function loadLastAnalysis() { return readJson(HABITS_LAST_ANALYSIS,{}); }

function saveLastAnalysis(data) {
  updateJson(HABITS_LAST_ANALYSIS,{},current=>{
    const rejected=[...new Set([...(current.rejected||[]),...(data.rejected||[])])];
    Object.assign(current,data);current.rejected=rejected;
  });
}

// Execute a proactive rule: send the result of an agent prompt to the user
async function executeProactiveRule(rule, user) {
  if (!user.chat_id) return;
  try {
    const result = await sendToAgent(rule.prompt, rule.userId, null, {scheduled:true});
    const response = typeof result==="string" ? result
      : result.deliveries?.length ? [...new Set(result.deliveries)].join("\n\n") : result.response;
    if (response && response.trim()) {
      await deliver(user, `💡 ${response}`);
      console.log(`💡 [${rule.userId}] Proactive: ${rule.name}`);
      return true;
    }
  } catch (e) {
    console.error(`❌ Proactive rule failed (${rule.name}):`, e.message);
  }
}

// Check if any proactive rules should fire right now
async function checkProactiveRules() {
  const rules = loadProactiveRules();
  if (rules.length === 0) return;

  const now = new Date();
  const currentWeekday = now.toLocaleDateString("de-DE", { weekday: "long" }).toLowerCase();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const config = loadUsersConfig();

  for (const rule of rules) {
    if (!rule.enabled) continue;

    // Check if time matches (within 5 min window)
    const ruleHour = rule.hour ?? -1;
    const ruleMinute = rule.minute ?? 0;
    if (ruleHour < 0 || ruleHour > 23) continue;

    const timeDiff = (currentHour * 60 + currentMinute) - (ruleHour * 60 + ruleMinute);
    if (timeDiff < 0 || timeDiff >= 5) continue; // Only fire within 5-min window

    // Check weekday filter
    if (rule.weekdays && rule.weekdays.length > 0) {
      if (!rule.weekdays.includes(currentWeekday)) continue;
    }

    // Check if already sent today
    const sentKey = `proactive:${rule.userId}:${rule.id}:${localDateKey(now)}`;
    const legacyKey=rules.filter(r=>r.id===rule.id).length===1 ? `${rule.id}:${now.toISOString().split("T")[0]}` : undefined;

    // Find user
    const user = config.users[rule.userId];
    if (!user || !user.chat_id) continue;

    if(!claimDelivery(REMINDER_SENT_FILE,sentKey,legacyKey)) continue;
    let success=false;
    try { success=Boolean(await executeProactiveRule(rule,user)); }
    finally {finishDelivery(REMINDER_SENT_FILE,sentKey,success);}
  }
}

// Analyze habits log and suggest new proactive rules
async function analyzeHabits() {
  const lastAnalysis = loadLastAnalysis();
  const now = new Date();

  // Only run once per day
  if (lastAnalysis.lastRun) {
    const lastRun = new Date(lastAnalysis.lastRun);
    if (now.getTime() - lastRun.getTime() < HABITS_ANALYSIS_INTERVAL) return;
  }

  const config = loadUsersConfig();
  const existingRules = loadProactiveRules();
  const proposedRules = [];

  for (const [userId, user] of Object.entries(config.users)) {
    if (!user.chat_id) continue;

    // Read habits log
    const habitsFile = path.join(workspace, "users", userId, "memory", "habits_log.json");
    if (!fs.existsSync(habitsFile)) continue;

    let log;
    try { log = JSON.parse(fs.readFileSync(habitsFile, "utf-8")); } catch (_) { continue; }
    if (log.length < 14) continue; // Need at least 2 weeks of data

    // Analyze patterns: find tools used at similar times on similar days
    const patterns = {};
    for (const entry of log) {
      const key = `${entry.weekday}:${entry.hour}:${entry.tool}`;
      if (!patterns[key]) patterns[key] = 0;
      patterns[key]++;
    }

    // Find patterns that occur 3+ times (strong habit)
    for (const [key, count] of Object.entries(patterns)) {
      if (count < 3) continue;

      const [weekday, hour, tool] = key.split(":");
      const ruleId = `habit:${userId}:${weekday}:${hour}:${tool}`;

      // Skip if already a rule (confirmed or rejected)
      if (existingRules.some(r => r.id === ruleId)) continue;

      // Skip if already suggested and rejected
      if (lastAnalysis.rejected && lastAnalysis.rejected.includes(ruleId)) continue;

      // Build suggestion prompt based on tool
      let prompt = "";
      let name = "";
      let description = "";
      switch (tool) {
        case "weather":
          prompt = "Wie ist das Wetter heute?";
          name = `Wetter ${weekday}s um ${hour} Uhr`;
          description = "dem Wetter";
          break;
        case "calendar":
          prompt = "Was steht heute an?";
          name = `Termine ${weekday}s um ${hour} Uhr`;
          description = "deinen Terminen";
          break;
        case "news":
          prompt = "Was gibt es Neues? Kurze Zusammenfassung.";
          name = `Nachrichten ${weekday}s um ${hour} Uhr`;
          description = "Nachrichten";
          break;
        case "notes":
          prompt = "Welche Notizen habe ich? Kurze Übersicht.";
          name = `Notizen ${weekday}s um ${hour} Uhr`;
          description = "deinen Notizen";
          break;
        case "lists":
          prompt = "Zeig mir meine offenen Listen.";
          name = `Listen-Übersicht ${weekday}s um ${hour} Uhr`;
          description = "deinen Listen";
          break;
        case "music":
          prompt = "Spiel Musik (letzter Sender).";
          name = `Musik ${weekday}s um ${hour} Uhr`;
          description = "Musik";
          break;
        case "flashcards":
          prompt = "Habe ich fällige Lernkarten? Zeig mir den Status.";
          name = `Lernkarten-Check ${weekday}s um ${hour} Uhr`;
          description = "deinen Lernkarten";
          break;
        case "expenses":
          prompt = "Wie viel habe ich diese Woche ausgegeben? Kurze Zusammenfassung.";
          name = `Ausgaben-Check ${weekday}s um ${hour} Uhr`;
          description = "deinen Ausgaben";
          break;
        case "weekplanner":
          prompt = "Gib mir eine Wochenübersicht.";
          name = `Wochenübersicht ${weekday}s um ${hour} Uhr`;
          description = "der Wochenplanung";
          break;
        default:
          continue; // Unknown tools don't get proactive suggestions
      }

      // Send suggestion to user
      try {
        const msg = `🧠 Mir ist aufgefallen dass du ${weekday}s gegen ${hour} Uhr oft nach ${description} fragst. Soll ich dir das automatisch schicken? Antworte mit "Ja" oder "Nein".`;
        await bot.api.sendMessage({ chat_id: user.chat_id, text: msg });
        console.log(`🧠 [${userId}] Habit suggestion: ${name}`);

        // Store as pending rule
        const proposed = {
          id: ruleId,
          userId,
          name,
          prompt,
          hour: parseInt(hour, 10),
          minute: 0,
          weekdays: [weekday],
          enabled: false, // Not active until confirmed
          pending_confirmation: true,
          suggested_at: now.toISOString(),
        };
        existingRules.push(proposed); proposedRules.push(proposed);
      } catch (e) {
        console.error(`❌ [${userId}] Habit suggestion failed:`, e.message);
      }
    }
  }

  saveProactiveRules(proposedRules);
  lastAnalysis.lastRun = now.toISOString();
  saveLastAnalysis(lastAnalysis);
}

// Handle habit confirmation/rejection responses
function isHabitConfirmation(text) {
  const lower = text.trim().toLowerCase();
  if (lower === "ja" || lower === "yes" || lower === "ok" || lower === "gerne" || lower === "mach das") return true;
  if (lower === "nein" || lower === "no" || lower === "nicht" || lower === "lass das" || lower === "nö") return false;
  return null;
}

// Hook into message handler to catch habit confirmations
function checkHabitConfirmation(userId, text) {
  const confirmation = isHabitConfirmation(text);
  if (confirmation === null) return false; // Not a yes/no answer

  return updateJson(PROACTIVE_RULES_FILE,[],rules=>{
  const pendingRule = rules.find(r => r.userId === userId && r.pending_confirmation);
  if (!pendingRule) return false; // No pending suggestion for this user

  if (confirmation) {
    // Activate the rule
    pendingRule.enabled = true;
    pendingRule.pending_confirmation = false;
    pendingRule.confirmed_at = new Date().toISOString();

    return { confirmed: true, name: pendingRule.name };
  } else {
    // Reject — remove from rules, add to rejected list
    const idx = rules.indexOf(pendingRule);
    rules.splice(idx, 1);


    const lastAnalysis = loadLastAnalysis();
    if (!lastAnalysis.rejected) lastAnalysis.rejected = [];
    lastAnalysis.rejected.push(pendingRule.id);
    saveLastAnalysis(lastAnalysis);
    return { confirmed: false, name: pendingRule.name };
  }
  });
}


return { checkProactiveRules, analyzeHabits, checkHabitConfirmation };
}
