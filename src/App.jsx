import { useState, useEffect, useRef, useCallback } from "react";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get, child } from "firebase/database";

// ============================================================
// FIREBASE SETUP
// Configure your Firebase project in the Vercel dashboard by
// setting the VITE_FIREBASE_* environment variables.
// ============================================================
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL:       import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

let db = null;
let firebaseReady = false;

try {
  if (firebaseConfig.apiKey && firebaseConfig.databaseURL) {
    const app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    firebaseReady = true;
  }
} catch (e) {
  console.error("Firebase init failed:", e);
}

// ---------- storage helpers ----------
async function sGet(path) {
  if (!db) return null;
  try {
    const snapshot = await get(ref(db, path));
    return snapshot.exists() ? snapshot.val() : null;
  } catch { return null; }
}

async function sSet(path, val) {
  if (!db) return false;
  try {
    await set(ref(db, path), val);
    return true;
  } catch { return false; }
}

// List all player objects under games/{code}/players
async function sGetPlayers(code) {
  if (!db) return [];
  try {
    const snapshot = await get(ref(db, FB.players(code)));
    if (!snapshot.exists()) return [];
    return Object.values(snapshot.val());
  } catch { return []; }
}

// Firebase path helpers
const FB = {
  state:   (c)      => `games/${c}/state`,
  player:  (c, pid) => `games/${c}/players/${pid}`,
  players: (c)      => `games/${c}/players`,
  results: (c, r)   => `games/${c}/results/${r}`,
};

// ============================================================
// THE POWER AUCTION — LIVE
// ============================================================
const C = {
  bg: "#0E1830", bg2: "#13203C", card: "#1B2A4A", cardHi: "#24365E",
  line: "#31466F", ice: "#CADCFC", iceDim: "#8FA3C8",
  amber: "#FFB000", teal: "#2EC4B6", red: "#E4572E", green: "#3DDC84", white: "#FFFFFF",
};
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const PLANTS = {
  solar:   { label: "Solar Farm",    cost: 0,   cap: 100, build: 100000, life: 30, color: "#FFB000", emoji: "☀️", renewable: true,
             blurb: "Free to run, but only works when the sun is out." },
  wind:    { label: "Wind Farm",     cost: 0,   cap: 80,  build: 75000,  life: 25, color: "#2EC4B6", emoji: "🌬️", renewable: true,
             blurb: "Free to run, but no wind means no power to sell." },
  nuclear: { label: "Nuclear Plant", cost: 10,  cap: 120, build: 800000, life: 60, color: "#6FA8DC", emoji: "⚛️",
             blurb: "Cheap to run and lasts 60 years — but the most expensive thing on the grid to build." },
  coal:    { label: "Coal Plant",    cost: 40,  cap: 150, build: 560000, life: 45, color: "#A08D77", emoji: "🪨",
             blurb: "Big, steady workhorse. Medium cost, medium build." },
  gas:     { label: "Gas Plant",     cost: 60,  cap: 130, build: 150000, life: 30, color: "#7E96C8", emoji: "🔥",
             blurb: "Flexible. Pricey fuel, but cheap-ish to build. Often sets the price." },
  oil:     { label: "Oil Peaker",    cost: 150, cap: 80,  build: 60000,  life: 25, color: "#E4572E", emoji: "🛢️",
             blurb: "Expensive to run, so you rarely fire up — but the cheapest to build. Your moment is a price spike." },
};
const DECK = ["gas", "solar", "coal", "oil", "nuclear", "wind"];

const SCENARIOS = [
  null,
  {
    title: "A normal Tuesday", icon: "🏙️", demandPct: 0.6, subsidy: 0,
    avail: { solar: 0.5, wind: 0.7 },
    desc: "An ordinary working day. Offices hum, trains run, nothing special.",
    tip: "Cheapest bids run first. The LAST plant needed sets the price EVERYONE gets paid.",
    lesson: "The marginal plant sets the price. Solar bid $0 — and still got paid the clearing price. Bidding low doesn't mean earning low; it means being sure you run.",
  },
  {
    title: "Heatwave — 39°C", icon: "🥵", demandPct: 0.9, subsidy: 0,
    avail: { solar: 1.0, wind: 0.3 },
    desc: "Record heat. Every air-conditioner in the country is on full blast — and the air is still, so wind is weak.",
    tip: "Nearly every plant will be needed. When supply is scarce, who gets to name their price?",
    lesson: "Scarcity = price spikes. When even the most expensive plant is needed, it can bid sky-high — and everyone gets that price. This is Australia at 45°C: $80 → $17,500/MWh.",
  },
  {
    title: "Sunny Sunday", icon: "😎", demandPct: 0.35, subsidy: 20, allowNegative: true,
    avail: { solar: 1.0, wind: 0.8 },
    desc: "Glorious weather — but it's Sunday, so offices and factories are closed. Lots of sun, little demand.",
    tip: "Negative bids are allowed for everyone. Renewables also earn a $20/MWh subsidy — who's willing to pay to keep running?",
    lesson: "Oversupply = prices collapse, even below zero. A subsidised renewable can rationally bid –$20 and still break even; a big thermal plant may pay to avoid a costly shutdown. This is why real markets in Australia and Japan see negative prices on sunny days.",
  },
  {
    title: "Storm front", icon: "🌀", demandPct: 0.8, subsidy: 0,
    avail: { solar: 0.2, wind: 0.0 },
    desc: "A typhoon is passing. Wind farms must shut down for safety and thick cloud cuts solar to a trickle.",
    tip: "Renewables just vanished from the supply stack. Who picks up the slack — and at what price?",
    lesson: "Renewables carry volume risk: a $0 running cost means nothing if the weather doesn't show up. The rest of the fleet then captures scarcity prices. Traders watch forecasts obsessively for exactly this reason.",
  },
];
const ROUNDS = [1, 2, 3, 4];
const PRICE_MIN = -50;
const PRICE_MAX = 500;

const availOf = (plantKey, scen) => scen?.avail?.[plantKey] ?? 1;
const effCap   = (plantKey, scen) => Math.round(PLANTS[plantKey].cap * availOf(plantKey, scen));
const fmt$     = (n) => (n < 0 ? "–$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US");
const rid      = () => Math.random().toString(36).slice(2, 9);

