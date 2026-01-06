// api/server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const app = express();
const path = require("path");

/* -------- CORS -------- */
const allow = String(process.env.CORS_ORIGINS || "")
  .split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allow.length === 0 || allow.includes(origin)) cb(null, true);
    else cb(new Error("Not allowed by CORS"));
  }
}));

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());
app.use(morgan("combined"));
app.use(express.json());

// ---- Static frontend (Vite build) ----
const staticDir = path.join(__dirname, "static");
app.use(express.static(staticDir));

// SPA fallback: route everything not starting with /api to index.html
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(staticDir, "index.html"));
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,                    // generous; adjust later
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", limiter);

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false },
  max: 10,
});

/* -------- Health -------- */
app.get("/api/health", async (_req, res) => {
  try { const r = await pool.query("select 1 as ok"); res.json({ ok: true, db: r.rows[0].ok }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

/* -------- Activities (unchanged) -------- */
app.get("/api/activities", async (req, res) => {
  try {
    const { q = "", owner = "" } = req.query;
    const params = [];
    const conds = [];

    if (q) {
      const v = `%${String(q).toLowerCase()}%`;
      params.push(v, v, v, v);
      const a = params.length - 3, b = params.length - 2, c = params.length - 1, d = params.length;
      conds.push(`(lower(customer_name) LIKE $${a} OR lower(customer_id) LIKE $${b} OR lower(ticket_id) LIKE $${c} OR lower(description) LIKE $${d})`);
    }

    if (owner) {
      params.push(String(owner).toLowerCase());
      conds.push(`lower(owner) = $${params.length}`);
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const sql = `
      SELECT id, customer_name, customer_id, ticket_id, description, activity_types,
             owner, sales_owner, hours, assigned_date, activity_date, created_at
      FROM activity
      ${where}
      ORDER BY activity_date DESC, created_at DESC
      LIMIT 5000;`;

    const r = await pool.query(sql, params);
    res.json({ items: r.rows });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post("/api/activities", async (req, res) => {
  try {
    const b = req.body || {};
    const need = ["customer_name","customer_id","ticket_id","description","activity_types","owner","hours","assigned_date","activity_date"];
    for (const k of need) if (b[k]==null || b[k]==="" || (Array.isArray(b[k])&&b[k].length===0)) return res.status(400).json({ error:`Missing ${k}` });
    const sql = `
      INSERT INTO activity
      (customer_name, customer_id, ticket_id, description, activity_types,
       owner, sales_owner, hours, assigned_date, activity_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *;`;
    const r = await pool.query(sql, [
      b.customer_name, b.customer_id, b.ticket_id, b.description, b.activity_types,
      b.owner, b.sales_owner || null, Number(b.hours), b.assigned_date, b.activity_date
    ]);
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.put("/api/activities/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const b = req.body || {};
    // minimal validation (same fields you POST)
    const required = [
      "customer_name","customer_id","ticket_id","description",
      "activity_types","owner","hours","assigned_date","activity_date"
    ];
    for (const k of required) {
      if (b[k] == null || (Array.isArray(b[k]) && b[k].length === 0) || b[k] === "") {
        return res.status(400).json({ error: `Missing ${k}` });
      }
    }

    const sql = `
      UPDATE activity SET
        customer_name = $1,
        customer_id   = $2,
        ticket_id     = $3,
        description   = $4,
        activity_types= $5,
        owner         = $6,
        sales_owner   = $7,
        hours         = $8,
        assigned_date = $9,
        activity_date = $10
      WHERE id = $11
      RETURNING *;
    `;
    const params = [
      b.customer_name,
      b.customer_id,
      b.ticket_id,
      b.description,
      b.activity_types,
      b.owner,
      b.sales_owner || null,
      Number(b.hours),
      b.assigned_date,
      b.activity_date,
      id,
    ];
    const r = await pool.query(sql, params);
    if (r.rowCount === 0) return res.status(404).json({ error: "Not found" });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Delete one
app.delete("/api/activities/:id", async (req, res) => {
  try {
    const r = await pool.query("DELETE FROM activity WHERE id = $1", [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* -------- KPI -------- */

// GET rollup + stored overrides/ratings
app.get("/api/kpi", async (req, res) => {
  const { weekStart } = req.query;
  if (!weekStart) return res.status(400).json({ error: "weekStart is required (YYYY-MM-DD Monday)" });

  const sql = `
    WITH wk AS (
      SELECT *
      FROM activity
      -- Mon–Sun for calculation (weekend spillover included)
      WHERE activity_date BETWEEN $1::date AND ($1::date + interval '6 day')
    ),
    cust_types AS (
      SELECT
        owner,
        lower(btrim(owner)) AS owner_norm,
        customer_name,
        array_agg(DISTINCT t ORDER BY t) AS types
      FROM wk
      CROSS JOIN LATERAL unnest(activity_types) AS t
      GROUP BY owner, customer_name
    ),
    per_owner AS (
      SELECT
        owner_norm,
        MIN(owner) AS display_owner,
        string_agg(
          format('%s – %s', customer_name, array_to_string(types, ', ')),
          E'\n' ORDER BY customer_name
        ) AS desc_auto,
        count(DISTINCT customer_name) AS total_customers
      FROM cust_types
      GROUP BY owner_norm
    )
    SELECT
      p.display_owner AS owner,
      p.owner_norm,
      p.desc_auto,
      COALESCE(p.total_customers, 0) AS total_customers,
      k.ratings,
      k.desc_override,
      k.updated_at,
      k.locked
    FROM per_owner p
    LEFT JOIN kpi_week k
      ON k.owner_norm = p.owner_norm
    AND k.week_start = $1::date
    ORDER BY p.display_owner;
  `;


const r = await pool.query(sql, [weekStart]);
const rows = r.rows.map(x => ({
  owner: x.owner,
  totalActivities: Number(x.total_customers || 0),
  descAuto: x.desc_auto || "",
  ratings: x.ratings || {},
  descOverride: x.desc_override || null,
  updatedAt: x.updated_at || null,
  locked: !!x.locked
}));
res.json({ weekStart, rows });
});

// PUT save ratings + optional description override
app.put("/api/kpi", async (req, res) => {
  const { owner, weekStart, ratings = {}, descOverride = null } = req.body || {};
  if (!owner || !weekStart) {
    return res.status(400).json({ error: "owner and weekStart required" });
  }

    const sql = `
    INSERT INTO kpi_week (owner, week_start, ratings, desc_override, updated_at)
    VALUES ($1,$2,$3,$4, now())
    ON CONFLICT (owner_norm, week_start)
    DO UPDATE SET
      ratings       = EXCLUDED.ratings,
      desc_override = EXCLUDED.desc_override,
      updated_at    = now()
    WHERE NOT kpi_week.locked
    RETURNING *;
  `;

  try {
    const r = await pool.query(sql, [owner, weekStart, ratings, descOverride]);
    if (r.rowCount === 0) {
      return res.status(409).json({ error: "This KPI row is locked and cannot be edited." });
    }
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* -------- Daily Quote (Azure OpenAI) -------- */
const quoteCache = new Map(); // key: YYYY-MM-DD -> { quote, author, topic }
/* -------- Azure Facts (Azure OpenAI) -------- */
const azureFactsCache = new Map(); // key: YYYY-MM-DD -> { title, fact, source }

app.get("/api/quote", async (req, res) => {
  try {
    const AZ_EP  = process.env.AZURE_OPENAI_ENDPOINT;
    const AZ_KEY = process.env.AZURE_OPENAI_API_KEY;
    const AZ_DEP = process.env.AZURE_OPENAI_DEPLOYMENT;
    if (!AZ_EP || !AZ_KEY || !AZ_DEP) {
      return res.status(500).json({ error: "Azure OpenAI env vars missing" });
    }

    const today = new Date().toISOString().slice(0,10);
    const wantFresh = req.query.fresh === "1";

    if (!wantFresh && quoteCache.has(today)) {
      return res.json({ date: today, ...quoteCache.get(today) });
    }

    const url = `${AZ_EP}/openai/deployments/${AZ_DEP}/chat/completions?api-version=2024-10-01-preview`;
    const system =
      "Return a single, real, verifiable quote as strict JSON: {\"quote\":\"…\",\"author\":\"…\",\"topic\":\"…\"}. Hard rules:Output JSON only. No prose, no code fences, no extra keys.1.6–24 words. English. Exact wording from a known source. No paraphrase. 2. Author must be a real person. If unsure, pick another. 3.Never repeat any quote text or author used earlier in this conversation. 4. Enforce diversity: rotate century, region, gender, and field. Prefer non-overused authors. 5.Selection method: first randomly choose a century and region, then a fitting author, then a short quote. 6.topic must be a single lowercase noun capturing the theme, and must be within or about - knowledge, growth, spirit, kindness, learning, greatness, adversity, hardship. If any rule would be violated, reselect before output";
    const body = {
      messages: [
        { role: "system", content: system },
        { role: "user", content: "Give one new quote now. Use a different author and different quote than any you have produced for me in this chat. Apply the diversity and blacklist rules. Output only the JSON object." }
      ],
      temperature: 0.9,
      max_tokens: 120
    };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": AZ_KEY },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      return res.status(502).json({ error: "Azure OpenAI error", detail: await r.text() });
    }

    const j = await r.json();
    let parsed = {};
    try { parsed = JSON.parse(j?.choices?.[0]?.message?.content || "{}"); } catch {}

    const out = {
      quote:  parsed.quote  || "Be kind. It matters more than you think.",
      author: parsed.author || "Unknown",
      topic:  parsed.topic  || "kindness"
    };

    // update cache for same-day non-fresh calls
    quoteCache.set(today, out);
    res.json({ date: today, ...out });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* -------- Azure facts endpoint (mirrors quote handler) -------- */
app.get("/api/azure-facts", async (req, res) => {
  try {
    const AZ_EP  = process.env.AZURE_OPENAI_ENDPOINT;
    const AZ_KEY = process.env.AZURE_OPENAI_API_KEY;
    const AZ_DEP = process.env.AZURE_OPENAI_DEPLOYMENT;
    if (!AZ_EP || !AZ_KEY || !AZ_DEP) {
      return res.status(500).json({ error: "Azure OpenAI env vars missing" });
    }

    const today = new Date().toISOString().slice(0,10);
    const wantFresh = req.query.fresh === "1";

    if (!wantFresh && azureFactsCache.has(today)) {
      return res.json({ date: today, ...azureFactsCache.get(today) });
    }

    const url = `${AZ_EP}/openai/deployments/${AZ_DEP}/chat/completions?api-version=2024-10-01-preview`;
    const system =
      "Return a single, verified Microsoft Azure fact as strict JSON: " +
      "{\"title\":\"…\",\"fact\":\"…\",\"source\":\"…\"}. " +
      "Hard rules: Output JSON only. No prose, no code fences, no extra keys. " +
      "1) 'fact' is 1–2 sentences, senior-suitable. 2) 'source' must be an official Microsoft Learn or Microsoft Docs URL. " +
      "3) Avoid repeating the same fact wording within this conversation.";

    const body = {
      messages: [
        { role: "system", content: system },
        { role: "user", content: "Give one Azure fact now. Output only the JSON object with title, fact, source." }
      ],
      temperature: 0.9,
      max_tokens: 160
    };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": AZ_KEY },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      return res.status(502).json({ error: "Azure OpenAI error", detail: await r.text() });
    }

    const j = await r.json();
    let parsed = {};
    try { parsed = JSON.parse(j?.choices?.[0]?.message?.content || "{}"); } catch {}

    // If parse fails or fields are missing, return 502 instead of a fixed fallback to avoid “always same” repeats
    if (!parsed || typeof parsed !== "object" || !parsed.title || !parsed.fact || !parsed.source) {
      return res.status(502).json({ error: "Bad model JSON for azure-facts" });
    }

    const out = {
      title:  String(parsed.title),
      fact:   String(parsed.fact),
      source: String(parsed.source)
    };

    // mirror quote handler: always cache today's result
    azureFactsCache.set(today, out);

    res.json({ date: today, ...out });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* -------- Start -------- */
const port = process.env.PORT || 4000;

if (require.main === module) {

  // List owners from directory
app.get("/api/owners", async (_req, res) => {
  try {
    const r = await pool.query("SELECT name FROM owner_directory ORDER BY name");
    res.json({ items: r.rows.map(x => x.name) });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Upsert owner into directory
app.post("/api/owners", async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });
  try {
    const sql = `
      INSERT INTO owner_directory (name)
      VALUES ($1)
      ON CONFLICT (name_norm) DO UPDATE SET name = EXCLUDED.name
      RETURNING *;
    `;
    const r = await pool.query(sql, [name]);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
// ---- Serve React build (placed under ./static) ----
const STATIC_DIR = path.join(__dirname, "static");
app.use(express.static(STATIC_DIR));

app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(staticDir, "index.html"));
});

// SPA fallback: send index.html for non-API routes
// app.get("*", (req, res, next) => {
//   if (req.path.startsWith("/api/")) return next();
//   res.sendFile(path.join(STATIC_DIR, "index.html"));
// });

  app.listen(port, () => console.log(`API on http://localhost:${port}`));
}

module.exports = app;
