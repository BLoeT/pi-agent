import { getExecutionMeta } from '../lib/users.js';

/** Wrap the shared runtime, preserving the SDK's authenticated stream function. */
export function configureModelRequests(runtime, queue, maxOutputTokens = 8192, {log = console.log, now = () => performance.now(), meta = getExecutionMeta} = {}) {
  const stream = runtime.streamSimple.bind(runtime);
  runtime.streamSimple = async (model, context, options = {}) => {
    const info = meta();
    const started = now();
    const release = await queue.acquire('model',{signal:options.signal,background:info.scheduled});
    const queueMs=Math.round(now()-started);
    try {
      const modelLimit=Number.isInteger(model.maxTokens) && model.maxTokens>0 ? model.maxTokens : maxOutputTokens;
      const requested=Number.isInteger(options.maxTokens) && options.maxTokens>0 ? options.maxTokens : maxOutputTokens;
      const maxTokens = Math.min(maxOutputTokens,modelLimit,requested);
      const result = await stream(model,context,{...options,maxTokens});
      // result() observes completion without consuming or buffering the event iterator.
      Promise.resolve(result.result()).then(release,release);
      try { log(JSON.stringify({event:'model_queue_duration',request_id:info.requestId,
        queue_ms:queueMs,background:info.scheduled,max_output_tokens:maxTokens})); } catch {}
      return result;
    } catch (error) { release(); throw error; }
  };
}
