import { useMemo, useState, useEffect, useCallback, useRef, useLayoutEffect } from "react";

/* ================== Constants ================== */

const csvCell = (v) => `"${(v ?? "").toString().replace(/"/g,'""')}"`;

const RATING_KEYS = [
  "Avg Quality Rating",
  "Avg Completion Time",
  "Proactiveness",
  "Ownership",
  "Technical Knowledge",
  "Team Collaboration",
  "Stakeholder Satisfaction",
  "Worked Outside Hours", 
];

const ACTIVITY_TYPES = [
  "SOW",
  "BOQ",
  "Call",
  "Architecture",
  "Workshop",
  "Demo",
  "Assist",
  "Implementation",
  "Others",
];

const API = import.meta.env.VITE_API_BASE || "";
//"http://localhost:4000" - to run locally

/* ================== Utils ================== */

const cx = (...xs) => xs.filter(Boolean).join(" ");
const todayISO = () => new Date().toISOString().slice(0, 10);
const isNonEmpty = (s) => !!s && String(s).trim().length > 0;
const to2 = (n) => Number(n ?? 0).toFixed(2);

/* helper: enable scrollbar gutter ONLY when vertical overflow exists */
function useStableScrollbar(ref) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const need = el.scrollHeight > el.clientHeight + 1; // small tolerance
      el.style.scrollbarGutter = need ? "stable" : "auto";
    };

    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);

    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true });

    window.addEventListener("resize", update);

    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [ref]);
}

function weekEndISO(weekStartISO) {
  const [y,m,d] = weekStartISO.split("-").map(Number);
  const dt = new Date(y, m-1, d); dt.setDate(dt.getDate() + 4); // Friday
  const yy = dt.getFullYear(), mm = String(dt.getMonth()+1).padStart(2,"0"), dd = String(dt.getDate()).padStart(2,"0");
  return `${yy}-${mm}-${dd}`;
}
function fmtShort(dStr) {
  const [y,m,d] = dStr.split("-").map(Number);
  return new Date(y, m-1, d).toLocaleDateString(undefined, { day:"2-digit", month:"short" });
}
// Single source of truth: display Mon–Fri, calculate Mon–Sun
function getWeekRanges(weekStartISOStr) {
  const [y,m,d] = weekStartISOStr.split("-").map(Number);
  const s = new Date(y, m-1, d);           // Monday
  const dispEnd = new Date(s); dispEnd.setDate(dispEnd.getDate() + 4); // Friday
  const calcEnd = new Date(s); calcEnd.setDate(calcEnd.getDate() + 6); // Sunday
  const pad = (n)=>String(n).padStart(2,"0");
  const iso = (dt)=>`${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
  return {
    displayStartISO: weekStartISOStr,
    displayEndISO: iso(dispEnd),
    calcStartISO: weekStartISOStr,
    calcEndISO: iso(calcEnd),
    displayStart: s,
    displayEnd: dispEnd,
    calcStart: s,
    calcEnd: calcEnd
  };
}

// Monday of week (Mon–Fri) using LOCAL dates (no UTC conversion)
 function weekStartISO(dStr) {
   const [y, m, d] = dStr.split("-").map(Number);       // "YYYY-MM-DD"
   const dt = new Date(y, m - 1, d);                    // local date
   const dow = dt.getDay();                             // 0..6 (Sun..Sat)
   const diff = (dow === 0 ? -6 : 1) - dow;             // move to Monday
   dt.setDate(dt.getDate() + diff);                     // still local
   const yy = dt.getFullYear();
   const mm = String(dt.getMonth() + 1).padStart(2, "0");
   const dd = String(dt.getDate()).padStart(2, "0");
   return `${yy}-${mm}-${dd}`;
}
const localISO = (dt) => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;


/* ================== Atoms ================== */

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "px-4 py-2 text-sm rounded-full border",
        active ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
      )}
    >
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
/* ---------- Page transition styles (GPU-only) ---------- */
function TransitionStyles() {
  useEffect(() => {
    if (document.getElementById("page-trans-css")) return;
    const s = document.createElement("style");
    s.id = "page-trans-css";
    s.textContent = `
      .page-fade-in{
        will-change: transform, opacity;
        backface-visibility: hidden;
        animation: pageEnter .18s cubic-bezier(.2,.7,.2,1) both;
      }
      @keyframes pageEnter {
        from { opacity: 0; transform: translate3d(0,6px,0); }
        to   { opacity: 1; transform: translate3d(0,0,0); }
      }

      /* pause heavy background animation during tab switch */
      body.transitioning .animated-gradient{ animation-play-state: paused !important; }
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
        background:
          radial-gradient(circle at 78% 38%,
            rgba(0, 125, 50, 0.45) 0%,
            rgba(71, 238, 132, 0.18) 30%,
            rgba(80, 220, 120, 0) 60%),
          linear-gradient(135deg,
            #005a27ff 0%,
            #00b65eff 55%,
            #003222ff 100%
          );
        background-size: 400% 400%;
        animation: gradientShift 18s ease infinite;
        min-height: 100vh;
        will-change: background-position;
      }
      @keyframes gradientShift{
        0%{background-position:0% 50%}
        50%{background-position:100% 50%}
        100%{background-position:0% 50%}
      }
    `;
    document.head.appendChild(s);
  }, []);
  return null;
}


/* ================== App (state lifted) ================== */
function PageTransition({ tab, children }) {
  // re-mount on tab change to play the enter animation
  return <div key={tab} className="page-fade-in">{children}</div>;
}

export default function App() {
  // Tracker rows shared across pages
  const [rows, setRows] = useState([]);
  const [showAzure, setShowAzure] = useState(false);
  const [azureKey, setAzureKey] = useState(0);
  

  // Ratings + manual overrides keyed by owner|weekStart
  const [tab, setTab] = useState("tracker");
  function switchTab(next){
  document.body.classList.add("transitioning");
  setTab(next);
  setTimeout(() => { document.body.classList.remove("transitioning"); }, 240);
}

  return (
    <>
      <GradientStyles />
      <TransitionStyles />
      <AzureShineStyles />
      {showAzure && <AzureFactsOverlay key={azureKey} onClose={() => setShowAzure(false)} />}
      <div className="min-h-screen animated-gradient">
        <div className="mx-auto max-w-[1600px] px-6 py-6 space-y-6">
        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  Presales <AzureA onClick={() => { setAzureKey(k => k + 1); setShowAzure(true); }} />ctivity Tracker
                </h1>
              <p className="text-sm text-slate-500">Capture activities and review weekly KPIs. - github</p>
            </div>
            <div className="flex gap-2">
              <TabButton active={tab === "tracker"} onClick={() => switchTab("tracker")}>Tracker</TabButton>
              <TabButton active={tab === "kpi"} onClick={() => switchTab("kpi")}>KPI</TabButton>
              <TabButton active={tab === "Dashboard"} onClick={() => switchTab("Dashboard")}>Dashboard</TabButton>
            </div>
          </div>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
        <PageTransition tab={tab}>
          {tab === "tracker" ? (
            <TrackerScreen rows={rows} setRows={setRows} />
          ) : tab === "kpi" ? (
            <KPIPage />
          ) : (
            <AdminDashboard/>
          )}
        </PageTransition>
      </div>
      </div>
    </div>
    </>
  );
}

/* ================== Tracker ================== */

function TrackerScreen({ rows, setRows }) {
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("");
  const [openAdd, setOpenAdd] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [prefillRow, setPrefillRow] = useState(null); // for "Copy" → prefilled Add
 // const [refreshing, setRefreshing] = useState(false);
  const [useMonth, setUseMonth] = useState(false); // stays false until arrows are used
  const [monthIdx, setMonthIdx] = useState(() => {
    const d = new Date(); return d.getFullYear()*12 + d.getMonth(); // integer index
  });
  function fmtMonth(idx){
    const y = Math.floor(idx/12), m = idx%12;
    return new Date(y, m, 1).toLocaleString(undefined, { month:"long", year:"numeric" });
  }
  function shiftMonth(delta){
    setMonthIdx(i => {
      const nxt = i + delta;
      if (!useMonth) setUseMonth(true); // enable filter only when arrows touched
      return nxt;
    });
  }
  
/* async function doRefresh() {
  try {
    setRefreshing(true);
    await loadActivities();
  } finally {
    setRefreshing(false);
  }
} */


  // Map DB row -> UI row (snake_case -> camelCase)
function mapApiRow(x) {
  return {
    id: x.id,
    customerName: x.customer_name,
    customerId: x.customer_id,
    ticketId: x.ticket_id,
    description: x.description,
    activityTypes: x.activity_types || [],
    owner: x.owner,
    salesOwner: x.sales_owner,
    hours: Number(x.hours ?? 0),
    assignedDate: (x.assigned_date || "").slice(0, 10),
    activityDate: (x.activity_date || "").slice(0, 10),
    createdAt: (x.created_at || "").slice(0, 10),
  };
}

// Map UI row -> API payload (camelCase -> snake_case)
function toApiPayload(u) {
  return {
    customer_name: u.customerName,
    customer_id: u.customerId,
    ticket_id: u.ticketId,
    description: u.description,
    activity_types: u.activityTypes || [],
    owner: u.owner,
    sales_owner: u.salesOwner || null,
    hours: Number(u.hours ?? 0),
    assigned_date: u.assignedDate,
    activity_date: u.activityDate,
  };
}

const loadActivities = useCallback(async () => {
  const r = await fetch(`${API}/api/activities`);
  if (!r.ok) throw new Error(await r.text());
  const j = await r.json();
  setRows((j.items || []).map(mapApiRow));
}, [setRows]);

useEffect(() => { loadActivities().catch(console.error); }, [loadActivities]);

// Create
async function createActivity(u) {
  const r = await fetch(`${API}/api/activities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toApiPayload(u)),
  });
  if (!r.ok) throw new Error(await r.text());
  await loadActivities();
}

