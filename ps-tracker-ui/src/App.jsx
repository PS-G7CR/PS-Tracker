import { useMemo, useState, useEffect, useCallback, useRef, useLayoutEffect, createContext, useContext } from "react";

/* ================== Constants ================== */

const csvCell = (v) => `"${(v ?? "").toString().replace(/"/g, '""')}"`;

const ACTIVITY_TYPES = [
  "SOW", "BOQ", "Call", "Architecture", "Workshop", "Demo", "Assist", "Implementation", "Others",
];

const LEARNING_CATEGORIES = [
  "Certification", "Training", "Workshop", "Webinar", "Self-Study", "Conference", "Hands-on Lab", "Other",
];

const LEARNING_STATUSES = ["In Progress", "Completed", "Dropped"];

const TICKET_KPI_FIELDS = [
  { key: "proposal_quality", label: "Proposal Quality & Timeliness", weight: 20 },
  { key: "solution_accuracy", label: "Solution Accuracy", weight: 20 },
  { key: "average_tat", label: "Average TAT", weight: 15 },
  { key: "stakeholder_satisfaction", label: "Stakeholder Satisfaction", weight: 10 },
];

const QUARTERLY_KPI_FIELDS = [
  { key: "professional_behaviour", label: "Professional Behaviour & Culture", weight: 20 },
  { key: "upskilling_certifications", label: "Upskilling & Certifications", weight: 15 },
];

const API = import.meta.env.VITE_API_BASE || "";

/* ================== Utils ================== */

const cx = (...xs) => xs.filter(Boolean).join(" ");
const todayISO = () => new Date().toISOString().slice(0, 10);
const isNonEmpty = (s) => !!s && String(s).trim().length > 0;
const to2 = (n) => Number(n ?? 0).toFixed(2);

function useStableScrollbar(ref) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => { el.style.scrollbarGutter = el.scrollHeight > el.clientHeight + 1 ? "stable" : "auto"; };
    update();
    const ro = new ResizeObserver(update); ro.observe(el);
    const mo = new MutationObserver(update); mo.observe(el, { childList: true, subtree: true });
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); mo.disconnect(); window.removeEventListener("resize", update); };
  }, [ref]);
}

