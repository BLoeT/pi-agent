import { scheduleJob } from "./background.js";
import { createReminderJobs } from "./jobs/reminders.js";
import { createProactiveJobs } from "./jobs/proactive.js";
import { redact } from "../shared/errors.js";

/** Schedule composition only; individual jobs own their state transitions. */
export function startBackgroundServices({
  bot,
  loadUsersConfig,
  sendToAgent,
  workspace = "/workspace",
  start = true,
  deliver = async (user, text) => bot.api.sendMessage({ chat_id: user.chat_id, text }),
}) {
  const dependencies = { bot, loadUsersConfig, sendToAgent, workspace, deliver };
  const reminders = createReminderJobs(dependencies);
  const proactive = createProactiveJobs(dependencies);
  const stops = [];
  const onError = error => console.error(JSON.stringify({ event: "scheduled_job_failed", message: redact(error.message) }));
  if (start) {
    stops.push(
      scheduleJob(reminders.checkReminders, 2 * 60000, 10000, onError),
      scheduleJob(reminders.checkPluginReminders, 30000, 12000, onError),
      scheduleJob(proactive.checkProactiveRules, 5 * 60000, 30000, onError),
      scheduleJob(proactive.analyzeHabits, 24 * 3600000, 60000, onError),
    );
    console.log(JSON.stringify({ event: "scheduler_ready" }));
  }
  return { ...reminders, ...proactive, stop: () => stops.forEach(stop => stop()) };
}