function roiOf(plantKey, cum, rounds) {
  const p = PLANTS[plantKey];
  const avgPerRound = rounds > 0 ? cum / rounds : 0;
  const lifetime = avgPerRound * p.life;
  const roi = ((lifetime - p.build) / p.build) * 100;
  return { avgPerRound, lifetime, roi, build: p.build, life: p.life };
}

function clearMarket(players, round, scen, demandMW, prevCum, prevRounds) {
  const entries = players.map((p) => {
    const cap = effCap(p.plant, scen);
    const raw = p.bids?.[round];
    const bid = typeof raw === "number" && isFinite(raw) ? raw : null;
    return { pid: p.pid, name: p.name, plant: p.plant, cap, bid, dispatched: 0, profit: 0 };
  });
  const offered = entries
    .filter((e) => e.bid !== null && e.cap > 0)
    .sort((a, b) => a.bid - b.bid || a.name.localeCompare(b.name));
  let remaining = demandMW, price = 0, marginalPid = null;
  for (const e of offered) {
    if (remaining <= 0) break;
    e.dispatched = Math.min(e.cap, remaining);
    remaining -= e.dispatched;
    price = e.bid; marginalPid = e.pid;
  }
  entries.forEach((e) => {
    const sub = scen.subsidy && PLANTS[e.plant].renewable ? scen.subsidy : 0;
    e.profit = Math.round((price - PLANTS[e.plant].cost + sub) * e.dispatched);
    e.cum = (prevCum[e.pid] || 0) + e.profit;
    e.rounds = (prevRounds[e.pid] || 0) + 1;
    e.marginal = e.pid === marginalPid;
  });
  return { clearingPrice: price, demandMW, shortfall: Math.max(0, remaining), entries };
}

// ============================================================
// SHARED UI BITS
// ============================================================
const Btn = ({ children, onClick, kind = "primary", disabled, style }) => (
  <button onClick={onClick} disabled={disabled} style={{
    fontFamily: SANS, fontWeight: 700, fontSize: 16, cursor: disabled ? "default" : "pointer",
    padding: "14px 22px", borderRadius: 12, border: "none",
    background: kind === "primary" ? C.amber : kind === "danger" ? C.red : "transparent",
    color: kind === "primary" ? C.bg : kind === "danger" ? C.white : C.ice,
    boxShadow: kind === "ghost" ? `inset 0 0 0 1.5px ${C.line}` : "0 4px 14px rgba(0,0,0,.3)",
    opacity: disabled ? 0.45 : 1, width: "100%", ...style,
  }}>{children}</button>
);
const Tag = ({ children, color = C.amber }) => (
  <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color, textTransform: "uppercase" }}>{children}</span>
);
const Card = ({ children, style }) => (
  <div style={{ background: C.card, borderRadius: 16, padding: 18, border: `1px solid ${C.line}`, ...style }}>{children}</div>
);
function PlantBadge({ plant, size = 44 }) {
  const p = PLANTS[plant];
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: p.color,
      display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.5, flexShrink: 0 }}>{p.emoji}</div>
  );
}

function MeritOrder({ result, height = 240 }) {
  if (!result) return null;
  const offered = result.entries.filter((e) => Number.isFinite(Number(e.bid)) && e.cap > 0)
    .sort((a, b) => Number(a.bid) - Number(b.bid) || a.name.localeCompare(b.name));
  if (!offered.length) return null;
  const totalCap = offered.reduce((s, e) => s + e.cap, 0);
  const W = 760, H = height, padL = 46, padB = 34, padT = 26;
  const plotW = W - padL - 16;
  const maxBid = Math.max(60, ...offered.map((e) => Number(e.bid)));
  const span = maxBid - Math.min(0, ...offered.map((e) => Number(e.bid))) || 1;
  const yOf = (v) => padT + ((maxBid - v) / span) * (H - padT - padB);
  const y0 = yOf(0);
  let cum = 0;
  const bars = offered.map((e) => {
    const x = padL + (cum / totalCap) * plotW;
    const w = (e.cap / totalCap) * plotW; cum += e.cap;
    return { ...e, x, w };
  });
  const demandX = padL + Math.min(1, result.demandMW / totalCap) * plotW;
  const priceY = yOf(result.clearingPrice);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
      <line x1={padL} x2={W - 10} y1={y0} y2={y0} stroke={C.line} strokeWidth="1.5" />
      {bars.map((b) => {
        const top = Math.min(yOf(Number(b.bid)), y0);
        const h = Math.max(3, Math.abs(yOf(Number(b.bid)) - y0));
        const ran = b.dispatched > 0;
        return (
          <g key={b.pid}>
            <rect x={b.x + 1.5} y={top} width={Math.max(2, b.w - 3)} height={h} fill={PLANTS[b.plant].color} opacity={ran ? 1 : 0.28} rx="3" />
            <text x={b.x + b.w / 2} y={H - padB + 14} textAnchor="middle" fill={ran ? C.ice : C.iceDim} fontSize="11" fontFamily={SANS}>
              {b.name.length > 9 ? b.name.slice(0, 8) + "…" : b.name}</text>
            <text x={b.x + b.w / 2} y={H - padB + 27} textAnchor="middle" fill={C.iceDim} fontSize="10" fontFamily={MONO}>${b.bid}</text>
          </g>
        );
      })}
      <line x1={demandX} x2={demandX} y1={padT - 6} y2={y0} stroke={C.amber} strokeWidth="2.5" strokeDasharray="7 5" />
      <text x={demandX} y={padT - 10} textAnchor="middle" fill={C.amber} fontSize="12" fontWeight="700" fontFamily={SANS}>DEMAND {result.demandMW} MW</text>
      <line x1={padL} x2={demandX} y1={priceY} y2={priceY} stroke={C.white} strokeWidth="1.5" strokeDasharray="2 4" opacity="0.8" />
      <text x={padL - 6} y={priceY + 4} textAnchor="end" fill={C.white} fontSize="12" fontWeight="700" fontFamily={MONO}>${result.clearingPrice}</text>
      <text x={padL - 6} y={y0 + 4} textAnchor="end" fill={C.iceDim} fontSize="11" fontFamily={MONO}>$0</text>
    </svg>
  );
}

