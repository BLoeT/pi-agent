import fs from "node:fs";
import path from "node:path";
import { readJson, updateJson } from "../../shared/storage.js";
import { claimDelivery, finishDelivery, localDateKey } from "../../shared/delivery.js";
import { nextReminder } from "../../shared/reminders.js";

export function createReminderJobs({ workspace, bot, loadUsersConfig, deliver }) {
const REMINDER_SENT_FILE = path.join(workspace, "reminder_sent.json");

function loadSentReminders() { return readJson(REMINDER_SENT_FILE,{}); }

function parseIcsDtstart(line) {
  // Parse DTSTART:20260815T140000 or DTSTART;VALUE=DATE:20260815
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return null;
  const val = line.slice(colonIdx + 1).trim();
  if (val.length >= 15) {
    // DateTime: 20260815T140000
    const y = parseInt(val.slice(0, 4), 10);
    const m = parseInt(val.slice(4, 6), 10) - 1;
    const d = parseInt(val.slice(6, 8), 10);
    const h = parseInt(val.slice(9, 11), 10);
    const min = parseInt(val.slice(11, 13), 10);
    return new Date(y, m, d, h, min, 0);
  } else if (val.length >= 8) {
    // Date only: 20260815
    const y = parseInt(val.slice(0, 4), 10);
    const m = parseInt(val.slice(4, 6), 10) - 1;
    const d = parseInt(val.slice(6, 8), 10);
    return new Date(y, m, d, 9, 0, 0); // Default 9:00 for all-day
  }
  return null;
}

function parseTriggerMinutes(trigger) {
  // Parse TRIGGER:-PT1H or TRIGGER:-P1D or TRIGGER:-P1DT2H30M
  const match = trigger.match(/TRIGGER:\s*-P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!match) return null;
  const days = parseInt(match[1] || "0", 10);
  const hours = parseInt(match[2] || "0", 10);
  const mins = parseInt(match[3] || "0", 10);
  return days * 1440 + hours * 60 + mins;
}

function extractRemindersFromIcs(icsContent) {
  const reminders = [];
  const lines = icsContent.split(/\r?\n/);
  let inEvent = false;
  let inAlarm = false;
  let currentSummary = "";
  let currentDtstart = null;
  let currentTrigger = null;
  let currentUid = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "BEGIN:VEVENT") {
      inEvent = true;
      currentSummary = "";
      currentDtstart = null;
      currentUid = "";
    } else if (trimmed === "END:VEVENT") {
      inEvent = false;
      inAlarm = false;
    } else if (trimmed === "BEGIN:VALARM") {
      inAlarm = true;
      currentTrigger = null;
    } else if (trimmed === "END:VALARM") {
      if (inAlarm && currentDtstart && currentTrigger != null) {
        const reminderTime = new Date(currentDtstart.getTime() - currentTrigger * 60 * 1000);
        reminders.push({
          uid: currentUid,
          summary: currentSummary,
          eventTime: currentDtstart,
          triggerMinutes: currentTrigger,
          reminderTime,
        });
      }
      inAlarm = false;
      currentTrigger = null;
    } else if (inEvent && !inAlarm) {
      if (trimmed.startsWith("SUMMARY:")) {
        currentSummary = trimmed.slice(8);
      } else if (trimmed.startsWith("DTSTART")) {
        currentDtstart = parseIcsDtstart(trimmed);
      } else if (trimmed.startsWith("UID:")) {
        currentUid = trimmed.slice(4);
      }
    } else if (inAlarm) {
      if (trimmed.startsWith("TRIGGER:")) {
        currentTrigger = parseTriggerMinutes(trimmed);
      }
    }
  }
  return reminders;
}

function formatReminderDuration(minutes) {
  if (minutes >= 1440) {
    const days = Math.round(minutes / 1440);
    return days === 1 ? "in 1 Tag" : `in ${days} Tagen`;
  }
  if (minutes >= 60) {
    const hours = Math.round(minutes / 60);
    return hours === 1 ? "in 1 Stunde" : `in ${hours} Stunden`;
  }
  return `in ${minutes} Minuten`;
}

async function checkReminders() {
  const config = loadUsersConfig();
  const now = new Date();
  const sentReminders = loadSentReminders();
  let changed = false;

  for (const [userId, user] of Object.entries(config.users)) {
    if (!user.chat_id) continue;

    // Collect all calendar files for this user
    const calendarFiles = [];

    // Personal calendar
    const personalCal = path.join(workspace, "users", userId, "calendar.ics");
    if (fs.existsSync(personalCal)) calendarFiles.push(personalCal);

    // Shared group calendars
    if (user.groups) {
      for (const groupId of user.groups) {
        const sharedCal = path.join(workspace, "shared", groupId, "calendar.ics");
        if (fs.existsSync(sharedCal)) calendarFiles.push(sharedCal);
      }
    }

    for (const calFile of calendarFiles) {
      try {
        const content = fs.readFileSync(calFile, "utf-8");
        const reminders = extractRemindersFromIcs(content);

        for (const reminder of reminders) {
          // Check if reminder is due (within last 3 minutes window)
          const diff = now.getTime() - reminder.reminderTime.getTime();
          if (diff >= 0 && diff < 3 * 60 * 1000) {
            // Build unique key to avoid double-sending
            const key = `${userId}:${reminder.uid}:${reminder.triggerMinutes}`;
            if (sentReminders[key]) continue;

            // Send reminder
            const timeStr = reminder.eventTime.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
            const dateStr = reminder.eventTime.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
            const durationText = formatReminderDuration(reminder.triggerMinutes);
            const message = `⏰ Erinnerung: "${reminder.summary}" ${durationText} (${dateStr}, ${timeStr} Uhr)`;

            if(!claimDelivery(REMINDER_SENT_FILE,key)) continue;
            let success=false;
            try {
              await deliver(user,message);
              success=true;
              console.log(`🔔 [${userId}] Reminder sent: ${reminder.summary}`);
            } catch (e) {
              console.error(`❌ [${userId}] Reminder send failed:`, e.message);
            } finally {finishDelivery(REMINDER_SENT_FILE,key,success);}


          }
        }
      } catch (e) {
        // Skip unreadable calendar files
      }
    }
  }


}

async function checkPluginReminders() {
  const file=path.join(workspace,"data","reminders.json");
  const reminders=readJson(file,[]);
  const config=loadUsersConfig();
  for(const reminder of reminders) {
    if(!reminder.active || !reminder.due_at || Date.parse(reminder.due_at)>Date.now()) continue;
    const user=config.users[reminder.user];
    if(!user?.chat_id) continue;
    const key=`plugin:${reminder.user}:${reminder.id}:${reminder.due_at}`;
    if(!claimDelivery(REMINDER_SENT_FILE,key)) continue;
    let success=false;
    try {
      await deliver(user,`⏰ ${reminder.text}`);
      success=true;
      updateJson(file,[],current=>{
        const entry=current.find(r=>r.id===reminder.id && r.user===reminder.user);
        if(!entry || entry.due_at!==reminder.due_at) return;
        if(entry.recurrence) entry.due_at=nextReminder(entry.recurrence);
        else entry.active=false;
        entry.last_sent_at=new Date().toISOString();
      });
    } catch(error) {console.error("Reminder delivery failed:",error.message);}
    finally {finishDelivery(REMINDER_SENT_FILE,key,success);}
  }
}

return { checkReminders, checkPluginReminders };
}
