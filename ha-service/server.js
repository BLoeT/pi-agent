import express from "express";

const app = express();
app.use(express.json());

const HA_URL = process.env.HA_URL || "http://homeassistant:8123";
const HA_TOKEN = process.env.HA_TOKEN || "";

if (!HA_TOKEN) {
  console.warn("⚠️  HA_TOKEN nicht gesetzt – Home Assistant Requests werden fehlschlagen");
}

async function haFetch(path, options = {}) {
  const resp = await fetch(`${HA_URL}/api${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${HA_TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`HA API ${resp.status}: ${text || resp.statusText}`);
  }
  return resp.json();
}

// Health-Check
app.get("/health", async (_req, res) => {
  try {
    await haFetch("/");
    res.json({ status: "ok", ha: "connected" });
  } catch (e) {
    res.status(503).json({ status: "error", ha: "unreachable", message: e.message });
  }
});

app.post("/call_service", async (req, res) => {
  try {
    const { domain, service, entity_id, data } = req.body;
    if (!domain || !service) {
      return res.status(400).json({ error: "domain and service are required" });
    }
    const result = await haFetch(`/services/${domain}/${service}`, {
      method: "POST",
      body: JSON.stringify({ entity_id, ...data }),
    });
    res.json(result);
  } catch (e) {
    console.error("❌ call_service error:", e.message);
    res.status(502).json({ error: "Home Assistant request failed", message: e.message });
  }
});

app.get("/states", async (_req, res) => {
  try {
    const states = await haFetch("/states");
    res.json(states.map(s => ({ entity_id: s.entity_id, state: s.state, name: s.attributes?.friendly_name })));
  } catch (e) {
    console.error("❌ get_states error:", e.message);
    res.status(502).json({ error: "Home Assistant request failed", message: e.message });
  }
});

app.get("/states/:entity_id", async (req, res) => {
  try {
    const result = await haFetch(`/states/${req.params.entity_id}`);
    res.json(result);
  } catch (e) {
    console.error("❌ get_state error:", e.message);
    res.status(502).json({ error: "Home Assistant request failed", message: e.message });
  }
});

app.get("/services", async (_req, res) => {
  try {
    const result = await haFetch("/services");
    res.json(result);
  } catch (e) {
    console.error("❌ get_services error:", e.message);
    res.status(502).json({ error: "Home Assistant request failed", message: e.message });
  }
});

app.listen(8082, () => console.log("🏠 HA Service listening on :8082"));