function ScenarioTray({ state, onPick, busy }) {
  const played = state.played || {};
  return (
    <div>
      <Tag color={C.iceDim}>Choose a round to run — any order, replay anytime</Tag>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginTop: 10 }}>
        {ROUNDS.map((r) => {
          const sc = SCENARIOS[r];
          const done = played[r];
          const current = state.phase === "bidding" && state.round === r;
          return (
            <button key={r} onClick={() => onPick(r)} disabled={busy || current} style={{
              textAlign: "left", cursor: busy || current ? "default" : "pointer",
              background: current ? C.cardHi : C.card, border: `1.5px solid ${done ? C.teal : C.line}`,
              borderRadius: 12, padding: "12px 14px", color: C.white, opacity: busy ? 0.6 : 1,
            }}>
              <div style={{ fontSize: 22 }}>{sc.icon}</div>
              <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 14, marginTop: 2 }}>{sc.title}</div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: done ? C.teal : C.iceDim, marginTop: 4 }}>
                {current ? "● live now" : done ? "✓ played · replay" : "play"}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// HOST
// ============================================================
function HostView({ code, onExit }) {
  const [state, setState]   = useState(null);
  const [players, setPlayers] = useState([]);
  const [result, setResult]   = useState(null);
  const [busy, setBusy]       = useState(false);
  const pollRef = useRef(null);

  const refresh = useCallback(async () => {
    const st = await sGet(FB.state(code));
    if (st) setState(st);
    const ps = await sGetPlayers(code);
    ps.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
    setPlayers(ps);
    if (st && (st.phase === "results" || st.phase === "final")) {
      const r = await sGet(FB.results(code, st.round));
      if (r) setResult(r);
    }
    return { st, ps };
  }, [code]);

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, 4000);
    return () => clearInterval(pollRef.current);
  }, [refresh]);

  const startRound = async (round) => {
    setBusy(true);
    const { st, ps } = await refresh();
    const scen = SCENARIOS[round];
    const nameplate = ps.reduce((s, p) => s + PLANTS[p.plant].cap, 0);
    const demandMW = Math.max(50, Math.round((nameplate * scen.demandPct) / 10) * 10);
    await Promise.all(
      ps.filter((p) => p.bids && p.bids[round] !== undefined).map((p) => {
        const nb = { ...p.bids }; delete nb[round];
        return sSet(FB.player(code, p.pid), { ...p, bids: nb });
      })
    );
    await sSet(FB.state(code), { ...st, phase: "bidding", round, demandMW, ts: Date.now() });
    setResult(null);
    await refresh();
    setBusy(false);
  };

  const closeRound = async () => {
    setBusy(true);
    const { st, ps } = await refresh();
    const scen = SCENARIOS[st.round];
    const standings = st.standings || {};
    const prevCum = {}, prevRounds = {};
    Object.entries(standings).forEach(([pid, v]) => { prevCum[pid] = v.cum; prevRounds[pid] = v.rounds; });
    const res = clearMarket(ps, st.round, scen, st.demandMW, prevCum, prevRounds);
    await sSet(FB.results(code, st.round), res);
    const newStand = { ...standings };
    res.entries.forEach((e) => { newStand[e.pid] = { cum: e.cum, rounds: e.rounds, plant: e.plant, name: e.name }; });
    await sSet(FB.state(code), {
      ...st, phase: "results", standings: newStand,
      played: { ...(st.played || {}), [st.round]: true }, ts: Date.now(),
    });
    setResult(res);
    await refresh();
    setBusy(false);
  };

  const endGame = async () => {
    setBusy(true);
    const st = await sGet(FB.state(code));
    await sSet(FB.state(code), { ...st, phase: "final", ts: Date.now() });
    await refresh();
    setBusy(false);
  };

  const shufflePlants = async () => {
    setBusy(true);
    const { ps } = await refresh();
    const offset = 1 + Math.floor(Math.random() * (DECK.length - 1));
    await Promise.all(ps.map((p, i) => sSet(FB.player(code, p.pid), { ...p, plant: DECK[(i + offset) % DECK.length] })));
    await refresh();
    setBusy(false);
  };

  if (!state) return (
    <Shell>
      <Card>
        <p style={{ color: C.ice, fontFamily: SANS }}>Loading game {code}…</p>
      </Card>
    </Shell>
  );

  const scen = SCENARIOS[state.round] || SCENARIOS[1];
  const bidsIn = players.filter((p) => typeof p.bids?.[state.round] === "number");
  const sidelined = players.filter((p) => effCap(p.plant, scen) === 0);
  const anyPlayed = Object.keys(state.played || {}).length > 0;

  return (
    <Shell wide>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <Tag>Host · projector screen</Tag>
          <h1 style={{ fontFamily: SANS, color: C.white, fontSize: 28, fontWeight: 800, margin: "2px 0 0" }}>⚡ The Power Auction</h1>
        </div>
        <div style={{ textAlign: "right" }}>
          <Tag color={C.iceDim}>Join code</Tag>
          <div style={{ fontFamily: MONO, fontSize: 40, fontWeight: 800, color: C.amber, letterSpacing: 8 }}>{code}</div>
        </div>
      </div>

      {state.phase === "lobby" && (
        <>
          <Card style={{ marginBottom: 14, background: C.bg2 }}>
            <p style={{ fontFamily: SANS, color: C.ice, fontSize: 18, margin: 0, lineHeight: 1.5 }}>
              📱 Teams: open <b style={{ color: C.amber }}>this same link</b>, tap <b>Join as a team</b>,
              enter code <b style={{ fontFamily: MONO, color: C.amber }}>{code}</b> and a team name. Each team gets a power plant.
            </p>
          </Card>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 10, marginBottom: 14 }}>
            {players.map((p) => (
              <Card key={p.pid} style={{ display: "flex", gap: 12, alignItems: "center", padding: 14 }}>
                <PlantBadge plant={p.plant} />
                <div>
                  <div style={{ fontFamily: SANS, color: C.white, fontWeight: 700 }}>{p.name}</div>
                  <div style={{ fontFamily: SANS, color: C.iceDim, fontSize: 12 }}>
                    {PLANTS[p.plant].label} · {PLANTS[p.plant].cap} MW · run ${PLANTS[p.plant].cost} · build {fmt$(PLANTS[p.plant].build)}
                  </div>
                </div>
              </Card>
            ))}
            {!players.length && <Card><p style={{ color: C.iceDim, fontFamily: SANS, margin: 0 }}>Waiting for teams to join…</p></Card>}
          </div>
          {players.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <Btn kind="ghost" onClick={shufflePlants} disabled={busy} style={{ maxWidth: 260 }}>🔀 Shuffle plant assignments</Btn>
            </div>
          )}
          <Card style={{ marginBottom: 14 }}>
            <ScenarioTray state={state} onPick={startRound} busy={busy || players.length < 2} />
            {players.length < 2 && <p style={{ fontFamily: SANS, color: C.iceDim, fontSize: 13, margin: "10px 0 0" }}>Need at least 2 teams to start.</p>}
          </Card>
        </>
      )}

      {state.phase === "bidding" && (
        <>
          <ScenarioBanner round={state.round} scen={scen} demandMW={state.demandMW} />
          <Card style={{ margin: "14px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <Tag>Bids received — values stay secret</Tag>
              <span style={{ fontFamily: MONO, color: C.amber, fontWeight: 800, fontSize: 22 }}>{bidsIn.length}/{players.length - sidelined.length}</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              {players.map((p) => {
                const out = effCap(p.plant, scen) === 0;
                const inn = typeof p.bids?.[state.round] === "number";
                return (
                  <span key={p.pid} style={{
                    fontFamily: SANS, fontSize: 14, fontWeight: 600, padding: "7px 14px", borderRadius: 999,
                    background: out ? "transparent" : inn ? C.amber : C.cardHi, color: out ? C.iceDim : inn ? C.bg : C.ice,
                    border: out ? `1.5px dashed ${C.line}` : "none", textDecoration: out ? "line-through" : "none",
                  }}>{PLANTS[p.plant].emoji} {p.name} {inn && "✓"}</span>
                );
              })}
            </div>
            {!!sidelined.length && (
              <p style={{ fontFamily: SANS, color: C.iceDim, fontSize: 13, margin: "10px 0 0" }}>
                🌀 No power available this round (weather): {sidelined.map((p) => p.name).join(", ")}
              </p>
            )}
          </Card>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Btn kind="danger" onClick={closeRound} disabled={busy || bidsIn.length === 0} style={{ maxWidth: 420 }}>
              🔨 Close the auction & clear the market
            </Btn>
            <Btn kind="ghost" onClick={() => startRound(state.round)} disabled={busy} style={{ maxWidth: 200 }}>↺ Restart round</Btn>
          </div>
        </>
      )}

      {state.phase === "results" && result && (
        <>
          <ScenarioBanner round={state.round} scen={scen} demandMW={result.demandMW} compact />
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)", gap: 14, margin: "14px 0", alignItems: "start" }}>
            <Card>
              <Tag>The merit order — how the market cleared</Tag>
              <MeritOrder result={result} />
              <p style={{ fontFamily: SANS, color: C.iceDim, fontSize: 13, margin: "6px 0 0" }}>
                Bids ranked cheap → expensive. Bars left of the demand line ran; the last one set the price. Faded bars didn't run.
              </p>
            </Card>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Card style={{ textAlign: "center", background: C.bg2 }}>
                <Tag>Clearing price — paid to every plant that ran</Tag>
                <div style={{ fontFamily: MONO, fontSize: 56, fontWeight: 800, color: C.amber, lineHeight: 1.1 }}>{fmt$(result.clearingPrice)}</div>
                <div style={{ fontFamily: SANS, color: C.iceDim, fontSize: 13 }}>per MWh</div>
                {result.shortfall > 0 && <div style={{ fontFamily: SANS, color: C.red, fontSize: 13, marginTop: 6 }}>⚠️ {result.shortfall} MW unserved — partial blackout!</div>}
              </Card>
              <Card>
                <Tag color={C.teal}>💡 What just happened</Tag>
                <p style={{ fontFamily: SANS, color: C.ice, fontSize: 14.5, lineHeight: 1.55, margin: "8px 0 0" }}>{scen.lesson}</p>
              </Card>
            </div>
          </div>
          <Card style={{ marginBottom: 14, padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: SANS, fontSize: 14.5 }}>
              <thead><tr style={{ background: C.bg2 }}>
                {["Team", "Bid", "Ran", "Round profit", "Total"].map((h) => (
                  <th key={h} style={{ color: C.iceDim, textAlign: h === "Team" ? "left" : "right", padding: "10px 14px", fontWeight: 600 }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {[...result.entries].sort((a, b) => b.cum - a.cum).map((e) => (
                  <tr key={e.pid} style={{ borderTop: `1px solid ${C.line}` }}>
                    <td style={{ color: C.white, padding: "9px 14px", fontWeight: 600 }}>
                      {PLANTS[e.plant].emoji} {e.name}{e.marginal && <span style={{ color: C.amber }}> · price-setter</span>}</td>
                    <td style={{ color: C.ice, textAlign: "right", padding: "9px 14px", fontFamily: MONO }}>{e.bid === null ? "—" : fmt$(e.bid)}</td>
                    <td style={{ color: C.ice, textAlign: "right", padding: "9px 14px", fontFamily: MONO }}>{e.dispatched ? `${e.dispatched} MW` : "no"}</td>
                    <td style={{ color: e.profit > 0 ? C.green : e.profit < 0 ? C.red : C.iceDim, textAlign: "right", padding: "9px 14px", fontFamily: MONO, fontWeight: 700 }}>{fmt$(e.profit)}</td>
                    <td style={{ color: C.amber, textAlign: "right", padding: "9px 14px", fontFamily: MONO, fontWeight: 800 }}>{fmt$(e.cum)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card style={{ marginBottom: 14 }}>
            <ScenarioTray state={state} onPick={startRound} busy={busy} />
          </Card>
          <Btn kind="ghost" onClick={endGame} disabled={busy || !anyPlayed} style={{ maxWidth: 320 }}>🏁 End game & show final scoreboards</Btn>
        </>
      )}

      {state.phase === "final" && <FinalBoard standings={state.standings || {}} isHost />}

      <p style={{ fontFamily: SANS, color: C.iceDim, fontSize: 12, marginTop: 22 }}>
        Game code {code} · refreshes every few seconds · <span onClick={onExit} style={{ textDecoration: "underline", cursor: "pointer" }}>leave host view</span>
      </p>
    </Shell>
  );
}

function ScenarioBanner({ round, scen, demandMW, compact }) {
  return (
    <Card style={{ background: C.bg2, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ fontSize: compact ? 34 : 48 }}>{scen.icon}</div>
      <div style={{ flex: 1, minWidth: 220 }}>
        <Tag>Round {round}</Tag>
        <div style={{ fontFamily: SANS, color: C.white, fontSize: compact ? 20 : 26, fontWeight: 800 }}>{scen.title}</div>
        {!compact && <div style={{ fontFamily: SANS, color: C.ice, fontSize: 15, marginTop: 2 }}>{scen.desc}</div>}
        {!compact && <div style={{ fontFamily: SANS, color: C.amber, fontSize: 14, marginTop: 6 }}>🎯 {scen.tip}</div>}
      </div>
      <div style={{ textAlign: "center" }}>
        <Tag color={C.iceDim}>Demand to cover</Tag>
        <div style={{ fontFamily: MONO, fontSize: compact ? 28 : 38, fontWeight: 800, color: C.amber }}>{demandMW} MW</div>
      </div>
    </Card>
  );
}

function FinalBoard({ standings, isHost, myPid }) {
  const [tab, setTab] = useState("profit");
  const rows = Object.entries(standings).map(([pid, v]) => {
    const r = roiOf(v.plant, v.cum, v.rounds);
    return { pid, name: v.name, plant: v.plant, cum: v.cum, rounds: v.rounds, ...r };
  });
  if (!rows.length) return <Card><p style={{ color: C.ice, fontFamily: SANS, margin: 0 }}>No rounds were played.</p></Card>;
  const ranked = [...rows].sort((a, b) => tab === "profit" ? b.cum - a.cum : b.roi - a.roi);
  const medals = ["🥇", "🥈", "🥉"];
  const TabBtn = ({ id, label }) => (
    <button onClick={() => setTab(id)} style={{
      flex: 1, fontFamily: SANS, fontWeight: 700, fontSize: 14, padding: "11px 8px", cursor: "pointer",
      border: "none", borderRadius: 10, background: tab === id ? C.amber : C.card, color: tab === id ? C.bg : C.ice,
    }}>{label}</button>
  );
  return (
    <div>
      <Card style={{ background: C.bg2, textAlign: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 44 }}>🏆</div>
        <h2 style={{ fontFamily: SANS, color: C.white, fontSize: 26, fontWeight: 800, margin: "4px 0" }}>Two ways to win</h2>
        <p style={{ fontFamily: SANS, color: C.iceDim, fontSize: 14, margin: 0 }}>The same game has two different champions — that's the real lesson.</p>
      </Card>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <TabBtn id="profit" label="💰 Trading profit" />
        <TabBtn id="roi" label="📈 Return on investment" />
      </div>
      <Card style={{ marginBottom: 14, background: C.card }}>
        <p style={{ fontFamily: SANS, color: C.ice, fontSize: 13.5, lineHeight: 1.55, margin: 0 }}>
          {tab === "profit"
            ? "Total cash earned trading across the rounds. Big plants that ran often tend to top this board."
            : "Profit stretched over the plant's lifetime, minus what it cost to build, as a % return. Cheap-to-build plants that rarely ran can win here — a plant isn't 'bad', it just earns differently."}
        </p>
      </Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {ranked.map((e, i) => (
          <Card key={e.pid} style={{
            display: "flex", alignItems: "center", gap: 14, padding: "12px 16px",
            background: e.pid === myPid ? C.cardHi : C.card,
            border: i === 0 ? `1.5px solid ${C.amber}` : `1px solid ${C.line}`,
          }}>
            <span style={{ fontFamily: MONO, fontSize: 20, width: 36, color: C.iceDim }}>{medals[i] || `#${i + 1}`}</span>
            <PlantBadge plant={e.plant} size={36} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: SANS, color: C.white, fontWeight: 700 }}>{e.name}{e.pid === myPid && " (you)"}</div>
              <div style={{ fontFamily: SANS, color: C.iceDim, fontSize: 11.5 }}>
                {tab === "profit"
                  ? `${PLANTS[e.plant].label}`
                  : `built for ${fmt$(e.build)} · ${fmt$(Math.round(e.avgPerRound))}/yr × ${e.life} yrs`}
              </div>
            </div>
            <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 18, textAlign: "right",
              color: tab === "profit" ? (e.cum >= 0 ? C.green : C.red) : (e.roi >= 0 ? C.green : C.red) }}>
              {tab === "profit" ? fmt$(e.cum) : `${e.roi >= 0 ? "+" : ""}${Math.round(e.roi)}%`}
            </span>
          </Card>
        ))}
      </div>
      {isHost && (
        <Card style={{ marginTop: 14 }}>
          <Tag color={C.teal}>💡 The lessons you just lived</Tag>
          <p style={{ fontFamily: SANS, color: C.ice, fontSize: 14.5, lineHeight: 1.65, margin: "8px 0 0" }}>
            1 · The last plant needed sets the price for everyone — the merit order.<br />
            2 · Scarcity makes prices explode; oversupply pushes them to zero and below.<br />
            3 · Renewables are cheap to run but weather-dependent — volume risk is real.<br />
            4 · Cheap-to-run isn't the same as cheap-to-build. Nuclear costs little to run but a fortune to build; a peaker is the opposite. That's why "best plant" depends entirely on which scoreboard you read — the same debate that drives real energy policy.
          </p>
        </Card>
      )}
    </div>
  );
}

// ============================================================
// PLAYER
// ============================================================
function PlayerView({ code, me, onExit }) {
  const [state, setState]   = useState(null);
  const [myData, setMyData] = useState(me);
  const [result, setResult] = useState(null);
  const [bid, setBid]       = useState("");
  const [sent, setSent]     = useState(null);
  const [saving, setSaving] = useState(false);
  const lastRef = useRef({ round: null, phase: null });

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const st = await sGet(FB.state(code));
      if (!alive || !st) return;
      if (lastRef.current.round !== st.round || lastRef.current.phase !== st.phase) {
        setResult(null); setBid(""); setSent(null);
        lastRef.current = { round: st.round, phase: st.phase };
        const fresh = await sGet(FB.player(code, myData.pid));
        if (alive && fresh) setMyData(fresh);
      }
      setState(st);
      if (st.phase === "results" || st.phase === "final") {
        const r = await sGet(FB.results(code, st.round));
        if (alive && r) setResult(r);
      }
    };
    tick();
    const iv = setInterval(tick, 2500);
    return () => { alive = false; clearInterval(iv); };
  }, [code, myData.pid]);

  const scen    = state ? SCENARIOS[state.round] || SCENARIOS[1] : null;
  const plant   = PLANTS[myData.plant];
  const myCap   = scen ? effCap(myData.plant, scen) : plant.cap;
  const subsidy = scen?.subsidy && plant.renewable ? scen.subsidy : 0;
  const canGoNeg = !!scen?.allowNegative;

  const submitBid = async () => {
    const v = Math.max(PRICE_MIN, Math.min(PRICE_MAX, Math.round(Number(bid))));
    if (!isFinite(v)) return;
    setSaving(true);
    const updated = { ...myData, bids: { ...(myData.bids || {}), [state.round]: v } };
    await sSet(FB.player(code, myData.pid), updated);
    setMyData(updated); setSent(state.round); setSaving(false);
  };

  const myResult = result?.entries?.find((e) => e.pid === myData.pid);

  return (
    <Shell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <Tag>Team · {code}</Tag>
          <div style={{ fontFamily: SANS, color: C.white, fontSize: 22, fontWeight: 800 }}>{myData.name}</div>
        </div>
        <PlantBadge plant={myData.plant} size={52} />
      </div>

      <Card style={{ marginBottom: 14, background: C.bg2 }}>
        <div style={{ fontFamily: SANS, color: C.white, fontWeight: 800, fontSize: 17 }}>{plant.emoji} {plant.label}</div>
        <div style={{ fontFamily: SANS, color: C.iceDim, fontSize: 13, margin: "2px 0 12px" }}>{plant.blurb}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
          {[
            { l: "Run cost", v: `$${plant.cost}`, s: "/MWh" },
            { l: "Capacity", v: myCap, s: " MW" },
            { l: "Build cost", v: fmt$(plant.build), s: "" },
            { l: "Lifespan", v: plant.life, s: " yrs" },
          ].map((m) => (
            <div key={m.l}>
              <Tag color={C.iceDim}>{m.l}</Tag>
              <div style={{ fontFamily: MONO, color: C.white, fontWeight: 800, fontSize: 17 }}>{m.v}<span style={{ fontSize: 10, color: C.iceDim }}>{m.s}</span></div>
            </div>
          ))}
        </div>
        {scen && myCap !== plant.cap && (
          <p style={{ fontFamily: SANS, color: C.amber, fontSize: 12.5, margin: "10px 0 0" }}>
            🌤️ Weather today: only {Math.round(availOf(myData.plant, scen) * 100)}% of your capacity is available ({myCap} MW).
          </p>
        )}
      </Card>

      {(!state || state.phase === "lobby") && (
        <Card>
          <p style={{ fontFamily: SANS, color: C.ice, fontSize: 16, lineHeight: 1.6, margin: 0 }}>
            ⏳ Waiting for the host to start a round…<br /><br />
            <b style={{ color: C.amber }}>How you make money:</b> each round you bid a price in $/MWh. If your bid is among the cheapest,
            your plant runs and you're paid the <b>clearing price</b> — the bid of the last plant needed.<br /><br />
            Profit = (clearing price − your run cost) × MW produced. At the very end we also work out your{" "}
            <b style={{ color: C.teal }}>return on investment</b> — profit vs. what your plant cost to build — so even a plant that rarely runs can win.
          </p>
        </Card>
      )}

      {state?.phase === "bidding" && scen && (
        <>
          <Card style={{ marginBottom: 14 }}>
            <Tag>Round {state.round} · {scen.icon} {scen.title}</Tag>
            <p style={{ fontFamily: SANS, color: C.ice, fontSize: 14.5, margin: "6px 0 0", lineHeight: 1.5 }}>
              {scen.desc} Market demand: <b style={{ color: C.amber }}>{state.demandMW} MW</b>.
            </p>
            {subsidy > 0 && <p style={{ fontFamily: SANS, color: C.teal, fontSize: 13.5, margin: "8px 0 0" }}>🌱 You earn a +${subsidy}/MWh subsidy this round — even a bid of –${subsidy} still breaks even.</p>}
            {canGoNeg && subsidy === 0 && <p style={{ fontFamily: SANS, color: C.teal, fontSize: 13.5, margin: "8px 0 0" }}>💡 Negative bids allowed. Big plants hate shutting down — sometimes it's cheaper to pay to keep running than to switch off.</p>}
            {myCap === 0 && <p style={{ fontFamily: SANS, color: C.red, fontSize: 14, margin: "8px 0 0" }}>🌀 No power available this round (the weather killed your output). Sit tight and watch what scarcity does to the price.</p>}
          </Card>
          {myCap > 0 && (
            <Card>
              <Tag>Your bid — secret until the auction closes</Tag>
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "12px 0" }}>
                <span style={{ fontFamily: MONO, color: C.iceDim, fontSize: 18 }}>$</span>
                <input type="number" inputMode="numeric" value={bid} min={PRICE_MIN} max={PRICE_MAX}
                  onChange={(e) => setBid(e.target.value)} placeholder={`${plant.cost}`}
                  style={{ flex: 1, fontFamily: MONO, fontSize: 34, fontWeight: 800, color: C.amber, background: C.bg,
                    border: `1.5px solid ${C.line}`, borderRadius: 12, padding: "10px 14px", outline: "none", width: "100%" }} />
                <span style={{ fontFamily: SANS, color: C.iceDim, fontSize: 13 }}>/MWh</span>
              </div>
              <input type="range" min={canGoNeg ? PRICE_MIN : 0} max={Math.min(PRICE_MAX, 300)} step="5"
                value={isFinite(Number(bid)) && bid !== "" ? Number(bid) : plant.cost}
                onChange={(e) => setBid(e.target.value)} style={{ width: "100%", accentColor: C.amber, marginBottom: 12 }} />
              <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                {[
                  { l: "My cost", v: plant.cost },
                  { l: "Cost +20", v: plant.cost + 20 },
                  { l: "Cost +50", v: plant.cost + 50 },
                  ...(canGoNeg ? [{ l: "Go negative", v: subsidy > 0 ? -subsidy : -20 }] : []),
                ].map((q) => (
                  <button key={q.l} onClick={() => setBid(String(q.v))} style={{
                    fontFamily: SANS, fontSize: 13, fontWeight: 600, padding: "8px 12px", borderRadius: 999,
                    border: `1.5px solid ${C.line}`, background: "transparent", color: C.ice, cursor: "pointer" }}>{q.l} (${q.v})</button>
                ))}
              </div>
              <Btn onClick={submitBid} disabled={saving || bid === "" || !isFinite(Number(bid))}>
                {sent === state.round ? "Update my bid 🔁" : "Lock in my bid 🔒"}
              </Btn>
              {sent === state.round && (
                <p style={{ fontFamily: SANS, color: C.green, fontSize: 14, textAlign: "center", margin: "10px 0 0" }}>
                  ✓ Bid received: ${myData.bids?.[state.round]}/MWh — change it any time until the host closes the auction.
                </p>
              )}
              <p style={{ fontFamily: SANS, color: C.iceDim, fontSize: 12.5, margin: "12px 0 0", lineHeight: 1.5 }}>
                If you run, you're paid the clearing price, not your bid. Profit = (clearing − ${plant.cost}{subsidy ? ` + $${subsidy} subsidy` : ""}) × MW.
              </p>
            </Card>
          )}
        </>
      )}

      {state?.phase === "results" && (
        <>
          {!myResult && <Card><p style={{ color: C.iceDim, fontFamily: SANS, margin: 0 }}>Computing results…</p></Card>}
          {myResult && (
            <Card style={{ textAlign: "center", marginBottom: 14 }}>
              <Tag>Round {state.round} result</Tag>
              <div style={{ fontSize: 42, margin: "6px 0" }}>{myResult.dispatched > 0 ? (myResult.profit >= 0 ? "🤑" : "😬") : "😴"}</div>
              <div style={{ fontFamily: SANS, color: C.white, fontWeight: 800, fontSize: 19 }}>
                {myResult.dispatched > 0 ? `You ran! ${myResult.dispatched} MW dispatched`
                  : myResult.bid === null ? "No bid — your plant sat out"
                  : "Not selected — your bid was above the clearing price"}
              </div>
              <div style={{ fontFamily: SANS, color: C.iceDim, fontSize: 14, margin: "6px 0 12px" }}>
                Clearing price: <b style={{ color: C.amber, fontFamily: MONO }}>{fmt$(result.clearingPrice)}/MWh</b>{myResult.marginal && " — and YOUR bid set it!"}
              </div>
              <div style={{ display: "flex", justifyContent: "center", gap: 26 }}>
                <div>
                  <Tag color={C.iceDim}>This round</Tag>
                  <div style={{ fontFamily: MONO, fontWeight: 800, fontSize: 28, color: myResult.profit > 0 ? C.green : myResult.profit < 0 ? C.red : C.iceDim }}>{fmt$(myResult.profit)}</div>
                </div>
                <div>
                  <Tag color={C.iceDim}>Total</Tag>
                  <div style={{ fontFamily: MONO, fontWeight: 800, fontSize: 28, color: C.amber }}>{fmt$(myResult.cum)}</div>
                </div>
              </div>
            </Card>
          )}
          {result && (
            <Card>
              <Tag>Leaderboard</Tag>
              {[...result.entries].sort((a, b) => b.cum - a.cum).map((e, i) => (
                <div key={e.pid} style={{ display: "flex", justifyContent: "space-between", padding: "8px 4px",
                  borderTop: i ? `1px solid ${C.line}` : "none", fontFamily: SANS, fontSize: 14.5,
                  color: e.pid === myData.pid ? C.amber : C.ice, fontWeight: e.pid === myData.pid ? 800 : 500 }}>
                  <span>#{i + 1} {PLANTS[e.plant].emoji} {e.name}</span>
                  <span style={{ fontFamily: MONO }}>{fmt$(e.cum)}</span>
                </div>
              ))}
              <p style={{ fontFamily: SANS, color: C.iceDim, fontSize: 13, margin: "10px 0 0" }}>⏳ Waiting for the host to start the next round…</p>
            </Card>
          )}
        </>
      )}

      {state?.phase === "final" && <FinalBoard standings={state.standings || {}} myPid={myData.pid} />}

      <p style={{ fontFamily: SANS, color: C.iceDim, fontSize: 12, marginTop: 20 }}>
        Keep this page open — it refreshes itself. <span onClick={onExit} style={{ textDecoration: "underline", cursor: "pointer" }}>leave</span>
      </p>
    </Shell>
  );
}

