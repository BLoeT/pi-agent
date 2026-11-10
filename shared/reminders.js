const weekdays=["sonntag","montag","dienstag","mittwoch","donnerstag","freitag","samstag"];
export function nextReminder(recurrence, after=new Date()) {
  const date=new Date(after);
  date.setHours(recurrence.hour,recurrence.minute,0,0);
  if(recurrence.kind==="weekly") {
    let days=(recurrence.weekday-date.getDay()+7)%7;
    if(days===0 && date<=after) days=7;
    date.setDate(date.getDate()+days);
  } else if(date<=after) date.setDate(date.getDate()+1);
  return date.toISOString();
}
export function parseReminderTime(input,now=new Date()) {
  if(typeof input!=="string" || !input.trim()) throw new Error("Zeitpunkt erforderlich, z.B. morgen 08:00");
  const text=input.trim().toLowerCase();
  let match=text.match(/^(?:jeden tag|täglich|taeglich|jeden (sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag))\s+(?:um\s+)?(\d{1,2}):(\d{2})(?:\s*uhr)?$/);
  if(match) {
    const recurrence={kind:match[1]?"weekly":"daily",weekday:match[1]?weekdays.indexOf(match[1]):undefined,hour:+match[2],minute:+match[3]};
    if(recurrence.hour>23 || recurrence.minute>59) throw new Error("Ungültige Uhrzeit");
    return {due_at:nextReminder(recurrence,now),recurrence};
  }
  match=text.match(/^in\s+(\d+)\s*(sekunden?|minuten?|stunden?|tagen?|seconds?|minutes?|hours?)$/);
  if(match) {
    const count=+match[1], factor=/^(sek|sec)/.test(match[2])?1000:/^(min)/.test(match[2])?60000:/^(stund|hour)/.test(match[2])?3600000:86400000;
    if(count<1 || count*factor>366*86400000) throw new Error("Dauer muss zwischen einer Sekunde und einem Jahr liegen");
    return {due_at:new Date(+now+count*factor).toISOString()};
  }
  if(text==="sofort") return {due_at:now.toISOString()};
  match=text.match(/^(?:(heute|morgen|übermorgen|uebermorgen)\s+)?(?:um\s+)?(\d{1,2}):(\d{2})(?:\s*uhr)?$/);
  if(match) {
    if(+match[2]>23 || +match[3]>59) throw new Error("Ungültige Uhrzeit");
    const date=new Date(now);date.setHours(+match[2],+match[3],0,0);
    if(match[1] && match[1]!=="heute") date.setDate(date.getDate()+(match[1]==="morgen"?1:2));
    if(!match[1] && date<=now) date.setDate(date.getDate()+1);
    if(date<=now) throw new Error("Zeitpunkt liegt in der Vergangenheit");
    return {due_at:date.toISOString()};
  }
  match=text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(?:um\s+)?(\d{1,2}):(\d{2})$/);
  if(match) {
    const [day,month,year,hour,minute]=match.slice(1).map(Number);
    const date=new Date(year,month-1,day,hour,minute);
    if(date.getFullYear()!==year || date.getMonth()!==month-1 || date.getDate()!==day || hour>23 || minute>59) throw new Error("Ungültiger Zeitpunkt");
    if(date<=now) throw new Error("Zeitpunkt liegt in der Vergangenheit");
    return {due_at:date.toISOString()};
  }
  if(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(input.trim())) {
    const year=+input.slice(0,4),month=+input.slice(5,7),day=+input.slice(8,10);
    if(month<1 || month>12 || day<1 || day>new Date(year,month,0).getDate()) throw new Error("Ungültiges Datum");
    const date=new Date(input);
    if(Number.isNaN(+date) || date<=now) throw new Error("Ungültiger oder vergangener Zeitpunkt");
    return {due_at:date.toISOString()};
  }
  throw new Error("Zeitpunkt nicht eindeutig. Nutze z.B. morgen 08:00 oder jeden Montag um 09:00");
}
