import ical from "node-ical";
export function eventsForDate(parsed, date) {
  const from=new Date(date);from.setHours(0,0,0,0);
  const to=new Date(date);to.setHours(23,59,59,999);
  const events=[];
  for(const event of Object.values(parsed)) {
    if(event.type!=="VEVENT" || event.status==="CANCELLED") continue;
    const occurrences=ical.expandRecurringEvent(event,{from,to,expandOngoing:true,excludeExdates:true,includeOverrides:true});
    for(const occurrence of occurrences) {
      if(new Date(occurrence.start)>to || (new Date(occurrence.end)<=from && +occurrence.start!==+from)) continue;
      events.push({uid:event.uid,summary:occurrence.summary || event.summary,start:new Date(occurrence.start),end:new Date(occurrence.end),datetype:occurrence.isFullDay?"date":event.datetype});
    }
  }
  return events.sort((a,b)=>a.datetype===b.datetype ? a.start-b.start : a.datetype==="date"?-1:1);
}
