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

/* -------- Tickets -------- */

// GET tickets (grouped by ticket_id from activities)
app.get("/api/tickets", async (req, res) => {
  try {
    const { q = "", owner = "", status = "" } = req.query;
    const params = [];
    const conds = [];

    if (q) {
      const v = `%${String(q).toLowerCase()}%`;
      params.push(v, v, v);
      conds.push(`(lower(a.ticket_id) LIKE $${params.length - 2} OR lower(a.customer_name) LIKE $${params.length - 1} OR lower(a.customer_id) LIKE $${params.length})`);
    }
    if (owner) {
      params.push(String(owner).toLowerCase());
      conds.push(`lower(a.owner) = $${params.length}`);
    }
    if (status) {
      params.push(String(status));
      conds.push(`t.status = $${params.length}`);
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const sql = `
      SELECT
        a.ticket_id,
        MAX(a.customer_name) AS customer_name,
        MAX(a.customer_id) AS customer_id,
        MAX(a.owner) AS owner,
        MAX(a.sales_owner) AS sales_owner,
        array_agg(DISTINCT x ORDER BY x) AS activity_types,
        COUNT(a.id)::int AS total_activities,
        SUM(a.hours)::numeric AS total_hours,
        MIN(a.assigned_date) AS assigned_date,
        MAX(a.activity_date) AS latest_activity_date,
        COALESCE(t.status, 'Open') AS status,
        tkr.proposal_quality,
        tkr.solution_accuracy,
        tkr.average_tat,
        tkr.stakeholder_satisfaction
      FROM activity a
      CROSS JOIN LATERAL unnest(a.activity_types) AS x
      LEFT JOIN ticket t ON t.ticket_id = a.ticket_id
      LEFT JOIN ticket_kpi_rating tkr ON tkr.ticket_id = a.ticket_id
      ${where}
      GROUP BY a.ticket_id, t.status, tkr.proposal_quality, tkr.solution_accuracy, tkr.average_tat, tkr.stakeholder_satisfaction
      ORDER BY MAX(a.activity_date) DESC
      LIMIT 5000;
    `;

    const r = await pool.query(sql, params);
    res.json({ items: r.rows });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// PUT ticket status
app.put("/api/tickets/:ticketId/status", async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { status } = req.body || {};
    if (!status || !["Open", "Closed"].includes(status)) {
      return res.status(400).json({ error: "Status must be Open or Closed" });
    }
    const sql = `
      INSERT INTO ticket (ticket_id, status, updated_at)
      VALUES ($1, $2, now())
      ON CONFLICT (ticket_id)
      DO UPDATE SET status = EXCLUDED.status, updated_at = now()
      RETURNING *;
    `;
    const r = await pool.query(sql, [ticketId, status]);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// GET activities for a specific ticket
app.get("/api/tickets/:ticketId/activities", async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, customer_name, customer_id, ticket_id, description, activity_types,
              owner, sales_owner, hours, assigned_date, activity_date, created_at
       FROM activity WHERE ticket_id = $1
       ORDER BY activity_date DESC, created_at DESC`,
      [req.params.ticketId]
    );
    res.json({ items: r.rows });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* -------- Ticket KPI Ratings -------- */

// PUT ticket KPI rating
app.put("/api/tickets/:ticketId/kpi", async (req, res) => {
  try {
    const { ticketId } = req.params;
    const b = req.body || {};

    // Ensure ticket exists
    await pool.query(
      `INSERT INTO ticket (ticket_id, status) VALUES ($1, 'Open') ON CONFLICT (ticket_id) DO NOTHING`,
      [ticketId]
    );

    const sql = `
      INSERT INTO ticket_kpi_rating (ticket_id, proposal_quality, solution_accuracy, average_tat, stakeholder_satisfaction, updated_at)
      VALUES ($1, $2, $3, $4, $5, now())
      ON CONFLICT (ticket_id)
      DO UPDATE SET
        proposal_quality = EXCLUDED.proposal_quality,
        solution_accuracy = EXCLUDED.solution_accuracy,
        average_tat = EXCLUDED.average_tat,
        stakeholder_satisfaction = EXCLUDED.stakeholder_satisfaction,
        updated_at = now()
      RETURNING *;
    `;
    const r = await pool.query(sql, [
      ticketId,
      b.proposal_quality ?? null,
      b.solution_accuracy ?? null,
      b.average_tat ?? null,
      b.stakeholder_satisfaction ?? null,
    ]);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* -------- Monthly KPI (computed from ticket ratings) -------- */

app.get("/api/kpi/monthly", async (req, res) => {
  try {
    const { month, year } = req.query;
    if (!month || !year) return res.status(400).json({ error: "month and year required" });

    const m = parseInt(month);
    const y = parseInt(year);
    const startDate = `${y}-${String(m).padStart(2, "0")}-01`;
    const endDate = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

    const sql = `
      SELECT
        a.owner,
        AVG(tkr.proposal_quality) AS avg_proposal_quality,
        AVG(tkr.solution_accuracy) AS avg_solution_accuracy,
        AVG(tkr.average_tat) AS avg_average_tat,
        AVG(tkr.stakeholder_satisfaction) AS avg_stakeholder_satisfaction,
        COUNT(DISTINCT a.ticket_id)::int AS rated_tickets
      FROM activity a
      JOIN ticket_kpi_rating tkr ON tkr.ticket_id = a.ticket_id
      WHERE a.activity_date >= $1::date AND a.activity_date < $2::date
      GROUP BY a.owner
      ORDER BY a.owner;
    `;
    const r = await pool.query(sql, [startDate, endDate]);
    const rows = r.rows.map(x => ({
      owner: x.owner,
      avgProposalQuality: x.avg_proposal_quality ? Number(x.avg_proposal_quality) : null,
      avgSolutionAccuracy: x.avg_solution_accuracy ? Number(x.avg_solution_accuracy) : null,
      avgAverageTat: x.avg_average_tat ? Number(x.avg_average_tat) : null,
      avgStakeholderSatisfaction: x.avg_stakeholder_satisfaction ? Number(x.avg_stakeholder_satisfaction) : null,
      ratedTickets: x.rated_tickets,
      monthlyWeightedScore: x.avg_proposal_quality && x.avg_solution_accuracy && x.avg_average_tat && x.avg_stakeholder_satisfaction
        ? Number(x.avg_proposal_quality) * 20 + Number(x.avg_solution_accuracy) * 20 + Number(x.avg_average_tat) * 15 + Number(x.avg_stakeholder_satisfaction) * 10
        : null,
      monthlyKpiRating: x.avg_proposal_quality && x.avg_solution_accuracy && x.avg_average_tat && x.avg_stakeholder_satisfaction
        ? (Number(x.avg_proposal_quality) * 20 + Number(x.avg_solution_accuracy) * 20 + Number(x.avg_average_tat) * 15 + Number(x.avg_stakeholder_satisfaction) * 10) / 65
        : null,
    }));
    res.json({ month: m, year: y, rows });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* -------- Quarterly KPI -------- */

// GET quarterly KPI
app.get("/api/kpi/quarterly", async (req, res) => {
  try {
    const { fy, quarter } = req.query;
    if (!fy || !quarter) return res.status(400).json({ error: "fy and quarter required" });

    const sql = `
      SELECT owner, owner_norm, financial_year, quarter,
             professional_behaviour, upskilling_certifications, updated_at
      FROM quarterly_kpi
      WHERE financial_year = $1 AND quarter = $2
      ORDER BY owner;
    `;
    const r = await pool.query(sql, [fy, quarter]);
    const rows = r.rows.map(x => ({
      owner: x.owner,
      financialYear: x.financial_year,
      quarter: x.quarter,
      professionalBehaviour: x.professional_behaviour ? Number(x.professional_behaviour) : null,
      upskillingCertifications: x.upskilling_certifications ? Number(x.upskilling_certifications) : null,
      updatedAt: x.updated_at,
      quarterlyWeightedScore: x.professional_behaviour && x.upskilling_certifications
        ? Number(x.professional_behaviour) * 20 + Number(x.upskilling_certifications) * 15
        : null,
      quarterlyKpiRating: x.professional_behaviour && x.upskilling_certifications
        ? (Number(x.professional_behaviour) * 20 + Number(x.upskilling_certifications) * 15) / 35
        : null,
    }));
    res.json({ fy, quarter, rows });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// PUT quarterly KPI
app.put("/api/kpi/quarterly", async (req, res) => {
  try {
    const { owner, financialYear, quarter, professionalBehaviour, upskillingCertifications } = req.body || {};
    if (!owner || !financialYear || !quarter) {
      return res.status(400).json({ error: "owner, financialYear, and quarter required" });
    }

    const sql = `
      INSERT INTO quarterly_kpi (owner, financial_year, quarter, professional_behaviour, upskilling_certifications, updated_at)
      VALUES ($1, $2, $3, $4, $5, now())
      ON CONFLICT (owner_norm, financial_year, quarter)
      DO UPDATE SET
        professional_behaviour = EXCLUDED.professional_behaviour,
        upskilling_certifications = EXCLUDED.upskilling_certifications,
        updated_at = now()
      RETURNING *;
    `;
    const r = await pool.query(sql, [owner, financialYear, quarter, professionalBehaviour ?? null, upskillingCertifications ?? null]);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* -------- Learning -------- */

// GET learning entries
app.get("/api/learning", async (req, res) => {
  try {
    const { q = "", owner = "", category = "", status = "" } = req.query;
    const params = [];
    const conds = [];

    if (q) {
      const v = `%${String(q).toLowerCase()}%`;
      params.push(v, v, v);
      conds.push(`(lower(topic) LIKE $${params.length - 2} OR lower(description) LIKE $${params.length - 1} OR lower(category) LIKE $${params.length})`);
    }
    if (owner) {
      params.push(String(owner).toLowerCase());
      conds.push(`lower(owner) = $${params.length}`);
    }
    if (category) {
      params.push(String(category).toLowerCase());
      conds.push(`lower(category) = $${params.length}`);
    }
    if (status) {
      params.push(String(status));
      conds.push(`status = $${params.length}`);
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const sql = `
      SELECT id, owner, date, topic, category, description, hours, status, source_link, completion_date, created_at
      FROM learning
      ${where}
      ORDER BY date DESC, created_at DESC
      LIMIT 5000;
    `;
    const r = await pool.query(sql, params);
    res.json({ items: r.rows });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// POST learning entry
app.post("/api/learning", async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.owner || !b.topic || !b.date) return res.status(400).json({ error: "owner, topic, and date required" });

    const sql = `
      INSERT INTO learning (owner, date, topic, category, description, hours, status, source_link, completion_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;
    const r = await pool.query(sql, [
      b.owner, b.date, b.topic, b.category || "", b.description || "",
      Number(b.hours || 0), b.status || "In Progress", b.source_link || "", b.completion_date || null
    ]);
    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// PUT learning entry
app.put("/api/learning/:id", async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.owner || !b.topic || !b.date) return res.status(400).json({ error: "owner, topic, and date required" });

    const sql = `
      UPDATE learning SET
        owner = $1, date = $2, topic = $3, category = $4, description = $5,
        hours = $6, status = $7, source_link = $8, completion_date = $9
      WHERE id = $10
      RETURNING *;
    `;
    const r = await pool.query(sql, [
      b.owner, b.date, b.topic, b.category || "", b.description || "",
      Number(b.hours || 0), b.status || "In Progress", b.source_link || "", b.completion_date || null,
      req.params.id
    ]);
    if (r.rowCount === 0) return res.status(404).json({ error: "Not found" });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// DELETE learning entry
app.delete("/api/learning/:id", async (req, res) => {
  try {
    const r = await pool.query("DELETE FROM learning WHERE id = $1", [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* -------- Dashboard Summary -------- */

app.get("/api/dashboard", async (req, res) => {
  try {
    const { month, year } = req.query;
    if (!month || !year) return res.status(400).json({ error: "month and year required" });

    const m = parseInt(month);
    const y = parseInt(year);
    const startDate = `${y}-${String(m).padStart(2, "0")}-01`;
    const endDate = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

    // Determine financial year and quarter
    const fyStart = m >= 4 ? y : y - 1;
    const fy = `FY${fyStart}-${String(fyStart + 1).slice(2)}`;
    let quarter;
    if (m >= 4 && m <= 6) quarter = "Q1";
    else if (m >= 7 && m <= 9) quarter = "Q2";
    else if (m >= 10 && m <= 12) quarter = "Q3";
    else quarter = "Q4";

    // Monthly KPI from ticket ratings
    const mkpi = await pool.query(`
      SELECT
        a.owner,
        AVG(tkr.proposal_quality) AS avg_pq,
        AVG(tkr.solution_accuracy) AS avg_sa,
        AVG(tkr.average_tat) AS avg_tat,
        AVG(tkr.stakeholder_satisfaction) AS avg_ss,
        COUNT(DISTINCT a.ticket_id)::int AS rated_tickets
      FROM activity a
      JOIN ticket_kpi_rating tkr ON tkr.ticket_id = a.ticket_id
      WHERE a.activity_date >= $1::date AND a.activity_date < $2::date
      GROUP BY a.owner
    `, [startDate, endDate]);

    // Quarterly KPI
    const qkpi = await pool.query(`
      SELECT owner, professional_behaviour, upskilling_certifications
      FROM quarterly_kpi
      WHERE financial_year = $1 AND quarter = $2
    `, [fy, quarter]);

    // Total hours per owner
    const hours = await pool.query(`
      SELECT owner, SUM(hours)::numeric AS total_hours
      FROM activity
      WHERE activity_date >= $1::date AND activity_date < $2::date
      GROUP BY owner
    `, [startDate, endDate]);

    // Ticket summary per owner
    const tickets = await pool.query(`
      SELECT
        a.owner,
        COUNT(DISTINCT a.ticket_id)::int AS total_tickets,
        COUNT(DISTINCT CASE WHEN t.status = 'Open' THEN a.ticket_id END)::int AS open_tickets,
        COUNT(DISTINCT CASE WHEN t.status = 'Closed' OR t.status IS NULL THEN a.ticket_id END)::int AS closed_tickets
      FROM activity a
      LEFT JOIN ticket t ON t.ticket_id = a.ticket_id
      WHERE a.activity_date >= $1::date AND a.activity_date < $2::date
      GROUP BY a.owner
    `, [startDate, endDate]);

    // Learning summary per owner
    const learning = await pool.query(`
      SELECT owner, COUNT(*)::int AS total_entries, SUM(hours)::numeric AS total_learning_hours
      FROM learning
      WHERE date >= $1::date AND date < $2::date
      GROUP BY owner
    `, [startDate, endDate]);

    // Combine all by owner
    const ownerSet = new Set();
    mkpi.rows.forEach(r => ownerSet.add(r.owner));
    qkpi.rows.forEach(r => ownerSet.add(r.owner));
    hours.rows.forEach(r => ownerSet.add(r.owner));
    tickets.rows.forEach(r => ownerSet.add(r.owner));
    learning.rows.forEach(r => ownerSet.add(r.owner));

    const mkpiMap = Object.fromEntries(mkpi.rows.map(r => [r.owner, r]));
    const qkpiMap = Object.fromEntries(qkpi.rows.map(r => [r.owner, r]));
    const hoursMap = Object.fromEntries(hours.rows.map(r => [r.owner, r]));
    const ticketsMap = Object.fromEntries(tickets.rows.map(r => [r.owner, r]));
    const learningMap = Object.fromEntries(learning.rows.map(r => [r.owner, r]));

    const rows = [...ownerSet].sort().map(owner => {
      const mk = mkpiMap[owner] || {};
      const qk = qkpiMap[owner] || {};
      const h = hoursMap[owner] || {};
      const t = ticketsMap[owner] || {};
      const l = learningMap[owner] || {};

      const avgPQ = mk.avg_pq ? Number(mk.avg_pq) : null;
      const avgSA = mk.avg_sa ? Number(mk.avg_sa) : null;
      const avgTAT = mk.avg_tat ? Number(mk.avg_tat) : null;
      const avgSS = mk.avg_ss ? Number(mk.avg_ss) : null;

      const monthlyWeighted = (avgPQ && avgSA && avgTAT && avgSS)
        ? avgPQ * 20 + avgSA * 20 + avgTAT * 15 + avgSS * 10 : null;
      const monthlyKpiRating = monthlyWeighted ? monthlyWeighted / 65 : null;

      const pb = qk.professional_behaviour ? Number(qk.professional_behaviour) : null;
      const uc = qk.upskilling_certifications ? Number(qk.upskilling_certifications) : null;
      const quarterlyWeighted = (pb && uc) ? pb * 20 + uc * 15 : null;
      const quarterlyKpiRating = quarterlyWeighted ? quarterlyWeighted / 35 : null;

      return {
        owner,
        monthlyKpi: {
          avgProposalQuality: avgPQ,
          avgSolutionAccuracy: avgSA,
          avgAverageTat: avgTAT,
          avgStakeholderSatisfaction: avgSS,
          ratedTickets: mk.rated_tickets || 0,
          monthlyWeightedScore: monthlyWeighted,
          monthlyKpiRating,
        },
        quarterlyKpi: {
          professionalBehaviour: pb,
          upskillingCertifications: uc,
          quarterlyWeightedScore: quarterlyWeighted,
          quarterlyKpiRating,
        },
        tickets: {
          total: t.total_tickets || 0,
          open: t.open_tickets || 0,
          closed: t.closed_tickets || 0,
        },
        learning: {
          totalEntries: l.total_entries || 0,
          totalHours: l.total_learning_hours ? Number(l.total_learning_hours) : 0,
        },
        totalHours: h.total_hours ? Number(h.total_hours) : 0,
      };
    });

    res.json({ month: m, year: y, fy, quarter, rows });
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

  app.listen(port, () => console.log(`API on http://localhost:${port}`));
}

module.exports = app;
