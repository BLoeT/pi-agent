import { HttpError } from "../../shared/errors.js";

/** Per-key queue: foreground first, with a background slot after three foreground grants. */
export class RequestQueue {
  #states = new Map();
  #closed = false;
  constructor(maxPending = 4) { this.maxPending = maxPending; }
  pending(key) { const state = this.#states.get(key); return state ? state.waiting.length + Number(state.running) : 0; }
  close() {
    this.#closed = true;
    for (const [key,state] of this.#states) {
      for (const entry of state.waiting.splice(0)) {
        entry.cleanup();
        entry.reject(new HttpError(503,"Dienst wird neu gestartet","SHUTTING_DOWN"));
      }
      if (!state.running) this.#states.delete(key);
    }
  }
  acquire(key, {signal, background = false} = {}) {
    if (this.#closed) return Promise.reject(new HttpError(503,"Dienst wird neu gestartet","SHUTTING_DOWN"));
    if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('Abgebrochen','AbortError'));
    if (this.pending(key) >= this.maxPending) return Promise.reject(new HttpError(429,"Zu viele wartende Nachrichten","QUEUE_FULL"));
    let state = this.#states.get(key);
    if (!state) { state = {running:false,waiting:[],burst:0}; this.#states.set(key,state); }
    return new Promise((resolve,reject) => {
      const entry = {resolve,reject,background,cleanup:()=>signal?.removeEventListener('abort',abort)};
      const abort = () => {
        const index = state.waiting.indexOf(entry);
        if (index < 0) return;
        state.waiting.splice(index,1); entry.cleanup();
        reject(signal.reason || new DOMException('Abgebrochen','AbortError'));
        if (!state.running && !state.waiting.length) this.#states.delete(key);
      };
      state.waiting.push(entry);
      signal?.addEventListener('abort',abort,{once:true});
      this.#dispatch(key,state);
    });
  }
  #dispatch(key,state) {
    if (state.running || !state.waiting.length || this.#closed) return;
    const foreground = state.waiting.findIndex(entry=>!entry.background);
    const background = state.waiting.findIndex(entry=>entry.background);
    const index = background >= 0 && (foreground < 0 || state.burst >= 3) ? background : foreground;
    const entry = state.waiting.splice(index,1)[0]; entry.cleanup();
    state.burst = entry.background ? 0 : state.burst + 1;
    state.running = true;
    let released = false;
    entry.resolve(() => {
      if (released) return;
      released = true; state.running = false;
      if (!state.waiting.length) this.#states.delete(key);
      else this.#dispatch(key,state);
    });
  }
}
