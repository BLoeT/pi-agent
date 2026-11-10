export function singleFlight(task, onError = console.error) {
  let running = false;
  return async (...args) => {
    if (running) return false;
    running = true;
    try { await task(...args); return true; }
    catch (error) { onError(error); return false; }
    finally { running = false; }
  };
}

export function scheduleJob(task, interval, initialDelay, onError) {
  const run = singleFlight(task, onError);
  const first = setTimeout(run, initialDelay);
  const repeat = setInterval(run, interval);
  return () => { clearTimeout(first); clearInterval(repeat); };
}
