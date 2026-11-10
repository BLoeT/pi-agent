import { getToolSignal } from "./users.js";
export async function fetchResponse(url, options = {}, {signal, timeout=30000} = {}) {
  signal=signal || getToolSignal();
  return fetch(url, {...options, signal: AbortSignal.any([AbortSignal.timeout(timeout), ...(signal ? [signal] : []), ...(options.signal ? [options.signal] : [])])});
}
export async function fetchJson(url, options = {}, policy = {}) {
  const response=await fetchResponse(url,options,policy);
  const data=await response.json();
  if(!response.ok) throw new Error(data.error || data.description || `HTTP ${response.status}`);
  return data;
}
