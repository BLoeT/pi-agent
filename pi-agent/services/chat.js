import { RequestQueue } from "./request-queue.js";
import { collectResponse } from "./response.js";
import { preparePrompt } from "./prompt-context.js";
import { trimHistory } from "../lib/context.js";
import { saveIncomingImage, attachmentPrompt } from "../lib/uploads.js";
import { runAsUser, getDeferredDeliveries } from "../lib/users.js";
import { HttpError } from "../../shared/errors.js";

export function createChatService({ sessions, maxPending = 4, prepare = preparePrompt, log = console.log, now = () => performance.now() }) {
  const queue = new RequestQueue(maxPending);
  const active = new Map();

  async function prompt({ userId, requestId, message, image, imageName, thinkingLevel, scheduled, signal, onReady, onEvent }) {
    const received = now();
    const release = await queue.acquire(userId, {signal, background:Boolean(scheduled)});
    const started = now();
    const metrics = { queue_ms: Math.round(started - received), session_ms: null,
      first_thinking_ms: null, first_text_ms: null, tool_calls: 0, tool_ms: 0, model_rounds: 0 };
    let outcome = "error";
    let firstDeltaMs = null;
    const controller = new AbortController();
    const abortSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let finished;
    const done = new Promise(resolve => { finished = resolve; });
    const entry = { controller, done };
    active.set(userId, entry);
    let session;
    const abort = () => { void session?.abort().catch(() => {}); };
    try {
      abortSignal.throwIfAborted();
      let attachment;
      const sessionStarted = now();
      session = await sessions.get(userId);
      metrics.session_ms = Math.round(now() - sessionStarted);
      if (image && session.model && !session.model.input?.includes("image")) throw new HttpError(400,"Das gewählte Modell kann keine Bilder analysieren. Bitte ein Modell mit Bildverständnis wählen.","MODEL_NO_VISION");
      attachment = image ? saveIncomingImage(userId,image,{name:imageName}) : null;
      abortSignal.throwIfAborted();
      abortSignal.addEventListener("abort", abort, { once: true });
      if (thinkingLevel) session.setThinkingLevel(thinkingLevel);
      const messages = session.agent?.state?.messages;
      if (Array.isArray(messages)) session.agent.state.messages = trimHistory(messages);
      onReady?.();
      if(attachment)onEvent?.({upload:{name:attachment.name,relative:attachment.relative}});
      const result = await runAsUser(userId, () => collectResponse(session, attachmentPrompt(prepare(userId, message, scheduled),attachment), {
        image,
        onEvent,
        now,
        onMetric: event => {
          if (event.type === "first_thinking") metrics.first_thinking_ms = Math.round(now() - received);
          if (event.type === "first_text") metrics.first_text_ms = Math.round(now() - received);
          if (event.type === "tool_start") metrics.tool_calls++;
          if (event.type === "tool_end") metrics.tool_ms += event.ms ?? 0;
          if (event.type === "model_round") metrics.model_rounds++;
        },
        onFirstDelta: () => { firstDeltaMs = Math.round(now() - started); },
      }), {attachment});
      abortSignal.throwIfAborted();
      outcome = "ok";
      return { ...result, ...(attachment?{upload:{name:attachment.name,relative:attachment.relative}}:{}), deliveries: [...getDeferredDeliveries()] };
    } finally {
      abortSignal.removeEventListener("abort", abort);
      if (active.get(userId) === entry) active.delete(userId);
      release();
      finished();
      // Telemetry must never change the result of an already completed request.
      try {
        log(JSON.stringify({ event: "prompt_duration", request_id: requestId,
          ms: Math.round(now() - started), total_ms: Math.round(now() - received),
          first_delta_ms: firstDeltaMs, ...metrics, tool_ms: Math.round(metrics.tool_ms),
          outcome: abortSignal.aborted ? "cancelled" : outcome, image: Boolean(image) }));
      } catch {}
    }
  }

  async function cancel(userId) {
    const entry = active.get(userId);
    if (!entry) return false;
    entry.controller.abort();
    await entry.done;
    return true;
  }

  function reset(userId) {
    if (queue.pending(userId)) throw new HttpError(409, "Bitte laufende Antwort zuerst stoppen", "SESSION_BUSY");
    sessions.reset(userId);
  }

  async function setModel(userId,id) {
    if(queue.pending(userId))throw new HttpError(409,"Bitte die laufende Antwort abwarten oder zuerst stoppen.","SESSION_BUSY");
    const release=await queue.acquire(userId);
    try{return await sessions.setModel(userId,id);}finally{release();}
  }

  async function close() {
    queue.close();
    await Promise.allSettled([...active.keys()].map(cancel));
    sessions.dispose();
  }

  return { prompt, cancel, reset, close, setModel, listModels:(userId,refresh)=>sessions.listModels(userId,refresh) };
}