// ============================================================
// HOME / JOIN / CREATE
// ============================================================
function Shell({ children, wide }) {
  return (
    <div style={{ minHeight: "100vh", background: `radial-gradient(1200px 600px at 80% -10%, #1A2C55 0%, ${C.bg} 55%)`, padding: "22px 16px" }}>
      <div style={{ maxWidth: wide ? 1080 : 560, margin: "0 auto" }}>{children}</div>
    </div>
  );
}

export default function PowerAuctionLive() {
  const [mode, setMode] = useState("home");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [err, setErr]   = useState("");
  const [busy, setBusy] = useState(false);
  const [me, setMe]     = useState(null);

  const createGame = async () => {
    setBusy(true); setErr("");
    let c = "";
    for (let t = 0; t < 5; t++) {
      c = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)]).join("");
      if (!(await sGet(FB.state(c)))) break;
    }
    const ok = await sSet(FB.state(c), { phase: "lobby", round: 0, standings: {}, played: {}, ts: Date.now() });
    if (!ok) { setErr("Couldn't reach Firebase. Check that the environment variables are set in Vercel."); setBusy(false); return; }
    setCode(c); setMode("host"); setBusy(false);
  };

  const resumeGame = async () => {
    setBusy(true); setErr("");
    const c = code.trim().toUpperCase();
    const st = await sGet(FB.state(c));
    if (!st) { setErr(`No game found with code ${c}.`); setBusy(false); return; }
    setCode(c); setMode("host"); setBusy(false);
  };

  const joinGame = async () => {
    setBusy(true); setErr("");
    const c = code.trim().toUpperCase();
    const nm = name.trim().slice(0, 18);
    if (!nm) { setErr("Pick a team name first."); setBusy(false); return; }
    const st = await sGet(FB.state(c));
    if (!st) { setErr(`No game found with code ${c}. Check the code on the big screen.`); setBusy(false); return; }
    const ps = await sGetPlayers(c);
    const existing = ps.find((p) => p.name.toLowerCase() === nm.toLowerCase());
    let myPlayer;
    if (existing) {
      myPlayer = existing;
    } else {
      myPlayer = { pid: rid(), name: nm, plant: DECK[ps.length % DECK.length], bids: {}, joinedAt: Date.now() };
      const ok = await sSet(FB.player(c, myPlayer.pid), myPlayer);
      if (!ok) { setErr("Couldn't join — storage unavailable."); setBusy(false); return; }
    }
    setCode(c); setMe(myPlayer); setMode("player"); setBusy(false);
  };

  if (!firebaseReady) {
    return (
      <Shell>
        <div style={{ textAlign: "center", margin: "40px 0" }}>
          <div style={{ fontSize: 54 }}>⚡</div>
          <h1 style={{ fontFamily: SANS, color: C.white, fontSize: 34, fontWeight: 800, margin: "12px 0 8px" }}>The Power Auction</h1>
          <Card style={{ border: `1.5px solid ${C.red}`, textAlign: "left", marginTop: 20 }}>
            <Tag color={C.red}>Setup required</Tag>
            <p style={{ fontFamily: SANS, color: C.ice, fontSize: 15, lineHeight: 1.6, margin: "10px 0 0" }}>
              Firebase isn't configured yet. Set the <code style={{ fontFamily: MONO, color: C.amber }}>VITE_FIREBASE_*</code> environment
              variables in your Vercel project settings, then redeploy. See the setup guide in your README.
            </p>
          </Card>
        </div>
      </Shell>
    );
  }

  if (mode === "host") return <HostView code={code} onExit={() => setMode("home")} />;
  if (mode === "player" && me) return <PlayerView code={code} me={me} onExit={() => setMode("home")} />;

  const field = (val, set, placeholder, props = {}) => {
    const { upper, spread, ...rest } = props;
    return (
      <input value={val} onChange={(e) => set(e.target.value)} placeholder={placeholder}
        style={{ width: "100%", boxSizing: "border-box", fontFamily: MONO, fontSize: 24, fontWeight: 700,
          color: C.white, background: C.bg, border: `1.5px solid ${C.line}`, borderRadius: 12, padding: "13px 16px",
          outline: "none", letterSpacing: spread ? 6 : 0, textTransform: upper ? "uppercase" : "none", marginBottom: 12 }} {...rest} />
    );
  };

  return (
    <Shell>
      <div style={{ textAlign: "center", margin: "26px 0" }}>
        <div style={{ fontSize: 54 }}>⚡</div>
        <h1 style={{ fontFamily: SANS, color: C.white, fontSize: 34, fontWeight: 800, margin: "6px 0 4px" }}>The Power Auction</h1>
        <p style={{ fontFamily: SANS, color: C.iceDim, fontSize: 15, margin: 0 }}>Run a real electricity market — from your phones.</p>
      </div>
      {mode === "home" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Btn onClick={() => setMode("join")}>📱 Join as a team</Btn>
          <Btn kind="ghost" onClick={() => { setMode("create"); setErr(""); }}>🎤 I'm the presenter — host a game</Btn>
          <Card style={{ marginTop: 8 }}>
            <Tag color={C.teal}>How it works</Tag>
            <p style={{ fontFamily: SANS, color: C.ice, fontSize: 14, lineHeight: 1.6, margin: "8px 0 0" }}>
              Every team owns a power plant with its own running cost, build cost and lifespan. Each round is a market day:
              bid your price, the cheapest plants are picked until demand is covered, and the last plant needed sets the price
              everyone gets paid. The host runs four weather scenarios in any order. At the end, two scoreboards — total profit
              and return on investment — so different plants can win different ways.
            </p>
          </Card>
        </div>
      )}
      {mode === "create" && (
        <Card>
          <Tag>Host a game</Tag>
          <p style={{ fontFamily: SANS, color: C.ice, fontSize: 14, lineHeight: 1.55, margin: "8px 0 14px" }}>
            You'll get a 4-letter code for the projector. Teams join with the same link on their phones.
          </p>
          <Btn onClick={createGame} disabled={busy}>Create a new game</Btn>
          <p style={{ fontFamily: SANS, color: C.iceDim, fontSize: 13, margin: "16px 0 8px" }}>Or resume an existing game:</p>
          {field(code, setCode, "CODE", { upper: true, spread: true, maxLength: 4 })}
          <Btn kind="ghost" onClick={resumeGame} disabled={busy || code.trim().length !== 4}>Resume as host</Btn>
          {err && <p style={{ color: C.red, fontFamily: SANS, fontSize: 13.5, marginTop: 10 }}>{err}</p>}
        </Card>
      )}
      {mode === "join" && (
        <Card>
          <Tag>Join as a team</Tag>
          <p style={{ fontFamily: SANS, color: C.ice, fontSize: 14, margin: "8px 0 14px" }}>
            Enter the 4-letter code from the big screen and a team name (3–4 students per team works well).
          </p>
          {field(code, setCode, "CODE", { upper: true, spread: true, maxLength: 4 })}
          {field(name, setName, "Team name", { maxLength: 18 })}
          <Btn onClick={joinGame} disabled={busy || code.trim().length !== 4 || !name.trim()}>Join the market ⚡</Btn>
          {err && <p style={{ color: C.red, fontFamily: SANS, fontSize: 13.5, marginTop: 10 }}>{err}</p>}
        </Card>
      )}
    </Shell>
  );
}