function weekEndISO(weekStartISO) {
  const [y, m, d] = weekStartISO.split("-").map(Number);
  const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + 4);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function fmtShort(dStr) {
  if (!dStr) return "";
  const [y, m, d] = dStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

function weekStartISO(dStr) {
  const [y, m, d] = dStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay();
  const diff = (dow === 0 ? -6 : 1) - dow;
  dt.setDate(dt.getDate() + diff);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

const localISO = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;

function getFinancialYear(d) {
  const y = d.getFullYear();
  const m = d.getMonth();
  const fyStart = m >= 3 ? y : y - 1;
  return `FY${fyStart}-${String(fyStart + 1).slice(2)}`;
}

function getQuarter(d) {
  const m = d.getMonth();
  if (m >= 3 && m <= 5) return "Q1";
  if (m >= 6 && m <= 8) return "Q2";
  if (m >= 9 && m <= 11) return "Q3";
  return "Q4";
}

function daysSince(dateStr) {
  if (!dateStr) return 999;
  const [y, m, d] = dateStr.split("-").map(Number);
  const then = new Date(y, m - 1, d);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor((now - then) / 86400000);
}

/* ================== Global User Context ================== */

const UserContext = createContext({ currentUser: "", setCurrentUser: () => {}, ownerOptions: [] });

/* ================== Atoms ================== */

function TabButton({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      className={cx("px-4 py-2 text-sm rounded-full border transition-colors",
        active ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
      )}>
      {children}
    </button>
  );
}

const Th = ({ children, className = "" }) => <th className={cx("px-3 py-2 text-xs font-medium", className)}>{children}</th>;
const Td = ({ children, className = "" }) => <td className={cx("px-3 py-2 align-top", className)}>{children}</td>;
const Label = ({ children, helper }) => (
  <div className="flex items-baseline gap-2">
    <span className="text-xs font-medium text-slate-600">{children}</span>
    {helper && <span className="text-[10px] text-slate-500">{helper}</span>}
  </div>
);

/* ================== Page Transition ================== */

function TransitionStyles() {
  useEffect(() => {
    if (document.getElementById("page-trans-css")) return;
    const s = document.createElement("style");
    s.id = "page-trans-css";
    s.textContent = `
      .page-fade-in{ will-change:transform,opacity; backface-visibility:hidden; animation:pageEnter .18s cubic-bezier(.2,.7,.2,1) both; }
      @keyframes pageEnter { from{opacity:0;transform:translate3d(0,6px,0)} to{opacity:1;transform:translate3d(0,0,0)} }
      body.transitioning .animated-gradient{ animation-play-state:paused!important; }
    `;
    document.head.appendChild(s);
  }, []);
  return null;
}

function GradientStyles() {
  useEffect(() => {
    if (document.getElementById("animated-gradient-css")) return;
    const s = document.createElement("style");
    s.id = "animated-gradient-css";
    s.textContent = `
      .animated-gradient{
        background: radial-gradient(circle at 78% 38%, rgba(0,125,50,0.45) 0%, rgba(71,238,132,0.18) 30%, rgba(80,220,120,0) 60%),
          linear-gradient(135deg, #005a27ff 0%, #00b65eff 55%, #003222ff 100%);
        background-size:400% 400%; animation:gradientShift 18s ease infinite; min-height:100vh; will-change:background-position;
      }
      @keyframes gradientShift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
    `;
    document.head.appendChild(s);
  }, []);
  return null;
}

function PageTransition({ tab, children }) {
  return <div key={tab} className="page-fade-in">{children}</div>;
}

/* ================== Azure Styles & Components ================== */

function AzureShineStyles() {
  useEffect(() => {
    if (document.getElementById("azure-shine-css")) return;
    const s = document.createElement("style");
    s.id = "azure-shine-css";
    s.textContent = `
      .azure-a{display:inline-block;margin:0 .5px;padding:0;border:0;background:transparent;cursor:pointer;color:inherit;line-height:1;transform-origin:center;animation-name:azureTwinkle;animation-duration:var(--az-dur,4.5s);animation-timing-function:ease-in-out;animation-iteration-count:infinite;animation-fill-mode:both;transition:text-shadow .22s ease,transform .18s ease;filter:none}
      .azure-a:focus{outline:none}
      @keyframes azureTwinkle{0%,70%{text-shadow:none;transform:scale(1)}72%{text-shadow:0 0 3px #60a5fa,0 0 6px #3b82f6;transform:scale(.99)}80%{text-shadow:0 0 6px #60a5fa,0 0 12px #2563eb,0 0 18px #60a5fa;transform:scale(1.005)}90%{text-shadow:0 0 4px #60a5fa,0 0 10px #2563eb;transform:scale(1.002)}100%{text-shadow:none;transform:scale(1)}}
      .azure-a:hover,.azure-a:focus-visible{animation:none!important;text-shadow:0 0 4px #93c5fd,0 0 10px #60a5fa,0 0 16px #2563eb;transform:scale(1.5)}
      .azure-a:active{transform:scale(.97);text-shadow:0 0 3px #60a5fa,0 0 6px #2563eb}
    `;
    document.head.appendChild(s);
  }, []);
  return null;
}

function AzureA({ onClick }) {
  const [styleVars] = useState(() => ({
    animationDelay: `${(Math.random() * 2).toFixed(2)}s`,
    "--az-dur": `${(3.6 + Math.random() * 2).toFixed(2)}s`,
  }));
  return <button type="button" aria-label="Open Azure facts" className="azure-a" style={styleVars} onClick={onClick}>A</button>;
}

function AzureFactsOverlay({ onClose }) {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const r = await fetch(`${API}/api/azure-facts?fresh=1&_=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) throw new Error(await r.text());
        const j = await r.json();
        if (!gone) setState({ loading: false, error: "", data: j });
      } catch (e) { if (!gone) setState({ loading: false, error: String(e.message || e), data: null }); }
    })();
    return () => { gone = true; };
  }, []);
  const title = state.data?.title || "Azure Fact of the Day";
  const fact = state.data?.fact || "";
  const source = state.data?.source || "";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl ring-1 ring-slate-100">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-xl border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm">Close</button>
        </div>
        {state.loading ? <div className="text-slate-500">Loading...</div> :
         state.error ? <div className="text-rose-600">{state.error}</div> :
         <><p className="text-slate-800">{fact}</p>{source && <p className="mt-2 text-xs text-slate-500">Source: {source}</p>}</>}
      </div>
    </div>
  );
}

/* ================== App ================== */

export default function App() {
  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState("tracker");
  const [showAzure, setShowAzure] = useState(false);
  const [azureKey, setAzureKey] = useState(0);
  const [currentUser, setCurrentUser] = useState("");
  const [ownerOptions, setOwnerOptions] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API}/api/owners`);
        if (!r.ok) return;
        const j = await r.json();
        const items = Array.isArray(j.items) ? j.items : [];
        setOwnerOptions(items);
        if (items.length > 0 && !currentUser) setCurrentUser(items[0]);
      } catch (e) { console.error("owners fetch failed:", e); }
    })();
  }, []);

  function switchTab(next) {
    document.body.classList.add("transitioning");
    setTab(next);
    setTimeout(() => { document.body.classList.remove("transitioning"); }, 240);
  }

  return (
    <UserContext.Provider value={{ currentUser, setCurrentUser, ownerOptions }}>
      <GradientStyles />
      <TransitionStyles />
      <AzureShineStyles />
      {showAzure && <AzureFactsOverlay key={azureKey} onClose={() => setShowAzure(false)} />}
      <div className="min-h-screen animated-gradient">
        <div className="mx-auto max-w-[1600px] px-6 py-6 space-y-6">
          {/* Header */}
          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  Presales <AzureA onClick={() => { setAzureKey(k => k + 1); setShowAzure(true); }} />ctivity Tracker
                </h1>
                <p className="text-sm text-slate-500">Capture activities and review KPIs.</p>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {/* Global User Selector */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-600">Current User:</span>
                  <select
                    className="rounded-full border border-slate-300 px-3 py-1.5 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                    value={currentUser}
                    onChange={(e) => setCurrentUser(e.target.value)}
                  >
                    <option value="">-- Select --</option>
                    {ownerOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div className="flex gap-2">
                  <TabButton active={tab === "tracker"} onClick={() => switchTab("tracker")}>Tracker</TabButton>
                  <TabButton active={tab === "tickets"} onClick={() => switchTab("tickets")}>Tickets</TabButton>
                  <TabButton active={tab === "learning"} onClick={() => switchTab("learning")}>Learning</TabButton>
                  <TabButton active={tab === "kpi"} onClick={() => switchTab("kpi")}>KPI</TabButton>
                  <TabButton active={tab === "dashboard"} onClick={() => switchTab("dashboard")}>Dashboard</TabButton>
                </div>
              </div>
            </div>
          </div>

          {/* Page Content */}
          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
            <PageTransition tab={tab}>
              {tab === "tracker" ? <TrackerScreen rows={rows} setRows={setRows} /> :
               tab === "tickets" ? <TicketsScreen /> :
               tab === "learning" ? <LearningScreen /> :
               tab === "kpi" ? <KPIPage /> :
               <DashboardScreen />}
            </PageTransition>
          </div>
        </div>
      </div>
    </UserContext.Provider>
  );
}

/* ================== Tracker Screen (unchanged) ================== */

function TrackerScreen({ rows, setRows }) {
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("");
  const [openAdd, setOpenAdd] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [prefillRow, setPrefillRow] = useState(null);
  const [useMonth, setUseMonth] = useState(false);
  const [monthIdx, setMonthIdx] = useState(() => { const d = new Date(); return d.getFullYear() * 12 + d.getMonth(); });
  const { currentUser } = useContext(UserContext);

  function fmtMonth(idx) {
    const y = Math.floor(idx / 12), m = idx % 12;
    return new Date(y, m, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
  }
  function shiftMonth(delta) {
    setMonthIdx(i => { const nxt = i + delta; if (!useMonth) setUseMonth(true); return nxt; });
  }

  function mapApiRow(x) {
    return {
      id: x.id, customerName: x.customer_name, customerId: x.customer_id, ticketId: x.ticket_id,
      description: x.description, activityTypes: x.activity_types || [], owner: x.owner,
      salesOwner: x.sales_owner, hours: Number(x.hours ?? 0),
      assignedDate: (x.assigned_date || "").slice(0, 10), activityDate: (x.activity_date || "").slice(0, 10),
      createdAt: (x.created_at || "").slice(0, 10),
    };
  }

  function toApiPayload(u) {
    return {
      customer_name: u.customerName, customer_id: u.customerId, ticket_id: u.ticketId,
      description: u.description, activity_types: u.activityTypes || [], owner: u.owner,
      sales_owner: u.salesOwner || null, hours: Number(u.hours ?? 0),
      assigned_date: u.assignedDate, activity_date: u.activityDate,
    };
  }

  const loadActivities = useCallback(async () => {
    const r = await fetch(`${API}/api/activities`);
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json();
    setRows((j.items || []).map(mapApiRow));
  }, [setRows]);

  useEffect(() => { loadActivities().catch(console.error); }, [loadActivities]);

  async function createActivity(u) {
    const r = await fetch(`${API}/api/activities`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toApiPayload(u)) });
    if (!r.ok) throw new Error(await r.text());
    await loadActivities();
  }

  async function updateActivity(id, u) {
    const r = await fetch(`${API}/api/activities/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toApiPayload(u)) });
    if (!r.ok) throw new Error(await r.text());
    await loadActivities();
  }

  async function deleteActivity(id) {
    const r = await fetch(`${API}/api/activities/${id}`, { method: "DELETE" });
    if (!r.ok) throw new Error(await r.text());
    await loadActivities();
  }

  const filtered = useMemo(() => {
    const norm = (s) => (s ?? "").toString().toLowerCase().replace(/\s+/g, " ").trim();
    const q = norm(query);
    const monthStart = useMonth ? (() => { const y = Math.floor(monthIdx / 12), m = monthIdx % 12; return new Date(y, m, 1); })() : null;
    const monthEnd = useMonth ? new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1) : null;
    return rows.filter((r) => {
      const qOk = (!q || norm(JSON.stringify(r)).includes(q));
      const ownerOk = (!isNonEmpty(owner) || norm(r.owner).includes(norm(owner)));
      const monthOk = !useMonth || (() => { const d = new Date(r.activityDate || r.createdAt || "1970-01-01"); return d >= monthStart && d < monthEnd; })();
      return qOk && ownerOk && monthOk;
    });
  }, [rows, query, owner, useMonth, monthIdx]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => { setPage(1); }, [query, owner, useMonth, pageSize]);

  const paged = useMemo(() => { const start = (page - 1) * pageSize; return filtered.slice(start, start + pageSize); }, [filtered, page, pageSize]);

  async function onAdd(newRow) {
    try { await createActivity(newRow); setOpenAdd(false); } catch (err) { alert(String(err)); }
  }

  function exportTrackerCsv() {
    const cols = ["Customer", "Customer ID", "Ticket ID", "Description", "Types", "Owner", "Sales Owner", "Hours", "Assigned", "Activity"];
    const lines = [cols.join(",")];
    filtered.forEach(r => {
      lines.push([csvCell(r.customerName), csvCell(r.customerId), csvCell(r.ticketId), csvCell(r.description || ""),
        csvCell((r.activityTypes || []).join("|")), csvCell(r.owner || ""), csvCell(r.salesOwner || ""),
        csvCell(r.hours ?? 0), csvCell(r.assignedDate || ""), csvCell(r.activityDate || "")].join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "tracker.csv"; a.click(); URL.revokeObjectURL(a.href);
  }

  const scRef = useRef(null);
  useStableScrollbar(scRef);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[280px]">
          <Label>Search</Label>
          <input className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            placeholder="Customer, Ticket ID, Description" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="w-64">
          <Label>Owner</Label>
          <input className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            placeholder="Filter by Owner" value={owner} onChange={(e) => setOwner(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-2xl border border-slate-300 bg-white pl-3 pr-2 py-2 text-sm shadow-sm">
            <span className="min-w-[9rem] select-none">{fmtMonth(monthIdx)}</span>
            <div className="ml-2 flex flex-col">
              <button type="button" aria-label="Next month" onClick={() => shiftMonth(+1)}
                style={{ background: "transparent", border: "none", outline: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: "0px" }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
              </button>
              <button type="button" aria-label="Previous month" onClick={() => shiftMonth(-1)}
                style={{ background: "transparent", border: "none", outline: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: "0px", marginTop: "0px" }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
            </div>
          </div>
        </div>
        <div className="grow" />
        <button onClick={() => setOpenAdd(true)} className="rounded-full bg-slate-900 px-5 py-2 text-sm text-white shadow-md hover:opacity-95">Add Activity</button>
        <button onClick={exportTrackerCsv} className="rounded-full border border-slate-300 bg-white px-5 py-2 text-sm shadow-sm hover:bg-slate-50">Export CSV</button>
      </div>

      <div ref={scRef} className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm" style={{ maxHeight: "calc(100vh - 380px)", overflowY: "auto", paddingBottom: "80px" }}>
        <table className="w-full table-auto text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-slate-600">
            <tr>
              <Th className="w-[240px]">Customer</Th><Th className="w-[220px]">Customer ID</Th>
              <Th className="w-[180px]">Ticket ID</Th><Th className="w-[420px]">Description</Th>
              <Th className="w-[140px]">Types</Th><Th className="w-[190px]">Owner</Th>
              <Th className="w-[160px]">Sales Owner</Th><Th className="w-[100px]">Hours</Th>
              <Th className="w-[140px]">Assigned</Th><Th className="w-[140px]">Activity</Th>
              <Th className="w-[80px]"></Th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => (
              <tr key={r.id} className="align-top border-t border-slate-100 even:bg-slate-50/40 hover:bg-slate-100 transition-colors">
                <Td className="whitespace-normal [overflow-wrap:anywhere]">{r.customerName}</Td>
                <Td className="whitespace-normal [overflow-wrap:anywhere]">{r.customerId}</Td>
                <Td className="font-mono whitespace-normal break-all">{r.ticketId}</Td>
                <Td className="whitespace-normal [overflow-wrap:anywhere]">{r.description}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1.5">
                    {(r.activityTypes || []).length === 0 ? <span className="text-slate-400">NA</span> :
                      r.activityTypes.map((t, i) => <span key={i} className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-700 border border-slate-200">{t}</span>)}
                  </div>
                </Td>
                <Td className="whitespace-normal [overflow-wrap:anywhere]">{r.owner}</Td>
                <Td className="whitespace-normal [overflow-wrap:anywhere]">{r.salesOwner || ""}</Td>
                <Td className="text-center tabular-nums">{to2(r.hours)}</Td>
                <Td className="whitespace-normal">{r.assignedDate || ""}</Td>
                <Td className="whitespace-normal">{r.activityDate || ""}</Td>
                <Td className="text-center">
                  <div className="flex justify-end gap-2 p-2">
                    <button type="button" aria-label="Edit" title="Edit" onClick={() => setEditRow(r)}
                      className="p-2 rounded-full border border-slate-300 bg-white shadow-sm hover:bg-slate-50">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                      </svg>
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={11} className="p-6 text-center text-slate-500">No rows</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-3 flex items-center justify-between px-1 py-1">
        <div className="flex items-center gap-2 text-sm text-slate-700">
          <span>Rows per page</span>
          <select className="px-2 py-1 text-sm border border-slate-300 rounded-md bg-white" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span>{filtered.length ? `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, filtered.length)} of ${filtered.length}` : "0 of 0"}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="rounded px-2 py-1 disabled:opacity-50 hover:bg-slate-100">‹</button>
          {Array.from({ length: Math.min(5, pageCount) }, (_, i) => {
            const idx = i + 1;
            return <button key={idx} onClick={() => setPage(idx)}
              className={`w-9 h-9 inline-flex items-center justify-center rounded-md tabular-nums text-sm hover:bg-slate-100 ${page === idx ? "bg-slate-900 text-white hover:bg-slate-900" : "text-slate-700"}`}>{idx}</button>;
          })}
          <button onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={page === pageCount} className="rounded px-2 py-1 disabled:opacity-50 hover:bg-slate-100">›</button>
        </div>
      </div>

      {openAdd && <AddDialog initial={prefillRow ?? null} onClose={() => { setOpenAdd(false); setPrefillRow(null); }} onSubmit={onAdd} existingRows={rows} />}
      {editRow && <AddDialog initial={editRow} mode="edit" onClose={() => setEditRow(null)}
        onSubmit={(u) => updateActivity(editRow.id, u).then(() => setEditRow(null)).catch(e => alert(String(e)))}
        onDelete={() => { if (confirm("Delete this activity?")) deleteActivity(editRow.id).then(() => setEditRow(null)).catch(e => alert(String(e))); }}
        existingRows={rows} />}
    </div>
  );
}

/* ================== Add Activity Dialog ================== */

function AddDialog({ onClose, onSubmit, existingRows, initial = null, mode = "add", onDelete }) {
  const { currentUser, ownerOptions } = useContext(UserContext);
  const [saving, setSaving] = useState(false);
  const [ticketFocus, setTicketFocus] = useState(false);
  const [form, setForm] = useState(
    initial ? {
      customerName: initial.customerName || "", customerId: initial.customerId || "", ticketId: initial.ticketId || "",
      description: initial.description || "", activityTypes: initial.activityTypes || [],
      owner: initial.owner || currentUser || "", salesOwner: initial.salesOwner || "",
      hours: String(initial.hours ?? ""), assignedDate: initial.assignedDate || todayISO(), activityDate: initial.activityDate || todayISO(),
    } : {
      customerName: "", customerId: "", ticketId: "", description: "", activityTypes: [],
      owner: currentUser || "", salesOwner: "", hours: "", assignedDate: todayISO(), activityDate: todayISO(),
    }
  );
  const [error, setError] = useState("");
  const setF = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const ticketQuery = form.ticketId.trim().toLowerCase();
  const sameCustomer = useMemo(() =>
    existingRows.filter(r => (isNonEmpty(form.customerName) && r.customerName === form.customerName) || (isNonEmpty(form.customerId) && r.customerId === form.customerId)),
    [existingRows, form.customerName, form.customerId]);
  const ticketSuggestions = useMemo(() => Array.from(new Set(sameCustomer.map(r => r.ticketId))).filter(id => id.toLowerCase().includes(ticketQuery)).slice(0, 8), [sameCustomer, ticketQuery]);

  function validate() {
    const errs = [];
    if (!isNonEmpty(form.customerName)) errs.push("Customer Name");
    if (!isNonEmpty(form.customerId)) errs.push("Customer ID");
    if (!isNonEmpty(form.ticketId)) errs.push("Ticket ID");
    if (!isNonEmpty(form.owner)) errs.push("Owner");
    if (!Array.isArray(form.activityTypes) || form.activityTypes.length === 0) errs.push("Activity Type");
    const h = Number(form.hours); if (!Number.isFinite(h) || h < 0) errs.push("Hours >= 0");
    if (!isNonEmpty(form.activityDate)) errs.push("Activity Date");
    return errs;
  }

  async function save() {
    const errs = validate(); if (errs.length) { setError(errs.join("; ")); return; }
    try { setSaving(true); await onSubmit({ ...form, hours: Number(form.hours) }); } catch (e) { setError(String(e.message || e)); } finally { setSaving(false); }
  }

  function toggleType(t) { setForm(p => { const has = p.activityTypes.includes(t); return { ...p, activityTypes: has ? p.activityTypes.filter(x => x !== t) : [...p.activityTypes, t] }; }); }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-4xl rounded-3xl bg-white p-5 shadow-xl ring-1 ring-slate-100">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{mode === "edit" ? "Edit Activity" : "Add Activity"}</h2>
          <button onClick={onClose} className="rounded-xl border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm">Close</button>
        </div>
        {error && <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-rose-700">{error}</div>}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <label className="block"><Label>Customer Name</Label><input className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm" value={form.customerName} onChange={(e) => setF("customerName", e.target.value)} /></label>
          <label className="block"><Label>Customer ID</Label><input className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm" value={form.customerId} onChange={(e) => setF("customerId", e.target.value)} /></label>
          <label className="block"><Label>Ticket ID</Label>
            <div className="relative">
              <input className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm font-mono" value={form.ticketId} onChange={(e) => setF("ticketId", e.target.value)}
                onFocus={() => setTicketFocus(true)} onBlur={() => setTimeout(() => setTicketFocus(false), 120)} placeholder="Type to search" />
              {ticketFocus && isNonEmpty(form.ticketId) && ticketSuggestions.length > 0 && (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                  {ticketSuggestions.map(id => <div key={id} className="cursor-pointer px-3 py-2 text-sm hover:bg-slate-50" onMouseDown={(e) => e.preventDefault()} onClick={() => { setF("ticketId", id); setTicketFocus(false); }}>{id}</div>)}
                </div>
              )}
            </div>
            <div className="mt-1"><button type="button" onClick={() => setF("ticketId", "To be Raised")} className="rounded-xl border border-slate-300 bg-white px-3 py-1 text-xs shadow-sm">To be Raised</button></div>
          </label>
          <label className="block"><Label>Owner</Label>
            <input className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm" value={form.owner} onChange={(e) => setF("owner", e.target.value)} list="ownerOptions" placeholder="Type or pick" />
            <datalist id="ownerOptions">{ownerOptions.map(o => <option key={o} value={o} />)}</datalist>
          </label>
          <label className="block"><Label>Sales Owner</Label><input className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm" value={form.salesOwner} onChange={(e) => setF("salesOwner", e.target.value)} /></label>
          <label className="block"><Label>Hours</Label><input type="text" inputMode="decimal" placeholder="0.00" className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 text-center shadow-sm" value={form.hours} onChange={(e) => setF("hours", e.target.value.replace(/[^\d.]/g, ""))} /></label>
          <label className="block lg:col-span-2"><Label>Activity Types</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              {ACTIVITY_TYPES.map(t => {
                const active = form.activityTypes.includes(t);
                return <button type="button" key={t} onClick={() => toggleType(t)} className={cx("rounded-full border px-3 py-1 text-sm", active ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50")}>{t}</button>;
              })}
            </div>
          </label>
          <label className="block lg:col-span-2"><Label>Activity Description</Label><textarea className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm min-h-28" value={form.description} onChange={(e) => setF("description", e.target.value)} /></label>
          <label className="block"><Label>Assigned Date</Label><input type="date" className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm" value={form.assignedDate} onChange={(e) => setF("assignedDate", e.target.value)} /></label>
          <label className="block"><Label>Activity Date</Label><input type="date" className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm" value={form.activityDate} onChange={(e) => setF("activityDate", e.target.value)} /></label>
        </div>
        <div className="mt-4 flex justify-between gap-2">
          {mode === "edit" && onDelete ? <button onClick={onDelete} className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-700 shadow-sm hover:bg-rose-100">Delete</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm shadow-sm">Cancel</button>
            <button onClick={save} disabled={saving} className="rounded-full bg-slate-900 px-5 py-2 text-sm text-white shadow-md disabled:opacity-60">{saving ? "Saving..." : "Save"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================== Tickets Screen ================== */

function TicketsScreen() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [query, setQuery] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedTicket, setExpandedTicket] = useState(null);
  const [ticketActivities, setTicketActivities] = useState([]);
  const [kpiModalTicket, setKpiModalTicket] = useState(null);
  const [page, setPage] = useState(1);
  const pageSize = 15;

  async function loadTickets() {
    setLoading(true); setErr("");
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (ownerFilter) params.set("owner", ownerFilter);
      if (statusFilter) params.set("status", statusFilter);
      const r = await fetch(`${API}/api/tickets?${params}`);
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setTickets(j.items || []);
    } catch (e) { setErr(String(e.message || e)); } finally { setLoading(false); }
  }

  useEffect(() => { loadTickets(); }, [query, ownerFilter, statusFilter]);

  async function toggleStatus(ticketId, currentStatus) {
    const next = currentStatus === "Open" ? "Closed" : "Open";
    try {
      const r = await fetch(`${API}/api/tickets/${encodeURIComponent(ticketId)}/status`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }),
      });
      if (!r.ok) throw new Error(await r.text());
      await loadTickets();
    } catch (e) { alert(String(e)); }
  }

  async function expandTicket(ticketId) {
    if (expandedTicket === ticketId) { setExpandedTicket(null); return; }
    setExpandedTicket(ticketId);
    try {
      const r = await fetch(`${API}/api/tickets/${encodeURIComponent(ticketId)}/activities`);
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setTicketActivities(j.items || []);
    } catch (e) { setTicketActivities([]); }
  }

  const filtered = tickets;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[280px]">
          <Label>Search</Label>
          <input className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            placeholder="Ticket ID, Customer..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="w-48">
          <Label>Owner</Label>
          <input className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm" placeholder="Filter by Owner" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} />
        </div>
        <div className="w-36">
          <Label>Status</Label>
          <select className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm bg-white" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All</option><option value="Open">Open</option><option value="Closed">Closed</option>
          </select>
        </div>
      </div>

      {err && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-rose-700">{err}</div>}
      {loading && <div className="text-slate-500">Loading...</div>}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full table-auto text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-slate-600">
            <tr>
              <Th className="w-8"></Th>
              <Th>Ticket ID</Th><Th>Customer</Th><Th>Customer ID</Th><Th>Owner</Th>
              <Th>Sales Owner</Th><Th>Activity Types</Th><Th className="text-center">Activities</Th>
              <Th className="text-center">Hours</Th><Th>Assigned</Th><Th>Latest Activity</Th>
              <Th className="text-center">Status</Th><Th className="text-center">KPI</Th><Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {paged.map((t) => {
              const isStale = t.status === "Open" && daysSince(t.latest_activity_date) >= 7;
              const hasKpi = t.proposal_quality != null;
              return (
                <>
                  <tr key={t.ticket_id} className="align-top border-t border-slate-100 even:bg-slate-50/40 hover:bg-slate-100 transition-colors">
                    <Td>
                      <button onClick={() => expandTicket(t.ticket_id)} className="p-1 rounded hover:bg-slate-200">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                          style={{ transform: expandedTicket === t.ticket_id ? "rotate(90deg)" : "none", transition: "transform .15s" }}>
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </button>
                    </Td>
                    <Td className="font-mono whitespace-normal break-all">
                      <div className="flex items-center gap-1.5">
                        {t.ticket_id}
                        {isStale && <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" title="No activity in 7+ days" />}
                      </div>
                    </Td>
                    <Td className="whitespace-normal [overflow-wrap:anywhere]">{t.customer_name}</Td>
                    <Td className="whitespace-normal">{t.customer_id}</Td>
                    <Td className="whitespace-normal">{t.owner}</Td>
                    <Td className="whitespace-normal">{t.sales_owner || ""}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {(t.activity_types || []).map((at, i) => <span key={i} className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-100 text-slate-700 border border-slate-200">{at}</span>)}
                      </div>
                    </Td>
                    <Td className="text-center tabular-nums">{t.total_activities}</Td>
                    <Td className="text-center tabular-nums">{to2(t.total_hours)}</Td>
                    <Td className="whitespace-normal">{t.assigned_date || ""}</Td>
                    <Td className="whitespace-normal">{t.latest_activity_date || ""}</Td>
                    <Td className="text-center">
                      <button onClick={() => toggleStatus(t.ticket_id, t.status)}
                        className={cx("px-2.5 py-0.5 rounded-full text-xs font-medium border",
                          t.status === "Open" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-600 border-slate-200")}>
                        {t.status}
                      </button>
                    </Td>
                    <Td className="text-center">
                      <button onClick={() => setKpiModalTicket(t)}
                        className={cx("px-2 py-0.5 rounded-full text-xs border",
                          hasKpi ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-slate-50 text-slate-500 border-slate-200")}>
                        {hasKpi ? "Rated" : "Rate"}
                      </button>
                    </Td>
                    <Td>
                      <button onClick={() => toggleStatus(t.ticket_id, t.status)}
                        className={cx("px-3 py-1 rounded-full text-xs border",
                          t.status === "Open" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-300")}>
                        {t.status === "Open" ? "Close" : "Reopen"}
                      </button>
                    </Td>
                  </tr>
                  {expandedTicket === t.ticket_id && (
                    <tr key={`${t.ticket_id}-exp`} className="bg-slate-50/60">
                      <td colSpan={14} className="px-6 py-3">
                        <div className="text-xs font-medium text-slate-500 mb-2">Activities for {t.ticket_id}</div>
                        {ticketActivities.length === 0 ? <div className="text-xs text-slate-400">No activities</div> : (
                          <table className="w-full text-xs">
                            <thead><tr className="text-slate-500">
                              <th className="py-1 px-2 text-left">Description</th><th className="py-1 px-2 text-left">Types</th>
                              <th className="py-1 px-2 text-left">Owner</th><th className="py-1 px-2 text-center">Hours</th>
                              <th className="py-1 px-2 text-left">Activity Date</th>
                            </tr></thead>
                            <tbody>
                              {ticketActivities.map(a => (
                                <tr key={a.id} className="border-t border-slate-100">
                                  <td className="py-1 px-2">{a.description}</td>
                                  <td className="py-1 px-2">{(a.activity_types || []).join(", ")}</td>
                                  <td className="py-1 px-2">{a.owner}</td>
                                  <td className="py-1 px-2 text-center">{a.hours}</td>
                                  <td className="py-1 px-2">{(a.activity_date || "").slice(0, 10)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {filtered.length === 0 && !loading && <tr><td colSpan={14} className="p-6 text-center text-slate-500">No tickets found</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-3 flex items-center justify-between px-1 py-1">
        <div className="text-sm text-slate-700">{filtered.length ? `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, filtered.length)} of ${filtered.length}` : "0 of 0"}</div>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="rounded px-2 py-1 disabled:opacity-50 hover:bg-slate-100">‹</button>
          <button onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={page === pageCount} className="rounded px-2 py-1 disabled:opacity-50 hover:bg-slate-100">›</button>
        </div>
      </div>

      {/* Ticket KPI Rating Modal */}
      {kpiModalTicket && <TicketKpiModal ticket={kpiModalTicket} onClose={() => { setKpiModalTicket(null); loadTickets(); }} />}
    </div>
  );
}

/* ================== Ticket KPI Rating Modal ================== */

function TicketKpiModal({ ticket, onClose }) {
  const [form, setForm] = useState({
    proposal_quality: ticket.proposal_quality ?? "",
    solution_accuracy: ticket.solution_accuracy ?? "",
    average_tat: ticket.average_tat ?? "",
    stakeholder_satisfaction: ticket.stakeholder_satisfaction ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true); setError("");
    try {
      const payload = {};
      TICKET_KPI_FIELDS.forEach(f => {
        const v = Number(form[f.key]);
        payload[f.key] = v >= 1 && v <= 5 ? v : null;
      });
      const r = await fetch(`${API}/api/tickets/${encodeURIComponent(ticket.ticket_id)}/kpi`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(await r.text());
      onClose();
    } catch (e) { setError(String(e.message || e)); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl ring-1 ring-slate-100">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">KPI Rating: {ticket.ticket_id}</h2>
          <button onClick={onClose} className="rounded-xl border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm">Close</button>
        </div>
        {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-2 text-rose-700 text-sm">{error}</div>}

        {/* KPI names in one row */}
        <div className="grid grid-cols-4 gap-2 mb-1">
          {TICKET_KPI_FIELDS.map(f => <div key={f.key} className="text-[10px] text-center font-medium text-slate-600 leading-tight">{f.label}</div>)}
        </div>
        {/* Input boxes below */}
        <div className="grid grid-cols-4 gap-2 mb-1">
          {TICKET_KPI_FIELDS.map(f => (
            <input key={f.key} type="number" min="1" max="5" step="1"
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-center shadow-sm"
              value={form[f.key]} onChange={(e) => setForm(p => ({ ...p, [f.key]: e.target.value }))} placeholder="1-5" />
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2 mb-4">
          {TICKET_KPI_FIELDS.map(f => <div key={f.key} className="text-[9px] text-center text-slate-400">{f.weight}%</div>)}
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm shadow-sm">Cancel</button>
          <button onClick={save} disabled={saving} className="rounded-full bg-slate-900 px-5 py-2 text-sm text-white shadow-md disabled:opacity-60">{saving ? "Saving..." : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

/* ================== Learning Screen ================== */

function LearningScreen() {
  const { currentUser } = useContext(UserContext);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [openAdd, setOpenAdd] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [page, setPage] = useState(1);
  const pageSize = 15;

  async function loadLearning() {
    setLoading(true); setErr("");
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (categoryFilter) params.set("category", categoryFilter);
      if (statusFilter) params.set("status", statusFilter);
      const r = await fetch(`${API}/api/learning?${params}`);
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setItems(j.items || []);
    } catch (e) { setErr(String(e.message || e)); } finally { setLoading(false); }
  }

  useEffect(() => { loadLearning(); }, [query, categoryFilter, statusFilter]);

  async function createLearning(data) {
    const r = await fetch(`${API}/api/learning`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    if (!r.ok) throw new Error(await r.text());
    await loadLearning();
  }

  async function updateLearning(id, data) {
    const r = await fetch(`${API}/api/learning/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    if (!r.ok) throw new Error(await r.text());
    await loadLearning();
  }

  async function deleteLearning(id) {
    const r = await fetch(`${API}/api/learning/${id}`, { method: "DELETE" });
    if (!r.ok) throw new Error(await r.text());
    await loadLearning();
  }

  function exportLearningCsv() {
    const cols = ["Owner", "Date", "Topic", "Category", "Description", "Hours", "Status", "Source/Link", "Completion Date"];
    const lines = [cols.join(",")];
    items.forEach(r => {
      lines.push([csvCell(r.owner), csvCell((r.date || "").slice(0, 10)), csvCell(r.topic), csvCell(r.category || ""),
        csvCell(r.description || ""), csvCell(r.hours ?? 0), csvCell(r.status || ""),
        csvCell(r.source_link || ""), csvCell((r.completion_date || "").slice(0, 10))].join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "learning.csv"; a.click(); URL.revokeObjectURL(a.href);
  }

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const paged = items.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[280px]">
          <Label>Search</Label>
          <input className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            placeholder="Topic, Description..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="w-40">
          <Label>Category</Label>
          <select className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm bg-white" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All</option>
            {LEARNING_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="w-36">
          <Label>Status</Label>
          <select className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm bg-white" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            {LEARNING_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="grow" />
        <button onClick={() => setOpenAdd(true)} className="rounded-full bg-slate-900 px-5 py-2 text-sm text-white shadow-md hover:opacity-95">Add Learning</button>
        <button onClick={exportLearningCsv} className="rounded-full border border-slate-300 bg-white px-5 py-2 text-sm shadow-sm hover:bg-slate-50">Export CSV</button>
      </div>

      {err && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-rose-700">{err}</div>}
      {loading && <div className="text-slate-500">Loading...</div>}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full table-auto text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-slate-600">
            <tr>
              <Th>Date</Th><Th>Topic</Th><Th>Category</Th><Th>Description</Th>
              <Th className="text-center">Hours</Th><Th>Status</Th><Th>Source/Link</Th><Th>Completion</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => (
              <tr key={r.id} className="align-top border-t border-slate-100 even:bg-slate-50/40 hover:bg-slate-100 transition-colors">
                <Td className="whitespace-nowrap">{(r.date || "").slice(0, 10)}</Td>
                <Td className="whitespace-normal [overflow-wrap:anywhere] font-medium">{r.topic}</Td>
                <Td><span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-700 border border-slate-200">{r.category || "-"}</span></Td>
                <Td className="whitespace-normal [overflow-wrap:anywhere] max-w-[300px]">{r.description || ""}</Td>
                <Td className="text-center tabular-nums">{r.hours}</Td>
                <Td>
                  <span className={cx("px-2 py-0.5 rounded-full text-xs border",
                    r.status === "Completed" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                    r.status === "Dropped" ? "bg-slate-100 text-slate-500 border-slate-200" :
                    "bg-amber-50 text-amber-700 border-amber-200")}>{r.status}</span>
                </Td>
                <Td className="whitespace-normal max-w-[150px] truncate">{r.source_link || ""}</Td>
                <Td className="whitespace-nowrap">{(r.completion_date || "").slice(0, 10)}</Td>
                <Td>
                  <div className="flex gap-1">
                    <button onClick={() => setEditItem(r)} className="p-1.5 rounded-full border border-slate-300 bg-white shadow-sm hover:bg-slate-50" title="Edit">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                    </button>
                    <button onClick={() => { if (confirm("Delete?")) deleteLearning(r.id); }} className="p-1.5 rounded-full border border-rose-300 bg-rose-50 shadow-sm hover:bg-rose-100" title="Delete">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
            {items.length === 0 && !loading && <tr><td colSpan={9} className="p-6 text-center text-slate-500">No learning entries</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between px-1 py-1">
        <div className="text-sm text-slate-700">{items.length ? `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, items.length)} of ${items.length}` : "0 of 0"}</div>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="rounded px-2 py-1 disabled:opacity-50 hover:bg-slate-100">‹</button>
          <button onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={page === pageCount} className="rounded px-2 py-1 disabled:opacity-50 hover:bg-slate-100">›</button>
        </div>
      </div>

      {openAdd && <LearningDialog onClose={() => setOpenAdd(false)} onSubmit={async (d) => { await createLearning(d); setOpenAdd(false); }} />}
      {editItem && <LearningDialog initial={editItem} mode="edit" onClose={() => setEditItem(null)}
        onSubmit={async (d) => { await updateLearning(editItem.id, d); setEditItem(null); }}
        onDelete={async () => { await deleteLearning(editItem.id); setEditItem(null); }} />}
    </div>
  );
}

/* ================== Learning Dialog ================== */

function LearningDialog({ onClose, onSubmit, initial = null, mode = "add", onDelete }) {
  const { currentUser } = useContext(UserContext);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(initial ? {
    owner: initial.owner || currentUser || "", date: (initial.date || "").slice(0, 10) || todayISO(),
    topic: initial.topic || "", category: initial.category || "", description: initial.description || "",
    hours: String(initial.hours ?? ""), status: initial.status || "In Progress",
    source_link: initial.source_link || "", completion_date: (initial.completion_date || "").slice(0, 10) || "",
  } : {
    owner: currentUser || "", date: todayISO(), topic: "", category: "", description: "",
    hours: "", status: "In Progress", source_link: "", completion_date: "",
  });

  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }));

  async function save() {
    if (!form.topic || !form.date) { setError("Topic and Date required"); return; }
    setSaving(true); setError("");
    try {
      await onSubmit({
        ...form, hours: Number(form.hours || 0),
        completion_date: form.completion_date || null,
      });
    } catch (e) { setError(String(e.message || e)); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-3xl bg-white p-5 shadow-xl ring-1 ring-slate-100">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{mode === "edit" ? "Edit Learning" : "Add Learning"}</h2>
          <button onClick={onClose} className="rounded-xl border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm">Close</button>
        </div>
        {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-2 text-rose-700 text-sm">{error}</div>}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <label className="block"><Label>Date</Label><input type="date" className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm" value={form.date} onChange={(e) => setF("date", e.target.value)} /></label>
          <label className="block"><Label>Topic</Label><input className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm" value={form.topic} onChange={(e) => setF("topic", e.target.value)} /></label>
          <label className="block"><Label>Category</Label>
            <select className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm bg-white" value={form.category} onChange={(e) => setF("category", e.target.value)}>
              <option value="">Select</option>
              {LEARNING_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="block"><Label>Hours</Label><input type="number" min="0" step="0.5" className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm" value={form.hours} onChange={(e) => setF("hours", e.target.value)} /></label>
          <label className="block"><Label>Status</Label>
            <select className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm bg-white" value={form.status} onChange={(e) => setF("status", e.target.value)}>
              {LEARNING_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="block"><Label>Completion Date</Label><input type="date" className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm" value={form.completion_date} onChange={(e) => setF("completion_date", e.target.value)} /></label>
          <label className="block lg:col-span-2"><Label>Description / Notes</Label><textarea className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm min-h-20" value={form.description} onChange={(e) => setF("description", e.target.value)} /></label>
          <label className="block lg:col-span-2"><Label>Source / Link</Label><input className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm" value={form.source_link} onChange={(e) => setF("source_link", e.target.value)} /></label>
        </div>
        <div className="mt-4 flex justify-between gap-2">
          {mode === "edit" && onDelete ? <button onClick={onDelete} className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-700 shadow-sm hover:bg-rose-100">Delete</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm shadow-sm">Cancel</button>
            <button onClick={save} disabled={saving} className="rounded-full bg-slate-900 px-5 py-2 text-sm text-white shadow-md disabled:opacity-60">{saving ? "Saving..." : "Save"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================== KPI Page ================== */

function KPIPage() {
  const [kpiTab, setKpiTab] = useState("monthly");
  const [showSla, setShowSla] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex rounded-2xl border border-slate-300 p-1 bg-white">
            {["monthly", "quarterly"].map(t => (
              <button key={t} onClick={() => setKpiTab(t)}
                className={`px-4 py-1.5 text-sm rounded-xl ${kpiTab === t ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"}`}>
                {t === "monthly" ? "Monthly KPI" : "Quarterly KPI"}
              </button>
            ))}
          </div>
          <button onClick={() => setShowSla(true)} className="rounded-full border border-slate-300 bg-white px-4 py-1.5 text-sm shadow-sm hover:bg-slate-50">SLA</button>
        </div>
      </div>

      {kpiTab === "monthly" ? <MonthlyKpiTab /> : <QuarterlyKpiTab />}

      {showSla && <SlaModal onClose={() => setShowSla(false)} />}
    </div>
  );
}

/* ================== Monthly KPI Tab ================== */

function MonthlyKpiTab() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  function fmtMonth(m, y) { return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" }); }

  useEffect(() => {
    async function load() {
      setLoading(true); setErr("");
      try {
        const r = await fetch(`${API}/api/kpi/monthly?month=${month}&year=${year}`);
        if (!r.ok) throw new Error(await r.text());
        const j = await r.json();
        setRows(j.rows || []);
      } catch (e) { setErr(String(e.message || e)); } finally { setLoading(false); }
    }
    load();
  }, [month, year]);

  function shiftMonth(delta) {
    let m = month + delta, y = year;
    if (m > 12) { m = 1; y++; } if (m < 1) { m = 12; y--; }
    setMonth(m); setYear(y);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center rounded-2xl border border-slate-300 bg-white pl-3 pr-2 py-2 text-sm shadow-sm">
          <span className="min-w-[12rem] select-none">{fmtMonth(month, year)}</span>
          <div className="ml-2 flex flex-col">
            <button type="button" onClick={() => shiftMonth(1)} style={{ background: "transparent", border: "none", cursor: "pointer", padding: "2px" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2"><polyline points="18 15 12 9 6 15" /></svg>
            </button>
            <button type="button" onClick={() => shiftMonth(-1)} style={{ background: "transparent", border: "none", cursor: "pointer", padding: "2px" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
            </button>
          </div>
        </div>
        <div className="text-sm text-slate-500">Auto-calculated from ticket-level KPI ratings</div>
      </div>

      {err && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-rose-700">{err}</div>}
      {loading && <div className="text-slate-500">Loading...</div>}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <Th>Owner</Th>
              <Th className="text-center">Proposal Quality (20%)</Th>
              <Th className="text-center">Solution Accuracy (20%)</Th>
              <Th className="text-center">Avg TAT (15%)</Th>
              <Th className="text-center">Stakeholder Sat. (10%)</Th>
              <Th className="text-center">Weighted Score</Th>
              <Th className="text-center">Monthly KPI Rating</Th>
              <Th className="text-center">Rated Tickets</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading ? <tr><td colSpan={8} className="p-6 text-center text-slate-500">No data for this month</td></tr> :
              rows.map(r => (
                <tr key={r.owner} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{r.owner}</td>
                  <td className="px-3 py-2 text-center">{r.avgProposalQuality != null ? to2(r.avgProposalQuality) : "-"}</td>
                  <td className="px-3 py-2 text-center">{r.avgSolutionAccuracy != null ? to2(r.avgSolutionAccuracy) : "-"}</td>
                  <td className="px-3 py-2 text-center">{r.avgAverageTat != null ? to2(r.avgAverageTat) : "-"}</td>
                  <td className="px-3 py-2 text-center">{r.avgStakeholderSatisfaction != null ? to2(r.avgStakeholderSatisfaction) : "-"}</td>
                  <td className="px-3 py-2 text-center font-medium">{r.monthlyWeightedScore != null ? to2(r.monthlyWeightedScore) : "-"}</td>
                  <td className="px-3 py-2 text-center font-semibold">{r.monthlyKpiRating != null ? to2(r.monthlyKpiRating) : "-"}</td>
                  <td className="px-3 py-2 text-center">{r.ratedTickets || 0}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ================== Quarterly KPI Tab ================== */

function QuarterlyKpiTab() {
  const { currentUser } = useContext(UserContext);
  const now = new Date();
  const [fy, setFy] = useState(getFinancialYear(now));
  const [quarter, setQuarter] = useState(getQuarter(now));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true); setErr("");
      try {
        const r = await fetch(`${API}/api/kpi/quarterly?fy=${encodeURIComponent(fy)}&quarter=${encodeURIComponent(quarter)}`);
        if (!r.ok) throw new Error(await r.text());
        const j = await r.json();
        setRows(j.rows || []);
      } catch (e) { setErr(String(e.message || e)); } finally { setLoading(false); }
    }
    load();
  }, [fy, quarter]);

  async function saveQuarterly(data) {
    const r = await fetch(`${API}/api/kpi/quarterly`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner: currentUser, financialYear: fy, quarter, ...data }),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  const FY_OPTIONS = [];
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  for (let i = -2; i <= 2; i++) {
    const y = startYear + i;
    FY_OPTIONS.push(`FY${y}-${String(y + 1).slice(2)}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Label>Financial Year</Label>
          <select className="rounded-2xl border border-slate-300 px-3 py-2 text-sm bg-white shadow-sm" value={fy} onChange={(e) => setFy(e.target.value)}>
            {FY_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Label>Quarter</Label>
          <select className="rounded-2xl border border-slate-300 px-3 py-2 text-sm bg-white shadow-sm" value={quarter} onChange={(e) => setQuarter(e.target.value)}>
            {["Q1", "Q2", "Q3", "Q4"].map(q => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>
        <div className="text-sm text-slate-500">Owner: <span className="font-medium">{currentUser || "Not selected"}</span></div>
        <div className="grow" />
        <button onClick={() => setShowAdd(true)} className="rounded-full bg-slate-900 px-5 py-2 text-sm text-white shadow-md hover:opacity-95">Add Quarterly KPI</button>
      </div>

      {err && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-rose-700">{err}</div>}
      {loading && <div className="text-slate-500">Loading...</div>}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <Th>Owner</Th>
              <Th className="text-center">Professional Behaviour (20%)</Th>
              <Th className="text-center">Upskilling & Certifications (15%)</Th>
              <Th className="text-center">Weighted Score</Th>
              <Th className="text-center">Quarterly KPI Rating</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading ? <tr><td colSpan={5} className="p-6 text-center text-slate-500">No quarterly KPI data</td></tr> :
              rows.map(r => (
                <tr key={r.owner} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{r.owner}</td>
                  <td className="px-3 py-2 text-center">{r.professionalBehaviour != null ? to2(r.professionalBehaviour) : "-"}</td>
                  <td className="px-3 py-2 text-center">{r.upskillingCertifications != null ? to2(r.upskillingCertifications) : "-"}</td>
                  <td className="px-3 py-2 text-center font-medium">{r.quarterlyWeightedScore != null ? to2(r.quarterlyWeightedScore) : "-"}</td>
                  <td className="px-3 py-2 text-center font-semibold">{r.quarterlyKpiRating != null ? to2(r.quarterlyKpiRating) : "-"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {showAdd && <QuarterlyKpiModal fy={fy} quarter={quarter} onClose={() => setShowAdd(false)} onSave={async (data) => { await saveQuarterly(data); setShowAdd(false); }} />}
    </div>
  );
}

/* ================== Quarterly KPI Modal ================== */

function QuarterlyKpiModal({ fy, quarter, onClose, onSave }) {
  const { currentUser } = useContext(UserContext);
  const [form, setForm] = useState({ professional_behaviour: "", upskilling_certifications: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true); setError("");
    try {
      const pb = Number(form.professional_behaviour);
      const uc = Number(form.upskilling_certifications);
      if ((pb < 1 || pb > 5) || (uc < 1 || uc > 5)) { setError("Ratings must be between 1 and 5"); setSaving(false); return; }
      await onSave({ professionalBehaviour: pb, upskillingCertifications: uc });
    } catch (e) { setError(String(e.message || e)); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl ring-1 ring-slate-100">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Quarterly KPI</h2>
          <button onClick={onClose} className="rounded-xl border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm">Close</button>
        </div>
        <div className="mb-3 text-sm text-slate-500">{fy} | {quarter} | Owner: {currentUser}</div>
        {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-2 text-rose-700 text-sm">{error}</div>}

        <div className="grid grid-cols-2 gap-2 mb-1">
          {QUARTERLY_KPI_FIELDS.map(f => <div key={f.key} className="text-[10px] text-center font-medium text-slate-600 leading-tight">{f.label}</div>)}
        </div>
        <div className="grid grid-cols-2 gap-2 mb-1">
          {QUARTERLY_KPI_FIELDS.map(f => (
            <input key={f.key} type="number" min="1" max="5" step="1"
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-center shadow-sm"
              value={form[f.key]} onChange={(e) => setForm(p => ({ ...p, [f.key]: e.target.value }))} placeholder="1-5" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {QUARTERLY_KPI_FIELDS.map(f => <div key={f.key} className="text-[9px] text-center text-slate-400">{f.weight}%</div>)}
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm shadow-sm">Cancel</button>
          <button onClick={save} disabled={saving} className="rounded-full bg-slate-900 px-5 py-2 text-sm text-white shadow-md disabled:opacity-60">{saving ? "Saving..." : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

/* ================== SLA Modal ================== */

function SlaModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl ring-1 ring-slate-100 max-h-[80vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">KPI Rubric / SLA</h2>
          <button onClick={onClose} className="rounded-xl border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm">Close</button>
        </div>

        <div className="space-y-4 text-sm">
          <div>
            <h3 className="font-semibold text-slate-800 mb-2">Monthly KPI (Total: 65%)</h3>
            <table className="w-full text-xs">
              <thead className="bg-slate-50"><tr><th className="px-2 py-1 text-left">KPI</th><th className="px-2 py-1 text-center">Weight</th><th className="px-2 py-1 text-center">Scale</th></tr></thead>
              <tbody>
                <tr className="border-t border-slate-100"><td className="px-2 py-1">Proposal Quality & Timeliness</td><td className="px-2 py-1 text-center">20%</td><td className="px-2 py-1 text-center">1-5</td></tr>
                <tr className="border-t border-slate-100"><td className="px-2 py-1">Solution Accuracy</td><td className="px-2 py-1 text-center">20%</td><td className="px-2 py-1 text-center">1-5</td></tr>
                <tr className="border-t border-slate-100"><td className="px-2 py-1">Average TAT</td><td className="px-2 py-1 text-center">15%</td><td className="px-2 py-1 text-center">1-5</td></tr>
                <tr className="border-t border-slate-100"><td className="px-2 py-1">Stakeholder Satisfaction</td><td className="px-2 py-1 text-center">10%</td><td className="px-2 py-1 text-center">1-5</td></tr>
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500">Monthly KPI Rating = Weighted Score / 65</p>
          </div>

          <div>
            <h3 className="font-semibold text-slate-800 mb-2">Quarterly KPI (Total: 35%)</h3>
            <table className="w-full text-xs">
              <thead className="bg-slate-50"><tr><th className="px-2 py-1 text-left">KPI</th><th className="px-2 py-1 text-center">Weight</th><th className="px-2 py-1 text-center">Scale</th></tr></thead>
              <tbody>
                <tr className="border-t border-slate-100"><td className="px-2 py-1">Professional Behaviour & Culture</td><td className="px-2 py-1 text-center">20%</td><td className="px-2 py-1 text-center">1-5</td></tr>
                <tr className="border-t border-slate-100"><td className="px-2 py-1">Upskilling & Certifications</td><td className="px-2 py-1 text-center">15%</td><td className="px-2 py-1 text-center">1-5</td></tr>
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500">Quarterly KPI Rating = Weighted Score / 35</p>
          </div>

          <div>
            <h3 className="font-semibold text-slate-800 mb-2">Rating Scale</h3>
            <table className="w-full text-xs">
              <thead className="bg-slate-50"><tr><th className="px-2 py-1 text-center">Rating</th><th className="px-2 py-1 text-left">Description</th></tr></thead>
              <tbody>
                <tr className="border-t border-slate-100"><td className="px-2 py-1 text-center font-medium">5</td><td className="px-2 py-1">Exceptional - Exceeds all expectations</td></tr>
                <tr className="border-t border-slate-100"><td className="px-2 py-1 text-center font-medium">4</td><td className="px-2 py-1">Strong - Consistently exceeds expectations</td></tr>
                <tr className="border-t border-slate-100"><td className="px-2 py-1 text-center font-medium">3</td><td className="px-2 py-1">Solid - Meets expectations consistently</td></tr>
                <tr className="border-t border-slate-100"><td className="px-2 py-1 text-center font-medium">2</td><td className="px-2 py-1">Developing - Partially meets expectations</td></tr>
                <tr className="border-t border-slate-100"><td className="px-2 py-1 text-center font-medium">1</td><td className="px-2 py-1">Needs Improvement - Below expectations</td></tr>
              </tbody>
            </table>
          </div>

          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            <strong>Overall KPI</strong> = Monthly KPI Rating (65%) + Quarterly KPI Rating (35%), normalized to a combined score.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================== Dashboard Screen ================== */

function DashboardScreen() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 8;

  function fmtMonth(m, y) { return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" }); }

  useEffect(() => {
    async function load() {
      setLoading(true); setErr("");
      try {
        const r = await fetch(`${API}/api/dashboard?month=${month}&year=${year}`);
        if (!r.ok) throw new Error(await r.text());
        const j = await r.json();
        setRows(j.rows || []);
      } catch (e) { setErr(String(e.message || e)); } finally { setLoading(false); }
    }
    load();
  }, [month, year]);

  function shiftMonth(delta) {
    let m = month + delta, y = year;
    if (m > 12) { m = 1; y++; } if (m < 1) { m = 12; y--; }
    setMonth(m); setYear(y);
  }

  const filtered = ownerFilter ? rows.filter(r => r.owner.toLowerCase().includes(ownerFilter.toLowerCase())) : rows;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  // Chart data
  const chartLabels = filtered.map(r => r.owner);
  const monthlyKpiVals = filtered.map(r => r.monthlyKpi.monthlyKpiRating ?? 0);
  const quarterlyKpiVals = filtered.map(r => r.quarterlyKpi.quarterlyKpiRating ?? 0);
  const hoursVals = filtered.map(r => r.totalHours ?? 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Dashboard</h2>
          <p className="text-sm text-slate-500">KPI, Ticket, Learning & Hours Overview</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="w-48">
            <Label>Filter Owner</Label>
            <input className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm" placeholder="Owner name" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} />
          </div>
          <div className="flex items-center rounded-2xl border border-slate-300 bg-white pl-3 pr-2 py-2 text-sm shadow-sm">
            <span className="min-w-[12rem] select-none">{fmtMonth(month, year)}</span>
            <div className="ml-2 flex flex-col">
              <button type="button" onClick={() => shiftMonth(1)} style={{ background: "transparent", border: "none", cursor: "pointer", padding: "2px" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2"><polyline points="18 15 12 9 6 15" /></svg>
              </button>
              <button type="button" onClick={() => shiftMonth(-1)} style={{ background: "transparent", border: "none", cursor: "pointer", padding: "2px" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {err && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-rose-700">{err}</div>}
      {loading && <div className="text-slate-500">Loading...</div>}

      {/* Charts */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-medium text-slate-700 mb-2">Monthly KPI Rating</div>
            <HorizontalBarChart labels={chartLabels} values={monthlyKpiVals} max={5} />
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-medium text-slate-700 mb-2">Quarterly KPI Rating</div>
            <HorizontalBarChart labels={chartLabels} values={quarterlyKpiVals} max={5} />
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-medium text-slate-700 mb-2">Total Hours</div>
            <HorizontalBarChart labels={chartLabels} values={hoursVals} max={Math.max(1, ...hoursVals)} />
          </div>
        </div>
      )}

      {/* Owner-wise cards */}
      <div className="space-y-3">
        {paged.map(r => (
          <div key={r.owner} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-800">{r.owner}</h3>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-slate-500">Hours: <span className="font-medium text-slate-800">{to2(r.totalHours)}</span></span>
                <span className="text-slate-500">Tickets: <span className="font-medium text-slate-800">{r.tickets.total}</span> (Open: {r.tickets.open})</span>
                <span className="text-slate-500">Learning: <span className="font-medium text-slate-800">{r.learning.totalEntries}</span></span>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Monthly KPI</div>
                <div className="text-xl font-bold text-slate-800">{r.monthlyKpi.monthlyKpiRating != null ? to2(r.monthlyKpi.monthlyKpiRating) : "-"}</div>
                <div className="text-[10px] text-slate-400 mt-1">PQ: {r.monthlyKpi.avgProposalQuality != null ? to2(r.monthlyKpi.avgProposalQuality) : "-"} | SA: {r.monthlyKpi.avgSolutionAccuracy != null ? to2(r.monthlyKpi.avgSolutionAccuracy) : "-"}</div>
                <div className="text-[10px] text-slate-400">TAT: {r.monthlyKpi.avgAverageTat != null ? to2(r.monthlyKpi.avgAverageTat) : "-"} | SS: {r.monthlyKpi.avgStakeholderSatisfaction != null ? to2(r.monthlyKpi.avgStakeholderSatisfaction) : "-"}</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Quarterly KPI</div>
                <div className="text-xl font-bold text-slate-800">{r.quarterlyKpi.quarterlyKpiRating != null ? to2(r.quarterlyKpi.quarterlyKpiRating) : "-"}</div>
                <div className="text-[10px] text-slate-400 mt-1">PB: {r.quarterlyKpi.professionalBehaviour != null ? to2(r.quarterlyKpi.professionalBehaviour) : "-"} | UC: {r.quarterlyKpi.upskillingCertifications != null ? to2(r.quarterlyKpi.upskillingCertifications) : "-"}</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Ticket Rating Summary</div>
                <div className="text-xl font-bold text-slate-800">{r.monthlyKpi.ratedTickets || 0} <span className="text-sm font-normal text-slate-500">rated</span></div>
                <div className="text-[10px] text-slate-400 mt-1">Open: {r.tickets.open} | Closed: {r.tickets.closed}</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Learning Summary</div>
                <div className="text-xl font-bold text-slate-800">{r.learning.totalEntries} <span className="text-sm font-normal text-slate-500">entries</span></div>
                <div className="text-[10px] text-slate-400 mt-1">Hours: {to2(r.learning.totalHours)}</div>
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && !loading && <div className="p-6 text-center text-slate-500">No data for this month</div>}
      </div>

      {/* Pagination */}
      {filtered.length > pageSize && (
        <div className="mt-3 flex items-center justify-between px-1 py-1">
          <div className="text-sm text-slate-700">{(page - 1) * pageSize + 1}-{Math.min(page * pageSize, filtered.length)} of {filtered.length}</div>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="rounded px-2 py-1 disabled:opacity-50 hover:bg-slate-100">‹</button>
            <button onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={page === pageCount} className="rounded px-2 py-1 disabled:opacity-50 hover:bg-slate-100">›</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================== Horizontal Bar Chart ================== */

function HorizontalBarChart({ labels, values, max = 5 }) {
  const barHeight = 24;
  const gap = 8;
  const labelWidth = 100;
  const barMaxWidth = 200;
  const h = labels.length * (barHeight + gap) + 10;

  return (
    <svg width={labelWidth + barMaxWidth + 60} height={h} role="img" aria-label="Bar chart">
      {labels.map((label, i) => {
        const y = i * (barHeight + gap) + 5;
        const w = max > 0 ? (values[i] / max) * barMaxWidth : 0;
        const val = values[i];
        return (
          <g key={i}>
            <text x={labelWidth - 5} y={y + barHeight / 2 + 4} fontSize="11" textAnchor="end" fill="#475569">{label}</text>
            <rect x={labelWidth} y={y} width={Math.max(0, w)} height={barHeight} rx={4} fill="#1e293b" />
            <text x={labelWidth + w + 6} y={y + barHeight / 2 + 4} fontSize="11" fill="#0f172a">{Number.isFinite(val) ? val.toFixed(2) : "-"}</text>
          </g>
        );
      })}
    </svg>
  );
}
