import { clientError } from "../../shared/errors.js";

/** HTTP owns framing; the chat service only emits structured events. */
export function createResponder(res, stream, requestId) {
  let opened = false;
  const open = () => {
    if (!stream || opened || res.destroyed) return;
    opened = true;
    res.set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();
  };
  const event = data => {
    if (!stream || res.destroyed || res.writableEnded) return;
    open();
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  const end = () => {
    if (!res.destroyed && !res.writableEnded) res.end("data: [DONE]\n\n");
  };
  return {
    open,
    event,
    complete(result) {
      if (res.destroyed || res.writableEnded) return;
      if (stream) {
        event({ done: true, full_text: result.response, full_thinking: result.thinking, ...(result.truncated ? {truncated:true} : {}) });
        end();
      } else res.json(result);
    },
    error(error) {
      if (res.destroyed || res.writableEnded) return;
      const failure = clientError(error);
      failure.body.request_id = requestId;
      if (opened) { event(failure.body); end(); }
      else res.status(failure.status).json(failure.body);
    },
  };
}
