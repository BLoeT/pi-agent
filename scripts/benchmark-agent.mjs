if (process.env.RIBO_TEST_ISOLATED !== '1') throw Error('Isolated test container required');
import fs from 'node:fs';
import { createSessionStore } from '/app/services/sessions.js';
import { createChatService } from '/app/services/chat.js';
import { loadConfig } from '/app/config.js';
// Run only in a disposable container with tmpfs /workspace; see PERFORMANCE-RESULTS.md.
const originalFetch = globalThis.fetch;
const wire = [], pending = [];
globalThis.fetch = async (url, options) => {
  const isChat = String(url).endsWith('/api/chat') && options?.body;
  const body = isChat ? JSON.parse(options.body) : null;
  const started = performance.now();
  const response = await originalFetch(url, options);
  if (body) {
    const entry = { num_ctx: body.options?.num_ctx, num_predict: body.options?.num_predict,
      think: body.think, tool_count: body.tools?.length || 0,
      tool_chars: JSON.stringify(body.tools || []).length,
      message_chars: JSON.stringify(body.messages || []).length };
    wire.push(entry);
    pending.push(response.clone().text().then(text => {
      entry.wall_ms = Math.round(performance.now() - started);
      const last = text.trim().split('\n').map(line => JSON.parse(line)).findLast(p => p.done);
      for (const key of ['prompt_eval_count','prompt_eval_cached_count','prompt_eval_duration','eval_count','eval_duration','load_duration']) entry[key] = last?.[key];
    }));
  }
  return response;
};
fs.writeFileSync('/workspace/users.json', JSON.stringify({users:{perflab:{permissions:[]}},groups:{}}));
const sessions = createSessionStore(loadConfig());
const timings = [];
const chat = createChatService({sessions, log: line => timings.push(JSON.parse(line))});
const results=[];
try {
  for (const thinkingLevel of ['low','off']) {
    sessions.reset('perflab');
    for (let i=0;i<6;i++) {
      const before=wire.length;
      const result=await chat.prompt({userId:'perflab',requestId:`${thinkingLevel}-${i}`,message:'Wie viel ist 17 plus 25? Antworte nur mit der Zahl. Verwende keine Werkzeuge.',thinkingLevel});
      await Promise.all(pending);
      const row={thinkingLevel,warmup:i===0,quality_ok:result.response.trim()==='42',timing:timings.at(-1),wire:wire.slice(before)};
      results.push(row); console.log('BENCH_RESULT '+JSON.stringify(row));
    }
  }
} finally { await chat.close(); }
console.log('BENCH_SUMMARY '+JSON.stringify(results));