// Update
async function updateActivity(id, u) {
  const r = await fetch(`${API}/api/activities/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toApiPayload(u)),
  });
  if (!r.ok) throw new Error(await r.text());
  await loadActivities();
}

// Delete
async function deleteActivity(id) {
  const r = await fetch(`${API}/api/activities/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await r.text());
  await loadActivities();
}

  const filtered = useMemo(() => {
  const norm = (s) => (s ?? "").toString().toLowerCase().replace(/\s+/g, " ").trim();
  const q = norm(query);
  const monthStart = useMonth ? (() => {
    const y = Math.floor(monthIdx/12), m = monthIdx%12;
    return new Date(y, m, 1);
  })() : null;
  const monthEnd   = useMonth ? new Date(monthStart.getFullYear(), monthStart.getMonth()+1, 1) : null;

  return rows.filter((r) => {
    const qOk = (!q || norm(JSON.stringify(r)).includes(q));
    const ownerOk = (!isNonEmpty(owner) || norm(r.owner).includes(norm(owner)));

    const monthOk = !useMonth || (() => {
      const d = new Date(r.activityDate || r.createdAt || "1970-01-01");
      return d >= monthStart && d < monthEnd;
    })();
    return qOk && ownerOk && monthOk;
  });
}, [rows, query, owner, useMonth, monthIdx]);

// Pagination
const [page, setPage] = useState(1);
const [pageSize, setPageSize] = useState(10);
const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
useEffect(()=>{ setPage(1); }, [query, owner, useMonth, pageSize]);

// sliding window for page numbers
const windowSize = 5;
const [winStart, setWinStart] = useState(1);
const maxStart = Math.max(1, pageCount - windowSize + 1);

// keep window valid when total pages change
useEffect(() => {
  setWinStart(s => Math.min(Math.max(1, s), maxStart));
}, [maxStart]);

// auto-slide on prev/next clicks
useEffect(() => {
  const start = winStart;
  const end = Math.min(pageCount, start + windowSize - 1);
  if (page < start) {
    // make selected page the RIGHT-most
    setWinStart(Math.max(1, page - windowSize + 1));
  } else if (page > end) {
    // make selected page the LEFT-most
    setWinStart(Math.min(page, maxStart));
  }
}, [page, pageCount, maxStart, winStart]);


