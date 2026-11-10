/** Bounded SSE reader; accepts chunked UTF-8 and never exposes thinking to previews. */
export async function readAgentStream(response, onDelta = () => {}) {
  const decoder = new TextDecoder();
  let buffer='', text='', final=null, received=0;
  const line = value => {
    if (!value.startsWith('data:')) return;
    const data=value.slice(5).trim();
    if(!data || data==='[DONE]')return;
    const event=JSON.parse(data);
    if(event.error)throw Error('Agent konnte die Antwort nicht abschließen');
    if(typeof event.delta==='string') {text+=event.delta;onDelta(event.delta);}
    if(event.done) final={response:event.full_text ?? text,deliveries:[]};
  };
  if(!response.body)throw Error('Leere Agent-Antwort');
  for await(const chunk of response.body) {
    received+=chunk.byteLength;
    if(received>8*1024*1024)throw Error('Agent-Antwort zu groß');
    buffer+=decoder.decode(chunk,{stream:true});
    let newline;
    while((newline=buffer.indexOf('\n'))>=0) {line(buffer.slice(0,newline).replace(/\r$/,''));buffer=buffer.slice(newline+1);}
  }
  buffer+=decoder.decode();if(buffer)line(buffer);
  if(!final)throw Error('Agent-Verbindung vor dem Abschluss beendet');
  return final;
}
