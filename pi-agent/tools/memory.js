import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { recordInteraction } from "../lib/interactions.js";
import { resolveWithin } from "../lib/security.js";
import { getCurrentUserId, getUserWorkspacePath } from "../lib/users.js";
import { loadMemories, searchMemories, changeMemory, MemoryInputError } from "../lib/memory-store.js";

const actions = ['remember','recall','profile','update','pin','unpin','forget','forget_all','summarize_session','log_interaction'];
const reply = value => ({content:[{type:'text',text:JSON.stringify(value)}],details:{}});

export default defineTool({
  name: "memory", label: "Memory",
  description: "Dauerhaftes Nutzergedächtnis. remember speichert; core:true für wichtiges Grundwissen, das jede Session begleitet (max. 20 Fakten). recall sucht weitere Erinnerungen, profile zeigt Grundwissen. update korrigiert per id; pin/unpin nehmen einen Eintrag ins Grundwissen auf bzw. heraus (ohne Löschen). forget löscht per id oder Text, forget_all alles. summarize_session speichert eine Zusammenfassung. log_interaction ist nur für Kompatibilität; Server protokolliert Tools automatisch.",
  parameters: Type.Object({
    action: Type.String({description:actions.join(', ')}),
    text: Type.Optional(Type.String({maxLength:12000,description:'Fakt, neuer Inhalt bei update oder Suchtext für recall/forget'})),
    id: Type.Optional(Type.String({description:'Exakte Erinnerungs-ID aus recall/profile für update, pin, unpin oder forget'})),
    core: Type.Optional(Type.Boolean({description:'Wichtiges Grundwissen dauerhaft jeder Session mitgeben; bei remember/update'})),
    category: Type.Optional(Type.String({description:'preference, fact, relationship, interest, habit, session_summary'})),
    tool_used: Type.Optional(Type.String({description:'Nur Legacy log_interaction'})),
  }),
  execute: async (_callId, params) => {
    try {
      if (!actions.includes(params.action)) throw Error('Unbekannte Gedächtnisaktion');
      if (params.core !== undefined && typeof params.core !== 'boolean') throw Error('core muss boolean sein');
      if (params.action === 'log_interaction') {
        recordInteraction(params.tool_used?.trim());
        return reply({status:'ok',logged:true});
      }
      const file = resolveWithin(getUserWorkspacePath(getCurrentUserId()),'memory/long_term.json');
      if (params.action === 'recall' || params.action === 'profile') {
        const entries = loadMemories(file);
        let found = params.action === 'profile' ? entries.filter(entry => entry.core === true) : entries;
        if (params.category) found = found.filter(entry => entry.category === params.category);
        if (params.text?.trim()) {
          const exact = found.filter(entry => entry.text.toLowerCase().includes(params.text.trim().toLowerCase()));
          found = [...new Set([...exact,...searchMemories(found,params.text)])];
        } else found = [...found].reverse();
        return reply({status:'ok',memories:found.slice(0,20),total:found.length});
      }
      return reply(changeMemory(file,params));
    } catch (error) {
      // Never expose memory content or filesystem paths in a public error.
      return {content:[{type:'text',text:error instanceof MemoryInputError ? error.message : 'Gedächtnis konnte nicht geändert/gelesen werden. Prüfe Aktion, ID und Text; vorhandene Daten bleiben bei einem Speicherfehler erhalten.'}],details:{},isError:true};
    }
  },
});