const paged = useMemo(()=>{
  const start = (page-1)*pageSize;
  return filtered.slice(start, start+pageSize);
}, [filtered, page, pageSize]);

  async function onAdd(newRow) {
    try {
      await createActivity(newRow);
      setOpenAdd(false);
    } catch (err) {
      alert(String(err));
    }
  }
  
  function exportTrackerCsv() {
  const cols = ["Customer","Customer ID","Ticket ID","Description","Types","Owner","Sales Owner","Hours","Assigned","Activity"];
  const lines = [cols.join(",")];
  filtered.forEach(r => {
    lines.push([
      csvCell(r.customerName),
      csvCell(r.customerId),
      csvCell(r.ticketId),
      csvCell(r.description || ""),
      csvCell((r.activityTypes || []).join("|")),
      csvCell(r.owner || ""),
      csvCell(r.salesOwner || ""),
      csvCell(r.hours ?? 0),
      csvCell(r.assignedDate || ""),
      csvCell(r.activityDate || "")
    ].join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "tracker.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---- CSV helpers for Activities import (BEGIN) ----
function parseCSV(text){
  const out=[]; let row=[], i=0, s=text; const N=s.length;
  while(i<N){
    if(s[i]==='"'){ // quoted
      let j=++i, cell="";
      while(j<N){
        if(s[j]==='"'){
          if(s[j+1]==='"'){ cell+='"'; j+=2; continue; }
          j++; break;
        }
        cell+=s[j++]; 
      }
      row.push(cell);
      if(s[j]===','){ j++; }
      if(s[j]==='\r') j++;
      if(s[j]==='\n'){ out.push(row); row=[]; j++; }
      i=j; continue;
    } else {
      let j=i; while(j<N && s[j]!==',' && s[j]!=='\n' && s[j]!=='\r') j++;
      row.push(s.slice(i,j));
      if(s[j]===','){ j++; }
      if(s[j]==='\r') j++;
      if(s[j]==='\n'){ out.push(row); row=[]; j++; }
      i=j; continue;
    }
  }
  if(row.length) out.push(row);
  return out;
}

async function importTrackerCsvFile(file){
  const text = await file.text();
  const rows = parseCSV(text);
  if(!rows.length){ alert("Empty CSV"); return; }

  // Expect exact header from Export CSV
  const header = rows[0].map(h=>h.trim().toLowerCase());
  const want = ["customer","customer id","ticket id","description","types","owner","sales owner","hours","assigned","activity"];
  if (want.some((w,idx)=>header[idx]!==w)) {
    alert("Unexpected header. First export from the app, then edit and re-import.");
    return;
  }

  const data = rows.slice(1).filter(r=>r.some(c=>c && c.trim()));
  let ok=0, fail=0, lastErr="";
  for(const r of data){
    const u = {
      customerName: r[0] || "",
      customerId: r[1] || "",
      ticketId: r[2] || "",
      description: r[3] || "",
      activityTypes: (r[4]||"").split("|").map(x=>x.trim()).filter(Boolean),
      owner: r[5] || "",
      salesOwner: r[6] || "",
      hours: Number(r[7]||0),
      assignedDate: r[8] || "",
      activityDate: r[9] || "",
    };
    try { await createActivity(u); ok++; }
    catch(e){ fail++; lastErr = String(e); }
  }
  if(fail) alert(`Imported ${ok}. Failed ${fail}. Last error: ${lastErr}`);
 // await doRefresh();
}
// ---- CSV helpers for Activities import (END) ----
  const scRef = useRef(null);
  useStableScrollbar(scRef);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[280px]">
          <Label>Search</Label>
          <input
            className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            placeholder="Customer, Ticket ID, Description"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="w-64">
          <Label>Owner</Label>
          <input
            className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            placeholder="Filter by Owner"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          />
        </div>

        {/* Single month box with tiny up/down arrows */}
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-2xl border border-slate-300 bg-white pl-3 pr-2 py-2 text-sm shadow-sm">
            <span className="min-w-[9rem] select-none">{fmtMonth(monthIdx)}</span>
            <div className="ml-2 flex flex-col">
               <button
                type="button"
                aria-label="Next month"
                onClick={()=>shiftMonth(+1)}
                style={{background:'transparent', border:'none', outline:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', padding:'0px'}}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </button>
                <button
                type="button"
                aria-label="Previous month"
                onClick={()=>shiftMonth(-1)}
                style={{background:'transparent', border:'none', outline:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', padding:'0px', marginTop:'0px'}}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="grow" />
         {/*
         <button
            onClick={doRefresh}
            title="Refresh"
            aria-label="Refresh"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white shadow-sm hover:bg-slate-50 hover:ring-1 hover:ring-slate-300"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cx("h-5 w-5 text-slate-700", refreshing && "animate-spin")}
            >
              <path d="M3 2v6h6" />
              <path d="M21 22v-6h-6" />
              <path d="M3.51 15a9 9 0 0014.13 3.36L21 16" />
              <path d="M20.49 9A9 9 0 006.36 5.64L3 8" />
            </svg>
          </button>
          */}
        
        <button onClick={() => setOpenAdd(true)} className="rounded-full bg-slate-900 px-5 py-2 text-sm text-white shadow-md hover:opacity-95">
          Add Activity
        </button>

        <button
          onClick={exportTrackerCsv}
          className="rounded-full border border-slate-300 bg-white px-5 py-2 text-sm shadow-sm hover:bg-slate-50"
        >
          Export CSV
        </button>

        <input
          id="trkCsv"
          type="file"
          accept=".csv"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importTrackerCsvFile(f);
            e.target.value = ""; // allow re-selecting same file
          }}
        />
        {/*
        <button
          type="button"
          onClick={() => document.getElementById("trkCsv").click()}
          className="rounded-full border border-slate-300 bg-white px-5 py-2 text-sm shadow-sm hover:bg-slate-50"
        >
          Import CSV
        </button>
          */}
      </div>

      <div ref={scRef} className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm" style={{maxHeight:"calc(100vh - 380px)", overflowY:"auto", paddingBottom:"80px"}}>
        <table className="w-full table-auto text-sm">
          {/* <colgroup>
              <col className="w-[100px]" /> */}{/* Customer */}
            {/* <col className="w-[100px]" /> */}{/* Customer ID */}
            {/* <col className="w-[100px]" /> */}{/* Ticket ID */}
            {/* <col className="w-[130px]" /> */}{/* Description */}
            {/* <col className="w-[60px]" /> */}{/* Types */}
            {/* <col className="w-[60px]" /> */}{/* Owner */}
            {/* <col className="w-[60px]" /> */}{/* Sales Owner */}
            {/* <col className="w-[30px]" /> */}{/* Hours */}
            {/* <col className="w-[60px]" /> */}{/* Assigned */}
            {/* <col className="w-[60px]" /> */}{/* Activity */}
            {/* <col className="w-[70px]" /> */}{/* Actions */}
            {/* </colgroup> */}
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-slate-600">

            <tr> 
              <Th className="w-[240px]">Customer</Th>
              <Th className="w-[220px]">Customer ID</Th>
              <Th className="w-[180px]">Ticket ID</Th>
              <Th className="w-[420px]">Description</Th>
              <Th className="w-[140px]">Types</Th>
              <Th className="w-[190px]">Owner</Th>
              <Th className="w-[160px]">Sales Owner</Th>
              <Th className="w-[100px]">Hours</Th> 
              <Th className="w-[140px]">Assigned</Th>
              <Th className="w-[140px]">Activity</Th>
              <Th className="w-[80px]"></Th> 
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => (
              <tr
                key={r.id}
                className="align-top border-t border-slate-100 even:bg-slate-50/40 hover:bg-slate-100 transition-colors"
              >
                <Td className="align-top whitespace-normal [overflow-wrap:anywhere]">{r.customerName}</Td>
                <Td className="align-top whitespace-normal [overflow-wrap:anywhere]">{r.customerId}</Td>
                <Td className="align-top font-mono whitespace-normal break-all">{r.ticketId}</Td>

                <Td className="align-top whitespace-normal [overflow-wrap:anywhere]">{r.description}</Td>

                <Td className="align-top">
                  <div className="flex flex-wrap gap-1.5">
                    {(r.activityTypes || []).length === 0 ? (
                      <span className="text-slate-400">NA</span>
                    ) : (
                      (r.activityTypes || []).map((t, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-700 border border-slate-200"
                          title={t}
                        >
                          {t}
                        </span>
                      ))
                    )}
                  </div>
                </Td>

                <Td className="align-top whitespace-normal [overflow-wrap:anywhere]">{r.owner}</Td>
                <Td className="align-top whitespace-normal [overflow-wrap:anywhere]">{r.salesOwner || ""}</Td>
                <Td className="align-top text-center tabular-nums">{to2(r.hours)}</Td>
                <Td className="align-top whitespace-normal [overflow-wrap:anywhere]">{r.assignedDate || ""}</Td>
                <Td className="align-top whitespace-normal [overflow-wrap:anywhere]">{r.activityDate || ""}</Td>
                <Td className="text-center">
                <div className="flex justify-end gap-2 p-2">
                  {/* Copy */}
                  {isNonEmpty(query) && (
                    <button
                      type="button"
                      aria-label="Copy"
                      title="Copy"
                      onClick={() => {
                        const t = todayISO();
                        setPrefillRow({ ...r, activityDate: t, assignedDate: weekStartISO(t) });
                        setOpenAdd(true);
                      }}
                      className="p-2 rounded-full border border-slate-300 bg-white shadow-sm hover:bg-slate-50"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                    </button>
                  )}

                  {/* Edit */}
                  <button
                    type="button"
                    aria-label="Edit"
                    title="Edit"
                    onClick={() => setEditRow(r)}
                    className="p-2 rounded-full border border-slate-300 bg-white shadow-sm hover:bg-slate-50"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9"/>
                      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                    </svg>
                  </button>
                </div>
              </Td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="p-6 text-center text-slate-500">
                  No rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination inside card (no borders) */}
      <div className="mt-3 flex items-center justify-between px-1 py-1">
        <div className="flex items-center gap-2 text-sm text-slate-700">
          <span>Rows per page</span>
          <select
            className="px-2 py-1 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-slate-400"
            value={pageSize}
            onChange={(e)=>setPageSize(Number(e.target.value))}
          >
            {[10,25,50,100].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span>
            {filtered.length ? `${(page-1)*pageSize+1}-${Math.min(page*pageSize, filtered.length)} of ${filtered.length}` : "0 of 0"}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={()=>setPage(p=>Math.max(1,p-1))}
            disabled={page===1}
            className="rounded px-2 py-1 disabled:opacity-50 hover:bg-slate-100"
            aria-label="Previous page"
          >
            ‹
          </button>

          <div className="mx-1 flex items-center gap-1">
            {(() => {
              const start = winStart;
              const end = Math.min(pageCount, start + windowSize - 1);

              const handleClick = (idx) => {
                if (idx === start) {
                  // left-most clicked -> move it to RIGHT-most
                  setWinStart(Math.max(1, idx - windowSize + 1));
                } else {
                  // any other click -> make it LEFT-most
                  setWinStart(Math.min(idx, maxStart));
                }
                setPage(idx);
              };

              return Array.from({ length: end - start + 1 }, (_, i) => {
                const idx = start + i;
                return (
                  <button
                    key={idx}
                    onClick={() => handleClick(idx)}
                    className={`w-9 h-9 inline-flex items-center justify-center rounded-md tabular-nums text-sm hover:bg-slate-100 ${
                      page === idx ? "bg-slate-900 text-white hover:bg-slate-900" : "text-slate-700"
                    }`}
                  >
                    {idx}
                  </button>
                );
              });
            })()}
          </div>

          <button
            onClick={()=>setPage(p=>Math.min(pageCount,p+1))}
            disabled={page===pageCount}
            className="rounded px-2 py-1 disabled:opacity-50 hover:bg-slate-100"
            aria-label="Next page"
          >
            ›
          </button>
        </div>
      </div>


      {openAdd && (
        <AddDialog
          initial={prefillRow ?? null}
          onClose={() => { setOpenAdd(false); setPrefillRow(null); }}
          onSubmit={onAdd}
          existingRows={rows}
        />
      )}
      {editRow && (
        <AddDialog
          initial={editRow}
          mode="edit"
          onClose={() => setEditRow(null)}
          onSubmit={(u) => updateActivity(editRow.id, u).then(() => setEditRow(null)).catch(e => alert(String(e)))}
          onDelete={() => {
            if (confirm("Delete this activity?")) {
              deleteActivity(editRow.id).then(() => setEditRow(null)).catch(e => alert(String(e)));
            }
          }}
          
          existingRows={rows}
        />
      )}
    </div>
  );
}

/* ================== Add Activity Dialog ================== */

function AddDialog({ onClose, onSubmit, existingRows, initial = null, mode = "add", onDelete}) {
  const [saving, setSaving] = useState(false);
  const [ticketFocus, setTicketFocus] = useState(false);
  const [form, setForm] = useState(
    initial ? {
      customerName: initial.customerName || "",
      customerId: initial.customerId || "",
      ticketId: initial.ticketId || "",
      description: initial.description || "",
      activityTypes: initial.activityTypes || [],
      owner: initial.owner || "",
      salesOwner: initial.salesOwner || "",
      hours: String(initial.hours ?? ""),
      assignedDate: initial.assignedDate || todayISO(),
      activityDate: initial.activityDate || todayISO(),
    } : {
      customerName: "",
      customerId: "",
      ticketId: "",
      description: "",
      activityTypes: [],
      owner: "",
      salesOwner: "",
      hours: "",
      assignedDate: todayISO(),
      activityDate: todayISO(),
    }
  );

  const [ownerOptions, setOwnerOptions] = useState([]);

    useEffect(() => {
      (async () => {
        try {
          const r = await fetch(`${API}/api/owners`);
          if (!r.ok) return;
          const j = await r.json();
          setOwnerOptions(Array.isArray(j.items) ? j.items : []);
        } catch (e) {
          // Non-fatal: owners list is only a helper
          console.error("owners fetch failed:", e);
        }
      })();
    }, []);

  const [error, setError] = useState("");

  const setF = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // suggestions by customer
  const ticketQuery = form.ticketId.trim().toLowerCase();
  const sameCustomer = useMemo(
    () =>
      existingRows.filter(
        (r) =>
          (isNonEmpty(form.customerName) && r.customerName === form.customerName) ||
          (isNonEmpty(form.customerId) && r.customerId === form.customerId)
      ),
    [existingRows, form.customerName, form.customerId]
  );
  const ticketSuggestions = useMemo(() => {
    const ids = Array.from(new Set(sameCustomer.map((r) => r.ticketId))).filter((id) => id.toLowerCase().includes(ticketQuery));
    return ids.slice(0, 8);
  }, [sameCustomer, ticketQuery]);

  function validate() {
    const errs = [];
    if (!isNonEmpty(form.customerName)) errs.push("Customer Name");
    if (!isNonEmpty(form.customerId)) errs.push("Customer ID");
    if (!isNonEmpty(form.ticketId)) errs.push("Ticket ID (use “To be Raised” if unknown)");
    if (!isNonEmpty(form.description)) errs.push("Activity Description");
    if (!isNonEmpty(form.owner)) errs.push("Owner");
    if (!Array.isArray(form.activityTypes) || form.activityTypes.length === 0) errs.push("Select at least one Activity Type");
    const h = Number(form.hours);
    if (!Number.isFinite(h) || h < 0) errs.push("Hours must be a number ≥ 0");
    if (!isNonEmpty(form.activityDate)) errs.push("Activity Date");
    return errs;
  }

  async function save() {
    const errs = validate();
    if (errs.length) {
      setError(errs.join("; "));
      return;
    }
    try {
      setSaving(true);
      await onSubmit({
        ...form,
        hours: Number(form.hours),
      });
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setSaving(false);
    }
  }

  function onNumberChange(setterKey) {
    return (e) => {
      const v = e.target.value.replace(/[^\d.]/g, "");
      const parts = v.split(".");
      const clean = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : v;
      setF(setterKey, clean);
    };
  }

  function toggleType(t) {
    setForm((p) => {
      const has = p.activityTypes.includes(t);
      return { ...p, activityTypes: has ? p.activityTypes.filter((x) => x !== t) : [...p.activityTypes, t] };
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-4xl rounded-3xl bg-white p-5 shadow-xl ring-1 ring-slate-100">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add Activity</h2>
          <button onClick={onClose} className="rounded-xl border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm">Close</button>
        </div>

        {error && <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-rose-700">{error}</div>}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <label className="block">
            <Label>Customer Name</Label>
            <input className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm" value={form.customerName} onChange={(e) => setF("customerName", e.target.value)} />
          </label>
          <label className="block">
            <Label>Customer ID</Label>
            <input className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm" value={form.customerId} onChange={(e) => setF("customerId", e.target.value)} />
          </label>

          <label className="block">
            <Label>Ticket ID</Label>
            <div className="relative">
              <input
                className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm font-mono"
                value={form.ticketId}
                onChange={(e) => setF("ticketId", e.target.value)}
                onFocus={() => setTicketFocus(true)}
                onBlur={() => setTimeout(() => setTicketFocus(false), 120)}
                placeholder="Type to search existing Ticket IDs"
              />
              {ticketFocus && isNonEmpty(form.ticketId) && ticketSuggestions.length > 0 && (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                  {ticketSuggestions.map((id) => (
                    <div
                      key={id}
                      className="cursor-pointer px-3 py-2 text-sm hover:bg-slate-50"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setF("ticketId", id); setTicketFocus(false); }}
                    >
                      {id}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-1">
              <button type="button" onClick={() => setF("ticketId", "To be Raised")} className="rounded-xl border border-slate-300 bg-white px-3 py-1 text-xs shadow-sm">
                To be Raised
              </button>
            </div>
          </label>

          <label className="block">
            <Label>Owner</Label>
            <input
              className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm"
              value={form.owner}
              onChange={(e) => setF("owner", e.target.value)}
              list="ownerOptions"
              placeholder="Type or pick an owner"
            />
            <datalist id="ownerOptions">
              {ownerOptions.map((o) => <option key={o} value={o} />)}
            </datalist>
          </label>
          <label className="block">
            <Label>Sales Owner</Label>
            <input className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm" value={form.salesOwner} onChange={(e) => setF("salesOwner", e.target.value)} />
          </label>

          <label className="block">
            <Label>Hours</Label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 text-center shadow-sm"
              value={form.hours}
              onChange={onNumberChange("hours")}
            />
          </label>

          <label className="block lg:col-span-2">
            <Label>Activity Types</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              {ACTIVITY_TYPES.map((t) => {
                const active = form.activityTypes.includes(t);
                return (
                  <button
                    type="button"
                    key={t}
                    onClick={() => toggleType(t)}
                    className={cx(
                      "rounded-full border px-3 py-1 text-sm",
                      active ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                    )}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </label>

          <label className="block lg:col-span-2">
            <Label>Activity Description</Label>
            <textarea className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm min-h-28" value={form.description} onChange={(e) => setF("description", e.target.value)} />
          </label>

          <label className="block">
            <Label>Assigned Date</Label>
            <input type="date" className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm" value={form.assignedDate} onChange={(e) => setF("assignedDate", e.target.value)} />
          </label>

          <label className="block">
            <Label>Activity Date</Label>
            <input type="date" className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 shadow-sm" value={form.activityDate} onChange={(e) => setF("activityDate", e.target.value)} />
          </label>
        </div>

        <div className="mt-4 flex justify-between gap-2">
          {mode === "edit" && onDelete ? (
            <button
              onClick={onDelete}
              className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-700 shadow-sm hover:bg-rose-100"
            >
              Delete
            </button>
          ) : <span />}

          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm shadow-sm">Cancel</button>
            <button onClick={save} disabled={saving}
               className="rounded-full bg-slate-900 px-5 py-2 text-sm text-white shadow-md disabled:opacity-60">
               {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/************************ Dashboard ************************/
function AdminDashboard() {
  const [mode, setMode] = useState("month"); // "month" | "year"
  const [monthIdx, setMonthIdx] = useState(() => {
    const d = new Date(); return d.getFullYear()*12 + d.getMonth();
  });
  const [year, setYear] = useState(() => new Date().getFullYear());

  // ------- Dashboard data -------
  // Year view state
  const [yearRows, setYearRows] = useState([]);
  const [yearLoading, setYearLoading] = useState(false);
  const [yearErr, setYearErr] = useState("");
  //month view state
  const [dashRows, setDashRows] = useState([]);
  // Hours Invested panel (month view)
  const [activeWeek, setActiveWeek] = useState(0); // 0..3
  const [actLoading, setActLoading] = useState(false);
  const [actErr, setActErr] = useState("");
  const [hoursOwners, setHoursOwners] = useState([]);           // sorted A–Z
  const [hoursByOwner, setHoursByOwner] = useState({});         // owner -> [w1,w2,w3,w4]

  const [dashLoading, setDashLoading] = useState(false);
  const [dashErr, setDashErr] = useState("");

  function fmtMonth(idx){
    const y = Math.floor(idx/12), m = idx%12;
    return new Date(y, m, 1).toLocaleString(undefined, { month:"long", year:"numeric" });
  }

  // Four Mondays for selected month
  function mondaysForMonth(idx) {
    const y = Math.floor(idx/12), m = idx%12;
    const d = new Date(y, m, 1);
    const day = d.getDay();                  // 0 Sun .. 6 Sat
    const delta = (1 - day + 7) % 7;         // Monday offset
    d.setDate(d.getDate() + delta);
    const out = [];
    for (let i = 0; i < 4; i++) {
      const di = new Date(d);
      di.setDate(di.getDate() + i*7);
      out.push(weekStartISO(localISO(di)));
    }
    return out;
  }

  // Four week windows for the selected month.
  // display: Mon–Fri label (may cross months)
  // calc: Mon–Sun inclusion for totals (not clamped to month)
  function weekWindows(idx) {
    const mondays = mondaysForMonth(idx); // 4 ISO Mondays

    return mondays.map((iso) => {
      const { displayStartISO, displayEndISO, calcStartISO, calcEndISO, displayStart, displayEnd, calcStart, calcEnd } =
        getWeekRanges(iso);
      return {
        displayStartISO, displayEndISO, displayStart, displayEnd,   // Mon–Fri
        calcStartISO, calcEndISO, calcStart, calcEnd                // Mon–Sun
      };
    });
  }

  function mondaysForYearMonth(y, m) {
  // m: 0-11
  const d = new Date(y, m, 1);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const delta = (1 - day + 7) % 7; // shift to Monday
  d.setDate(d.getDate() + delta);
  const out = [];
  for (let i = 0; i < 4; i++) {
  const di = new Date(d);
  di.setDate(di.getDate() + i*7);
  out.push(weekStartISO(localISO(di)));
  }
  return out;
  }

  // Mean of numeric rating values
  function overallScore(ratings) {
    const vals = Object.values(ratings || {})
      .map(v => typeof v === "number" ? v : parseFloat(v))
      .filter(n => Number.isFinite(n));
    if (!vals.length) return null;
    return vals.reduce((a,b)=>a+b,0)/vals.length;
  }

  useEffect(() => {
    if (mode !== "month") return;
    const weeks = mondaysForMonth(monthIdx);
    let cancelled = false;

    async function loadMonth() {
      setDashLoading(true); setDashErr("");
      try {
        const resps = await Promise.all(
          weeks.map(w =>
            fetch(`${API}/api/kpi?weekStart=${encodeURIComponent(w)}`)
              .then(r => { if (!r.ok) throw new Error(`KPI ${w}: ${r.status}`); return r.json(); })
          )
        );
        const map = new Map(); // owner -> [w1..w4]
        resps.forEach((wk, i) => {
          (wk.rows || []).forEach(row => {
            const s = overallScore(row.ratings);
            if (!map.has(row.owner)) map.set(row.owner, [null,null,null,null]);
            const arr = map.get(row.owner); arr[i] = s;
          });
        });
        const rows = [...map.entries()].map(([owner, w]) => {
          const monthVals = w.filter(v => v != null);
          const avg = monthVals.length ? monthVals.reduce((a,b)=>a+b,0)/monthVals.length : null;
          return { owner, w1:w[0], w2:w[1], w3:w[2], w4:w[3], avg };
        }).sort((a,b)=>a.owner.localeCompare(b.owner));

        if (!cancelled) setDashRows(rows);
      } catch (e) {
        if (!cancelled) setDashErr(String(e.message || e));
      } finally {
        if (!cancelled) setDashLoading(false);
      }
    }

    loadMonth();
    return () => { cancelled = true; };
  }, [mode, monthIdx]);

        // Hours Invested loader for month view
  useEffect(() => {
    if (mode !== "month") return;
    let cancelled = false;
    setActiveWeek(0); // reset on month change

    async function loadActivitiesForMonth() {
      try {
        setActLoading(true); setActErr(""); setHoursOwners([]); setHoursByOwner({});
        const r = await fetch(`${API}/api/activities`);
        if (!r.ok) throw new Error(await r.text());
        const j = await r.json();
        const items = Array.isArray(j.items) ? j.items : [];

        // 4 windows
        const windows = weekWindows(monthIdx); // [{start,end} x4]

        // Accumulate owner -> [0,0,0,0]
        const map = new Map();
        for (const x of items) {
          const owner = (x.owner || "").trim();
          if (!owner) continue;
          const dStr = (x.activity_date || x.created_at || "").slice(0,10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dStr)) continue;
          const [Y,M,D] = dStr.split("-").map(Number);
          const dt = new Date(Y, M-1, D);

          // bucket to week 0..3
          let idx = -1;
          for (let i=0;i<4;i++){
            if (dt >= windows[i].calcStart && dt <= windows[i].calcEnd) { idx = i; break; }
          }
          if (idx < 0) continue;

          const h = Number(x.hours ?? 0);
          if (!map.has(owner)) map.set(owner, [0,0,0,0]);
          const arr = map.get(owner);
          arr[idx] += Number.isFinite(h) ? h : 0;
        }

        // Normalize, round, sort owners A–Z
        const owners = [...map.keys()].sort((a,b)=>a.localeCompare(b));
        const byOwner = {};
        owners.forEach(o => {
          const arr = map.get(o) || [0,0,0,0];
          byOwner[o] = arr.map(v => Math.round(v));
        });

        if (!cancelled) {
          setHoursOwners(owners);
          setHoursByOwner(byOwner);
        }
      } catch (e) {
        if (!cancelled) setActErr(String(e.message || e));
      } finally {
        if (!cancelled) setActLoading(false);
      }
    }

    loadActivitiesForMonth();
    return () => { cancelled = true; };
  }, [mode, monthIdx]);

  // ---------- Year view loader ----------
  useEffect(() => {
  if (mode !== "year") return;
  let cancelled = false;
  async function loadYear() {
  setYearLoading(true); setYearErr(""); setYearRows([]);
  try {
  const y = year;
  // Build 12×4 weekStart ISO dates
  const monthsWeeks = Array.from({ length: 12 }, (_ , m) => mondaysForYearMonth(y, m));

  // Flatten to a list of {mIndex, weekISO}
  const tasks = [];
  monthsWeeks.forEach((weeks, mIdx) => {
  weeks.forEach(w => tasks.push({mIdx, w}));
  });
  // Fetch all weeks
  const results = await Promise.all(
    tasks.map(({ mIdx, w }) =>
      fetch(`${API}/api/kpi?weekStart=${encodeURIComponent(w)}`)
        .then(r => {
          if (!r.ok) throw new Error(`KPI ${w}: ${r.status}`);
          return r.json();
        })
        .then(json => ({ mIdx, rows: (json && json.rows) || [] }))
    )
  );
  // Accumulate owner -> [m1..m12] where each month is mean of its 4 week means
  // First, for each month, compute per-owner weekly means array
  const perMonthOwnerWeeks = Array.from({length:12}, () => new Map()); // month -> owner -> number[]
  results.forEach(({mIdx, rows}) => {
  rows.forEach(r => {
  const s = overallScore(r.ratings);
  if (!perMonthOwnerWeeks[mIdx].has(r.owner)) perMonthOwnerWeeks[mIdx].set(r.owner, []);
  perMonthOwnerWeeks[mIdx].get(r.owner).push(Number.isFinite(s) ? s : null);
  });
  });
  // Now compute month mean per owner
  const ownerSet = new Set();
  perMonthOwnerWeeks.forEach(map => map.forEach((_, owner) => ownerSet.add(owner)));
  const rows = [];
  ownerSet.forEach(owner => {
  const months = [];
  for (let m=0; m<12; m++) {
  const arr = perMonthOwnerWeeks[m].get(owner) || [];
  const vals = arr.filter(v => v != null);
  const avg = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
  months.push(avg);
  }
  const yearVals = months.filter(v => v != null);
  const yearAvg = yearVals.length ? yearVals.reduce((a,b)=>a+b,0)/yearVals.length : null;
  rows.push({ owner, months, yearAvg });
  });
  rows.sort((a,b)=>a.owner.localeCompare(b.owner));
  if (!cancelled) setYearRows(rows);
  } catch (e) {
  if (!cancelled) setYearErr(String(e.message || e));
  } finally {
  if (!cancelled) setYearLoading(false);
  }
  }
  loadYear();
  return () => { cancelled = true; };
}, [mode, year]);

 // ------- tiny inline SVG bar chart -------
    function SimpleBarChart({ labels, values, max = 7, height = 280 }) {
    const n = values.length;
    const bw = 36;            // bar width
    const gap = 40;           // gap between bars
    const w = Math.max(700, n ? n * bw + (n - 1) * gap + 60 : 700);
    const h = height;
    const topPad = 20, leftPad = 40, bottomPad = 40, rightPad = 20;
    const innerH = h - topPad - bottomPad;
    const yScale = (v) => (innerH * (v || 0)) / max;

    // categorical, color-blind-safe palette (distinct hues)
    const _PALETTE = [
      "#1b9e77","#d95f02","#7570b3","#e7298a",
      "#66a61e","#e6ab02","#a6761d","#666666",
      "#1f78b4","#b2df8a","#fb9a99","#fdbf6f"
    ];
    const colorFor = (name) => {
      let h = 0;
      const s = String(name);
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      return _PALETTE[h % _PALETTE.length];
    };

    const ticks = Array.from({ length: max + 1 }, (_, i) => i); // 0..max

    return (
      <svg width={w} height={h} role="img" aria-label="Bar chart">
        <rect x="0" y="0" width={w} height={h} fill="white" />
        {/* y-grid + labels */}
        {ticks.map((t) => {
          const y = h - bottomPad - yScale(t);
          return (
            <g key={t}>
              <line x1={leftPad} y1={y} x2={w - rightPad} y2={y} stroke="#e2e8f0" />
              <text x={leftPad - 8} y={y + 3} fontSize="12" textAnchor="end" fill="#64748b">{t}</text>
            </g>
          );
        })}
        {/* x-axis */}
        <line x1={leftPad} y1={h - bottomPad} x2={w - rightPad} y2={h - bottomPad} stroke="#cbd5e1" />

        {/* bars + value labels + x labels */}
        {values.map((v, i) => {
          const x = leftPad + i * (bw + gap);
          const barH = Math.max(0, Math.min(innerH, yScale(v)));
          const y = h - bottomPad - barH;
          const c = colorFor(labels[i] ?? i);
          return (
            <g key={i}>
              <rect x={x} y={y} width={bw} height={barH} fill={c} />
              {Number.isFinite(v) && <text x={x + bw / 2} y={y - 6} textAnchor="middle" fontSize="12" fill="#0f172a">{v.toFixed(2)}</text>}
              <text x={x + bw / 2} y={h - 10} textAnchor="middle" fontSize="12" fill="#475569">{labels[i]}</text>
            </g>
          );
        })}
      </svg>
    );
  }

  // Helpers for chart data
  const dashMonthLabels = dashRows.map(r => r.owner);
  const dashMonthVals   = dashRows.map(r => r.avg ?? 0);

  const monthsShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthTeamAvg = (i) => {
    const vals = yearRows.map(r => r.months?.[i]).filter(v => v != null && Number.isFinite(v));
    return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
  };
  const yearLabels = monthsShort;
  const yearVals   = Array.from({length:12}, (_,i)=>monthTeamAvg(i));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Dashboard</h2>
          <p className="text-sm text-slate-500">KPI Ratings & Invested Hours Overview.</p>
        </div>

        <div className="flex items-center gap-4">
          {/* Mode toggle */}
          <div className="flex rounded-2xl border border-slate-300 p-1 bg-white">
            {["month","year"].map(t => (
              <button key={t}
                onClick={()=>setMode(t)}
                className={`px-3 py-1 text-sm rounded-xl ${mode===t ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"}`}>
                {t==="month" ? "Month" : "Year"}
              </button>
            ))}
          </div>

          {/* Month control */}
          {mode==="month" && (
            <div className="mt-1 flex items-start">
              <div className="rounded-2xl border border-slate-300 px-3 py-2 shadow-sm bg-white min-w-[200px]">
                {fmtMonth(monthIdx)}
              </div>
              <div className="ml-2 flex flex-col" style={{alignSelf:"center"}}>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={()=>setMonthIdx(i=>i+1)}
                  style={{background:"transparent", border:"none", outline:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:"2px"}}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="18 15 12 9 6 15" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={()=>setMonthIdx(i=>i-1)}
                  style={{background:"transparent", border:"none", outline:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:"2px", marginTop:"4px"}}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Year control */}
          {mode==="year" && (
            <div className="mt-1 flex items-start">
              <div className="rounded-2xl border border-slate-300 px-3 py-2 shadow-sm bg-white min-w-[120px] text-center">
                {year}
              </div>
              <div className="ml-2 flex flex-col" style={{alignSelf:"center"}}>
                <button
                  type="button"
                  aria-label="Next year"
                  onClick={()=>setYear(y=>y+1)}
                  style={{background:"transparent", border:"none", outline:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:"2px"}}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="18 15 12 9 6 15" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label="Previous year"
                  onClick={()=>setYear(y=>y-1)}
                  style={{background:"transparent", border:"none", outline:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:"2px", marginTop:"4px"}}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Month table */}
      {mode === "month" && (
        <div className="rounded-2xl border border-slate-200 p-6 bg-white">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm text-slate-500">Weekly KPI overview for {fmtMonth(monthIdx)}</div>
            {dashLoading && <div className="text-xs text-slate-500">Loading…</div>}
          </div>
          {dashErr && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-2 text-rose-700 text-sm">{dashErr}</div>}
          {/* Month bar chart: one bar per owner using Monthly Avg */}
          {/* Chart (left) + Hours panel (right) */}
          <div className="mb-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="overflow-auto">
              <SimpleBarChart
                labels={dashMonthLabels}
                values={dashMonthVals}
                max={7}
                height={280}
              />
            </div>

            {/* Clean panel: no border, centered numbers, arrows at bottom, date range on left */}
            <div className="p-4">
              {/* Top line: bold week label + date range on the right-empty area */}
              {(() => {
                const windows = weekWindows(monthIdx);
                const cur = windows[Math.min(Math.max(activeWeek,0),3)];
                return (
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-sm font-semibold text-slate-800">
                      Week {activeWeek + 1}
                    </div>
                    <div className="text-xs font-semibold text-black relative -top-1 leading-none">
                      {fmtShort(cur.displayStartISO)} – {fmtShort(cur.displayEndISO)}
                    </div>
                  </div>
                );
              })()}

              {actLoading && <div className="text-xs text-slate-500">Loading…</div>}
              {actErr && (
                <div className="mb-2 rounded-xl border border-rose-200 bg-rose-50 p-2 text-rose-700 text-sm">
                  {actErr}
                </div>
              )}

              {hoursOwners.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-sm">No data</div>
              ) : (
                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-slate-600">
                        {hoursOwners.map((o) => (
                          <th key={o} className="py-2 px-3 text-center font-semibold">{o}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-slate-100">
                        {hoursOwners.map((o) => {
                          const arr = hoursByOwner[o] || [0,0,0,0];
                          const v = arr[activeWeek] ?? 0;
                          return <td key={o} className="py-3 px-3 text-center tabular-nums">{v}</td>;
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {/* Bottom controls: chevrons without borders, aligned right */}
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  aria-label="Previous week"
                  onClick={() => setActiveWeek(w => Math.max(0, w - 1))}
                  disabled={activeWeek === 0}
                  style={{background:"transparent", border:"none", outline:"none", cursor:"pointer", padding:"2px", opacity: activeWeek===0 ? 0.35 : 1}}
                >
                  {/* Left chevron SVG (same style as existing icons) */}
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"
                      viewBox="0 0 24 24" fill="none" stroke="#0f172a" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>

                <button
                  type="button"
                  aria-label="Next week"
                  onClick={() => setActiveWeek(w => Math.min(3, w + 1))}
                  disabled={activeWeek === 3}
                  style={{background:"transparent", border:"none", outline:"none", cursor:"pointer", padding:"2px", opacity: activeWeek===3 ? 0.35 : 1}}
                >
                  {/* Right chevron SVG */}
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"
                      viewBox="0 0 24 24" fill="none" stroke="#0f172a" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-600">
                  <th className="py-2 pr-4">Owner</th>
                  <th className="py-2 px-3">W1</th>
                  <th className="py-2 px-3">W2</th>
                  <th className="py-2 px-3">W3</th>
                  <th className="py-2 px-3">W4</th>
                  <th className="py-2 pl-3">Monthly Avg</th>
                </tr>
              </thead>
              <tbody>
                {dashRows.length === 0 ? (
                  <tr><td colSpan={6} className="py-6 text-center text-slate-400">No data</td></tr>
                ) : (
                  dashRows.map(r => (
                    <tr key={r.owner} className="border-t border-slate-100">
                      <td className="py-2 pr-4 text-slate-800">{r.owner}</td>
                      <td className="py-2 px-3">{r.w1 != null ? r.w1.toFixed(2) : "-"}</td>
                      <td className="py-2 px-3">{r.w2 != null ? r.w2.toFixed(2) : "-"}</td>
                      <td className="py-2 px-3">{r.w3 != null ? r.w3.toFixed(2) : "-"}</td>
                      <td className="py-2 px-3">{r.w4 != null ? r.w4.toFixed(2) : "-"}</td>
                      <td className="py-2 pl-3 font-medium">{r.avg != null ? r.avg.toFixed(2) : "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Year table */}
      {mode === "year" && (
      <div className="rounded-2xl border border-slate-200 p-6 bg-white">
      <div className="mb-3 flex items-center justify-between">
      <div className="text-sm text-slate-500">Monthly KPI averages for {year}</div>
      {yearLoading && <div className="text-xs text-slate-500">Loading…</div>}
      </div>
      {yearErr && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-2 text-rose-700 text-sm">{yearErr}</div>}
                {/* Year bar chart: team average per month */}
          <div className="mb-4 overflow-auto">
            <SimpleBarChart
              labels={yearLabels}
              values={yearVals}
              max={7}
              height={280}
            />
          </div>
      <div className="overflow-auto">
      <table className="min-w-full text-sm">
      <thead>
      <tr className="text-left text-slate-600">
      <th className="py-2 pr-4">Owner</th>
      <th className="py-2 px-3">Jan</th>
      <th className="py-2 px-3">Feb</th>
      <th className="py-2 px-3">Mar</th>
      <th className="py-2 px-3">Apr</th>
      <th className="py-2 px-3">May</th>
      <th className="py-2 px-3">Jun</th>
      <th className="py-2 px-3">Jul</th>
      <th className="py-2 px-3">Aug</th>
      <th className="py-2 px-3">Sep</th>
      <th className="py-2 px-3">Oct</th>
      <th className="py-2 px-3">Nov</th>
      <th className="py-2 px-3">Dec</th>
      <th className="py-2 pl-3">Year Avg</th>
      </tr>
      </thead>
      <tbody>
      {yearRows.length === 0 ? (
      <tr><td colSpan={14} className="py-6 text-center text-slate-400">No data</td></tr>
      ) : (
      yearRows.map(r => (
      <tr key={r.owner} className="border-t border-slate-100">
      <td className="py-2 pr-4 text-slate-800">{r.owner}</td>
      {r.months.map((val, i) => (
      <td key={i} className="py-2 px-3">{val != null ? val.toFixed(2) : "-"}</td>
      ))}
      <td className="py-2 pl-3 font-medium">{r.yearAvg != null ? r.yearAvg.toFixed(2) : "-"}</td>
      </tr>
      ))
      )}
      </tbody>
      </table>
      </div>
      </div>
      )}
    </div>
  );
}


/* ================== KPI Page ================== */

function KPIPage() {
  const [weekStart, setWeekStart] = useState(weekStartISO(todayISO()));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
// const [kpiImporting, setKpiImporting] = useState(false);
// const [kpiImportProgress, setKpiImportProgress] = useState({ done: 0, total: 0 });

  async function load(week) {
    setLoading(true); setErr("");
    try {
      const r = await fetch(`${API}/api/kpi?weekStart=${encodeURIComponent(week)}`);
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setRows(j.rows || []);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  // load on mount and whenever weekStart changes
  useEffect(() => { load(weekStart); }, [weekStart]);

  function onWeekChange(v) {
    const wk = weekStartISO(v);
    setWeekStart(wk);
  }

  function patchRow(idx, patch) {
    setRows(prev => prev.map((r,i) => i===idx ? { ...r, ...patch } : r));
  }

  async function saveRow(r) {
    const payload = {
      owner: r.owner,
      weekStart,
      ratings: r.ratings || {},
      descOverride: r.descOverride ?? null,
    };
    const res = await fetch(`${API}/api/kpi`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      if (res.status === 409) {
        throw new Error("Locked: this KPI row has already been submitted.");
      }
      throw new Error(await res.text());
    }
    return res.json();
}



  function exportKpiCsv() {
  const cols = [
    "Owner","Total Activities","Activity Description",
    "Avg Quality Rating","Avg Completion Time","Proactiveness","Ownership",
    "Technical Knowledge","Team Collaboration","Stakeholder Satisfaction",
    "Worked Outside Hours","Updated"
  ];
  const lines = [cols.join(",")];

  rows.forEach(r => {
    const ratings = { ...(r.ratings || {}) };
    const get = k => (ratings[k] ?? "").toString().replaceAll(",", " ");
    const desc = (r.descOverride ?? r.descAuto ?? "").replaceAll("\n", " | ").replaceAll(",", " ");
     lines.push([
      csvCell(r.owner),
      csvCell(r.totalActivities ?? 0),
      csvCell(desc),
      csvCell(get("Avg Quality Rating")),
      csvCell(get("Avg Completion Time")),
      csvCell(get("Proactiveness")),
      csvCell(get("Ownership")),
      csvCell(get("Technical Knowledge")),
      csvCell(get("Team Collaboration")),
      csvCell(get("Stakeholder Satisfaction")),
      csvCell(get("Worked Outside Hours")),
      csvCell((r.updatedAt || "").toString().slice(0,10))
    ].join(","));
  });

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `kpi_${weekStart}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* --- KPI CSV Import: logic --- 

// tolerant CSV parser: quotes, commas, newlines
function parseCSV(text) {
  const out = [];
  let i = 0, row = [], s = text, N = s.length;
  while (i < N) {
    if (s[i] === '"') {
      let j = ++i, cell = "";
      while (j < N) {
        if (s[j] === '"') {
          if (s[j + 1] === '"') { cell += '"'; j += 2; continue; }
          j++;
          break;
        }
        cell += s[j++];
      }
      row.push(cell);
      if (s[j] === ",") j++;
      if (s[j] === "\r") j++;
      if (s[j] === "\n") { out.push(row); row = []; j++; }
      i = j;
    } else {
      let j = i;
      while (j < N && s[j] !== "," && s[j] !== "\n" && s[j] !== "\r") j++;
      row.push(s.slice(i, j));
      if (s[j] === ",") j++;
      if (s[j] === "\r") j++;
      if (s[j] === "\n") { out.push(row); row = []; j++; }
      i = j;
    }
  }
  if (row.length) out.push(row);
  return out;
}

// parse week_start like "3/31/2025" or "2025-03-31" -> "YYYY-MM-DD"
function parseWeekStart(v) {
  if (!v) return null;
  const t = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // M/D/YYYY or D/M/YYYY
  if (!m) return null;
  let a = parseInt(m[1], 10), b = parseInt(m[2], 10), y = parseInt(m[3], 10);
  // If first part > 12 then it's D/M/YYYY, else assume M/D/YYYY
  let mm, dd;
  if (a > 12) { dd = a; mm = b; } else { mm = a; dd = b; }
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const iso = `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  return iso;
}

// normalize header names: lower, strip dots and extra spaces/underscores
const norm = (s) => String(s || "")
  .toLowerCase()
  .replace(/\./g, "")
  .replace(/_/g, " ")
  .replace(/\s+/g, " ")
  .trim();

// map incoming header -> server rating key expected by UI/server
const ratingKeyMap = {
  "avg quality rating": "Avg Quality Rating",
  "avg completion time": "Avg Completion Time",
  "proactiveness": "Proactiveness",
  "ownership": "Ownership",
  "technical knowledge": "Technical Knowledge",
  "team collaboration": "Team Collaboration",
  "stakeholder satisfaction": "Stakeholder Satisfaction",
  "worked outside hours": "Worked Outside Hours",
};

async function importKpiCsvFile(file) {
    if (kpiImporting) { alert("Import already in progress."); return; }
  setKpiImporting(true);
  const text = await file.text();
  const rows2d = parseCSV(text);
  if (!rows2d.length) { alert("Empty CSV"); return; }

  // header
  const H = rows2d[0].map(h => h.trim());
  const Hn = H.map(norm);

  const idxOwner = Hn.indexOf("owner");
  const idxWeek  = Hn.indexOf("week start") >= 0 ? Hn.indexOf("week start") : Hn.indexOf("weekstart") >= 0 ? Hn.indexOf("weekstart") : Hn.indexOf("week_start");
  const idxDesc  = Hn.indexOf("activity description");

  if (idxOwner < 0) { alert("Missing 'Owner' column."); return; }
  if (idxWeek  < 0) { alert("Missing 'week_start' column."); return; }

  // rating column indices by normalized header
  const ratingCols = {};
  for (let i = 0; i < Hn.length; i++) {
    const k = ratingKeyMap[Hn[i]];
    if (k) ratingCols[k] = i; // store with server-expected key
  }

  // ensure all required rating keys exist; tolerate if user wants to import without some ratings
  const required = Object.values(ratingKeyMap);
  const missing = required.filter(k => ratingCols[k] == null);
  if (missing.length) {
    // soft warning only
    console.warn("Missing rating columns in CSV:", missing);
  }

  const dataRows = rows2d.slice(1).filter(r => r.some(c => c && String(c).trim().length));
  setKpiImportProgress({ done: 0, total: dataRows.length });
  let ok = 0, fail = 0, lastErr = "";

  for (const r of dataRows) {
    const owner = (r[idxOwner] || "").toString().trim();
    if (!owner) { fail++; lastErr = "Owner empty"; continue; }

    const ws = parseWeekStart(r[idxWeek]);
    if (!ws) { fail++; lastErr = `Bad week_start for ${owner}`; continue; }

    const ratings = {};
    for (const serverKey of Object.values(ratingKeyMap)) {
      const j = ratingCols[serverKey];
      if (j == null) continue;
      let v = (r[j] || "").toString().trim();
       // normalize numeric cells like "6.6", "7", "7,0", "7 %"
      const t = v.replace(/%/g, "").replace(/,/g, ".").trim();
      const n = t === "" ? NaN : Number(t);
      v = Number.isFinite(n) ? n : t; // send number when valid, else raw string
      ratings[serverKey] = v;
    }

    const descOverride = idxDesc >= 0 ? (r[idxDesc] || "").toString().trim() : null;

    try {
      const res = await fetch(`${API}/api/kpi`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner,
          weekStart: ws,            // honor CSV week_start
          ratings,
          descOverride: descOverride || null,
        }),
      });
      if (!res.ok) {
        if (res.status === 409) throw new Error("Locked row");
        throw new Error(await res.text());
      }
      ok++;
    } catch (e) {
        fail++;
        const errMsg = String(e && e.message ? e.message : e);
        lastErr = `Owner: ${owner || "?"}, week_start: ${ws || "?"}, error: ${errMsg}`;
    }
  }
   setKpiImportProgress(p => ({ done: p.done + 1, total: p.total }));

  try {
    alert(`KPI import complete. Success: ${ok}. Failed: ${fail}${fail ? `.\nLast error: ${lastErr}` : ""}`);
    // refresh current view only
    await load(weekStart);
  } finally {
    setKpiImporting(false);
    setKpiImportProgress({ done: 0, total: 0 });
  }
}
--- end KPI CSV Import: logic --- */

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label>Week start</Label>
          <div className="mt-1 flex items-start">
            <input
              type="date"
              className="rounded-2xl border border-slate-300 px-3 py-2 shadow-sm"
              value={weekStart}
              onChange={(e)=>onWeekChange(e.target.value)}
            />
            <div className="ml-2 flex flex-col" style={{alignSelf:'center'}}>
              <button
                type="button"
                aria-label="Next week"
                onClick={()=>{
                  const next = new Date(weekStart);
                  next.setDate(next.getDate() + 7);
                  setWeekStart(weekStartISO(next.toISOString().slice(0,10)));
                }}
                style={{background:'transparent', border:'none', outline:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', padding:'0px'}}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </button>
              <button
                type="button"
                aria-label="Previous week"
                onClick={()=>{
                  const prev = new Date(weekStart);
                  prev.setDate(prev.getDate() - 7);
                  setWeekStart(weekStartISO(prev.toISOString().slice(0,10)));
                }}
                style={{background:'transparent', border:'none', outline:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', padding:'2px', marginTop:'4px'}}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
</div>

        </div>

        <div className="grow" />
        <div className="pt-6 text-sm text-slate-500">
          Week: {fmtShort(weekStart)} – {fmtShort(weekEndISO(weekStart))}
        </div>

        <button
          onClick={exportKpiCsv}
          className="rounded-full border border-slate-300 bg-white px-5 py-2 text-sm shadow-sm hover:bg-slate-50"
        >
          Export CSV
        </button>

       {/* --- KPI CSV Import: UI --- */}
       {/*
        <input
          id="kpiCsv"
          type="file"
          accept=".csv"
          style={{ display: "none" }}
          onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importKpiCsvFile(f);
              e.target.value = "";
          }}
        />
        <button
          onClick={() => document.getElementById("kpiCsv").click()}
          disabled={kpiImporting}
          className={`rounded-full border border-slate-300 px-5 py-2 text-sm shadow-sm ${kpiImporting ? "bg-slate-100 cursor-not-allowed" : "bg-white hover:bg-slate-50"}`}
        >
          {kpiImporting
            ? (kpiImportProgress.total > 0
                ? `Importing… ${kpiImportProgress.done}/${kpiImportProgress.total}`
                : "Importing…")
            : "Import CSV"}
        </button>
        */}
        {/* --- end KPI CSV Import: UI --- */} 
        {/*
        <button
            onClick={() => load(weekStart)}
            title="Refresh"
            aria-label="Refresh"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white shadow-sm hover:bg-slate-50 hover:ring-1 hover:ring-slate-300"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cx("h-5 w-5 text-slate-700", loading && "animate-spin")}
            >
              {refresh-ccw icon }
              <path d="M3 2v6h6" />
              <path d="M21 22v-6h-6" />
              <path d="M3.51 15a9 9 0 0014.13 3.36L21 16" />
              <path d="M20.49 9A9 9 0 006.36 5.64L3 8" />
            </svg>
          </button>
          */}
      </div>

      {err && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-rose-700">{err}</div>}
      {loading && <div className="text-slate-500">Loading…</div>}

      <div className="overflow-x-auto rounded-2xl border border-slate-200" style={{maxHeight:"calc(100vh - 340px)", overflowY:"auto"}}>

        <table className="min-w-full table-fixed text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <Th className="w-[260px]">Owner</Th>
              <Th className="w-36 text-center">Total Activities</Th>
              <Th className="w-[640px]">Activity Description</Th>
              <Th className="min-w-[960px]">Ratings</Th>
              <Th className="w-[250px]">Updated</Th>
              <Th className="w-24"></Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <KRow
                key={r.owner}
                row={r}
                onChange={(patch) => patchRow(idx, patch)}
                onSave={async () => {
                  await saveRow(rows[idx]);
                  await load(weekStart);                 // pull persisted ratings/override from DB
                }}
              />
            ))}
            {(!rows || rows.length === 0) && !loading && (
              <tr><td colSpan={6} className="p-6 text-center text-slate-500">No activity in the selected week.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KRow({ row, onChange, onSave }) {
  const locked = !!row.locked;
  const [edit, setEdit] = useState(false);

  // Ensure ratings object has all keys
  const ratings = { ...(row.ratings || {}) };
  for (const k of RATING_KEYS) if (!(k in ratings)) ratings[k] = "";

return (
  <tr className="border-t border-slate-100">
    <Td className="align-top whitespace-nowrap">{row.owner}</Td>
    <Td className="align-top text-center">{row.totalActivities ?? row.total ?? 0}</Td>

    <Td className="align-top">
      {edit && !locked ? (
        <textarea
          className="w-full min-h-28 rounded-xl border border-slate-300 px-3 py-2"
          value={row.descOverride ?? row.descAuto ?? ""}
          onChange={(e) => onChange({ descOverride: e.target.value })}
          disabled={locked || !edit}
        />
      ) : (
        <pre className="whitespace-pre-wrap break-all font-sans text-sm leading-5">
          {(row.descOverride ?? row.descAuto ?? "")}
        </pre>
      )}
    </Td>

    <Td className="align-top">
      <div className="grid grid-cols-8 gap-4 items-start">
        {RATING_KEYS.map((k) => (
          <div key={k} className="flex flex-col items-center w-24">
            <div className="h-8 text-[10px] leading-tight text-center">{k}</div>
            <input
              className={
                "w-16 rounded-md border border-slate-300 px-2 py-1 text-sm text-center " +
                (locked || !edit ? "opacity-60 bg-slate-50" : "")
              }
              disabled={locked || !edit}
              value={ratings[k]}
              onChange={(e) =>
                onChange({
                  ratings: {
                    ...ratings,
                    [k]: e.target.value.replace(/[^0-7]/g, "").slice(0, 2),
                  },
                })
              }
              placeholder="TBF"
            />
          </div>
        ))}
      </div>
    </Td>

    <Td className="align-top whitespace-nowrap tabular-nums text-sm">{(row.updatedAt || "").toString().slice(0, 10)}</Td>

    <Td className="align-top text-center">
        {locked ? (
          <span className="inline-block rounded-full bg-slate-200 px-3 py-1 text-xs text-slate-700">Locked</span>
        ) : !edit ? (
          <button
            onClick={() => setEdit(true)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm"
          >
            Edit
          </button>
        ) : (
          <button
            onClick={async () => { await onSave(); setEdit(false); }}
            className="rounded-full bg-slate-900 px-4 py-1 text-sm text-white shadow"
          >
            Save
          </button>
        )}
    </Td>
  </tr>
);
}


function SpiritStyles() {
  // inject Google Font + component CSS once
  useEffect(() => {
    if (!document.getElementById("spirit-font")) {
      const l1 = document.createElement("link");
      l1.id = "spirit-font";
      l1.rel = "stylesheet";
      l1.href = "https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600&display=swap";
      document.head.appendChild(l1);
    }
    if (!document.getElementById("spirit-css")) {
      const style = document.createElement("style");
      style.id = "spirit-css";
      style.textContent = `
        :root { --sp-dark:#0f172a; --sp-muted:#6b7280; --sp-card:#ffffff; }
        .spirit-ghost { filter: drop-shadow(0 4px 10px rgba(15,23,42,.15)); transition: transform .2s; }
        .spirit-ghost:hover { transform: translateY(-2px); }
        .spirit-float { animation: spirit-float 3s ease-in-out infinite; }
        @keyframes spirit-float { 0%{transform: translateY(0)} 50%{transform: translateY(-6px)} 100%{transform: translateY(0)} }
        .spirit-pop { animation: spirit-pop .5s cubic-bezier(.2,.7,.2,1) forwards; }
        @keyframes spirit-pop {
          0%   { transform: translate3d(0,4px,0) scale(.98); opacity: 0; }
          60%  { transform: translate3d(0,0,0) scale(1.02); opacity: 1; }
          100% { transform: translate3d(0,0,0) scale(1);    opacity: 1; }
        }
        .spirit-fade { animation: spirit-fade .24s ease forwards; }
        @keyframes spirit-fade { from{opacity:0} to{opacity:1} }

        .spirit-bubble{
        position:absolute; bottom:40px;
        background:#111; color:#fff;
        font: 500 12px/1.4 Poppins, system-ui, sans-serif;
        padding:6px 10px; border-radius:12px;
        pointer-events:none;

        /* key fixes */
        width: max-content;            /* let it grow to content size */
        max-width: calc(100vw - 40px); /* still prevent viewport overflow */
        white-space: nowrap;           /* keep one line */
      }

      .spirit-bubble:after{
        content:""; position:absolute; bottom:-6px; right:10px;   /* arrow from right */
        width:0; height:0;
        border-left:6px solid transparent; border-right:6px solid transparent; border-top:6px solid #111;
      }

      .spirit-overlay {
      position: fixed; inset: 0; z-index: 9998;
      display:flex; align-items:center; justify-content:center;
      font-family: Poppins, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;

      /* Updated to Google's core 4-color gradient */
      background-color: rgba(17,17,17,0.35);
      background: linear-gradient(
        135deg,
        #4285F4, /* Blue */
        #EA4335, /* Red */
        #FBBC04, /* Yellow */
        #34A853, /* Green */
        #4285F4  /* Blue (to loop) */
      );
      background-size: 600% 600%;
      animation: spirit-grad 16s ease infinite;
    }

    /* You need this @keyframes rule for the animation to work.
      It animates the background-position to slide the gradient.
    */
    @keyframes spirit-grad {
      0% {
        background-position: 0% 50%;
      }
      50% {
        background-position: 100% 50%;
      }
      100% {
        background-position: 0% 50%;
      }
    }
    @keyframes spirit-grad {
      0%   { background-position: 0% 50%; }
      25%  { background-position: 50% 30%; }
      50%  { background-position: 100% 50%; }
      75%  { background-position: 50% 70%; }
      100% { background-position: 0% 50%; }
    }
      @keyframes spirit-grad {
        0%   { background-position: 0% 50%; }
        25%  { background-position: 50% 30%; }
        50%  { background-position: 100% 50%; }
        75%  { background-position: 50% 70%; }
        100% { background-position: 0% 50%; }
      }
      @keyframes spirit-grad-move {
        0%   { background-position: 0% 50%; }
        25%  { background-position: 50% 50%; }
        50%  { background-position: 100% 50%; }
        75%  { background-position: 50% 50%; }
        100% { background-position: 0% 50%; }
      }
        .spirit-card {
        width:min(92vw, 720px);
        background: var(--sp-card);
        border-radius: 18px; padding: 28px 32px;
        box-shadow: 0 12px 36px rgba(15,23,42,.12), 0 2px 6px rgba(15,23,42,.06);
        border:1px solid rgba(2,6,23,.06);
        position:relative;

        will-change: transform, opacity;
        animation: spirit-pop .22s cubic-bezier(.2,.7,.2,1) forwards;
      }
        .spirit-close {
          position:absolute; top:12px; right:12px; background:var(--sp-dark); color:#fff;
          border:none; border-radius:999px; padding:6px 10px; cursor:pointer; font-size:12px;
        }

        .spirit-badge { font: 600 11px/1 Poppins; letter-spacing:.14em; text-transform:uppercase; color: var(--sp-muted); }
        .spirit-quote {
          margin-top: 10px;
          font-weight: 600;
          line-height: 1.34;
          color: var(--sp-dark);
          font-size: clamp(20px, 2.8vw, 30px);
        }
        .spirit-author { margin-top: 8px; color:#334155; font-style: italic; font-size: 14px; }

        /* Footer credit with NO background */
        .spirit-footer {
        position:fixed; left:50%; transform:translateX(-50%); bottom:10px;
        font: 400 12px/1.2 Poppins; 
        color: #000;                 /* was a gray — now black */
        text-align:center;
        background: transparent; padding: 0; border: 0;
      }
          .spirit-quote{ color:#0f172a !important; }
          .spirit-author{ color:#334155 !important; }
          .spirit-badge{ color:#6b7280 !important; }
          /* bubble alignment variants so it never goes off-screen */
          .spirit-bubble.center{ left:50%; transform: translateX(-50%); }
          .spirit-bubble.left{ left:0; transform: translateX(0); }
          .spirit-bubble.right{ right:0; transform: translateX(0); }
          .spirit-bubble.right:after{ right:10px; left:auto; }
          .spirit-bubble.left:after{ left:10px; right:auto; }

      `;
      document.head.appendChild(style);
    }
  }, []);
  return null;
}

/* ====== Hidden Ghost + Overlay (Step 1 UI only) ====== */
function GhostMark({ onFound }) {
  const SIZE = 16;
  const GAP  = 12;                   // distance from edges
  const [pos, setPos] = useState({}); // {left, top, right, bottom}
  const [align, setAlign] = useState("center");
  const [showBubble, setShowBubble] = useState(false);

  // pick a random edge position once per load
  useEffect(() => {
    const W = window.innerWidth, H = window.innerHeight;

    // choose an edge: 0=left,1=right,2=top,3=bottom
    const edge = Math.floor(Math.random()*4);

    // coordinate ranges, keep away from corners a bit
    const rand = (min,max) => Math.floor(min + Math.random()*(max-min));

    if (edge === 0) {                  // left edge
      const top = rand(64, H - SIZE - 64);
      setPos({ left: GAP, top });
      setAlign("left");
    } else if (edge === 1) {           // right edge
      const top = rand(64, H - SIZE - 64);
      setPos({ right: GAP, top });
      setAlign("right");
    } else if (edge === 2) {           // top edge
      const left = rand(64, W - SIZE - 64);
      setPos({ top: GAP, left });
      setAlign("center");
    } else {                           // bottom edge
      const left = rand(64, W - SIZE - 64);
      setPos({ bottom: GAP, left });
      setAlign("center");
    }
  }, []);

  function handleClick() {
    setShowBubble(true);
    setTimeout(() => { onFound && onFound(); setShowBubble(false); }, 700);
  }

  return (
    <div title="spirit" onClick={handleClick}
         style={{ position:"fixed", zIndex:9999, width:SIZE, height:SIZE, cursor:"pointer", overflow:"visible", ...pos }}>
      {showBubble && <div className={`spirit-bubble ${align}`}>Oh! You found me!</div>}
      <svg className="spirit-ghost spirit-float" viewBox="0 0 64 64" width={SIZE} height={SIZE} role="img" aria-hidden="true">
        <path d="M32 6c-9 0-16 7-16 16v20c0 5 4 6 7 2 3 4 8 4 11 0 3 4 8 4 11 0 3 4 7 3 7-2V22C52 13 41 6 32 6z"
              fill="#fff" stroke="#111" strokeWidth="2"/>
        <circle cx="25" cy="26" r="3" fill="#111"/>
        <circle cx="39" cy="26" r="3" fill="#111"/>
        <path d="M28 34c2 2 6 2 8 0" stroke="#111" strokeWidth="2" fill="none" strokeLinecap="round"/>
      </svg>
    </div>
  );
}


function QuotesOverlay({ onClose }) {
  const [state, setState] = useState({ loading: true, error: "", data: null });

  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const r = await fetch(`${API}/api/quote?fresh=1`);
        if (!r.ok) throw new Error(await r.text());
        const j = await r.json();
        if (!gone) setState({ loading: false, error: "", data: j });
      } catch (e) {
        if (!gone) setState({ loading: false, error: String(e.message || e), data: null });
      }
    })();
    return () => { gone = true; };
  }, []);

  const quote = state.data?.quote || "";
  let author = state.data?.author || "";
  if (!author || author.toLowerCase() === "unknown") author = "Daily Spirit";
  const topic = state.data?.topic || "";

  return (
    <div className="spirit-overlay spirit-fade" role="dialog" aria-modal="true">
      <div className="spirit-card spirit-pop">
        <button className="spirit-close" onClick={onClose} aria-label="Close">Close</button>

        <div className="spirit-badge">Quote Of the Day: {topic ? ` ${topic}` : ""}</div>

        {state.loading ? (
          <div className="spirit-quote">Loading…</div>
        ) : state.error ? (
          <div className="spirit-quote">Couldn’t load a quote.</div>
        ) : (
          <>
            <div className="spirit-quote">{quote}</div>
            <div className="spirit-author">— {author}</div>
          </>
        )}
      </div>

      <div className="spirit-footer">
        Developed by Abhishek Tarafdar with ❤️, for Presales.
      </div>
    </div>
  );
}

/* ---------- Azure ‘A’ twinkle styles (more frequent + hover glow) ---------- */
function AzureShineStyles() {
  useEffect(() => {
    if (document.getElementById("azure-shine-css")) return;
    const s = document.createElement("style");
    s.id = "azure-shine-css";
    s.textContent = `
      .azure-a{
        display:inline-block;
        margin:0 0.5px;
        padding:0;
        border:0;
        background:transparent;
        cursor:pointer;
        color:inherit;
        line-height:1;
        transform-origin:center;

        /* animation runs continuously with random delay/duration */
        animation-name: azureTwinkle;
        animation-duration: var(--az-dur, 4.5s);
        animation-timing-function: ease-in-out;
        animation-iteration-count: infinite;
        animation-fill-mode: both;

        /* smooth hover response */
        transition: text-shadow .22s ease, transform .18s ease;
        filter:none;
      }
      .azure-a:focus{ outline:none; }

      /* continuous subtle twinkle */
      @keyframes azureTwinkle{
        0%,70%   { text-shadow:none; transform:scale(1); }
        72%      { text-shadow:0 0 3px #60a5fa, 0 0 6px #3b82f6; transform:scale(0.99); }
        80%      { text-shadow:0 0 6px #60a5fa, 0 0 12px #2563eb, 0 0 18px #60a5fa; transform:scale(1.005); }
        90%      { text-shadow:0 0 4px #60a5fa, 0 0 10px #2563eb; transform:scale(1.002); }
        100%     { text-shadow:none; transform:scale(1); }
      }

      /* hover/focus: immediate stronger glow */
      .azure-a:hover,
      .azure-a:focus-visible{
        /* stop the keyframe from overriding hover styles */
        animation: none !important;
        text-shadow:
          0 0 4px #93c5fd,
          0 0 10px #60a5fa,
          0 0 16px #2563eb;
        transform: scale(1.50);
      }

      /* pressed state: quick tap feedback */
      .azure-a:active{
        transform: scale(0.97);
        text-shadow:
          0 0 3px #60a5fa,
          0 0 6px #2563eb;
      }
    `;
    document.head.appendChild(s);
  }, []);
  return null;
}


/* ---------- Tiny ‘A’ trigger element (uses randomized delay) ---------- */
function AzureA({ onClick }) {
  // random delay: 0–2s; random duration: 3.6–5.6s -> more frequent twinkles
  const [styleVars] = useState(() => {
    const delay = `${(Math.random() * 2).toFixed(2)}s`;
    const dur   = `${(3.6 + Math.random() * 2).toFixed(2)}s`;
    return { animationDelay: delay, ["--az-dur"]: dur };
  });

  return (
    <button
      type="button"
      aria-label="Open Azure facts"
      className="azure-a"
      style={styleVars}
      onClick={onClick}
    >
      A
    </button>
  );
}

/* ---------- Azure Facts overlay (mirrors QuotesOverlay behavior) ---------- */
function AzureFactsOverlay({ onClose }) {
  const [state, setState] = useState({ loading: true, error: "", data: null });

  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        // same pattern as /api/quote; expects server to expose /api/azure-facts
        const r = await fetch(`${API}/api/azure-facts?fresh=1&_=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) throw new Error(await r.text());
        const j = await r.json();
        if (!gone) setState({ loading: false, error: "", data: j });
      } catch (e) {
        if (!gone) setState({
          loading: false,
          error: String(e.message || e),
          data: null
        });
      }
    })();
    return () => { gone = true; };
  }, []);

  const title  = state.data?.title  || "Azure Fact of the Day";
  const fact   = state.data?.fact   || "Azure regions are paired for built-in disaster recovery and updates.";
  const source = state.data?.source || "";

  return (
    <div className="spirit-overlay spirit-fade" role="dialog" aria-modal="true">
      <div className="spirit-card spirit-pop">
        <button className="spirit-close" onClick={onClose} aria-label="Close">Close</button>
        <div className="spirit-badge">{title}</div>

        {state.loading ? (
          <div className="spirit-quote">Loading…</div>
        ) : state.error ? (
          <div className="spirit-quote">Couldn’t load Azure facts.</div>
        ) : (
          <>
            <div className="spirit-quote">{fact}</div>
            {source ? <div className="spirit-author">Source: {source}</div> : null}
          </>
        )}
      </div>

      <div className="spirit-footer">
        Azure facts • Presales
      </div>
    </div>
  );
}


/* Hook into your main app without touching existing screens */
function SpiritEntryPoint() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SpiritStyles />
      {open && <QuotesOverlay onClose={() => setOpen(false)} />}
      <GhostMark onFound={() => setOpen(true)} />
    </>
  );
}

/* Auto-mount at the end of the document body so it appears on every page */
(function mountSpirit() {
  if (typeof window === "undefined" || !document.body) return;
  const id = "spirit-root";

  const start = () => {
    if (document.getElementById(id)) return;
    const root = document.createElement("div");
    root.id = id;
    document.body.appendChild(root);
    import("react-dom/client").then((mod) => {
      const { createRoot } = mod;
      createRoot(root).render(<SpiritEntryPoint />);
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();