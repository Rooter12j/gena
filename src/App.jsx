import { useState, useEffect, useRef, useCallback } from "react";

const APP_ID = 1089;
const WS_URL = `wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`;

// ─── Deriv OAuth (PKCE) ───────────────────────────────────────────────────────
// Deriv retired the old implicit-grant flow on oauth.deriv.com (which just
// appended ?token1=... to the redirect URL). Logging in now goes through
// auth.deriv.com using OAuth 2.0 + PKCE, and it requires an app that YOU
// register on https://developers.deriv.com/dashboard with this site's exact
// URL as the redirect URI. The shared app_id 1089 has no redirect URI
// registered for this domain, which is why clicking "Connect with Deriv"
// did nothing useful — there's nowhere valid for Deriv to send you back to.
//
// Fill these in with your own values from the Deriv dashboard:
const DERIV_CLIENT_ID = "33DowNN6WPxOPy3h2AXHo"; // e.g. "app12345"
const DERIV_REDIRECT_URI = window.location.origin + window.location.pathname;
const DERIV_AUTH_BASE = "https://auth.deriv.com/oauth2";
const OAUTH_SCOPES = "trade account_manage";
function extractDerivTokenFromURL() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token1");
  if (token) {
    localStorage.setItem("deriv_token", token);
    // Clean the URL so token doesn't sit in address bar
    window.history.replaceState({}, document.title, window.location.pathname);
    return token;
  }
  return null;
}
const MULT = 2.1;

// ─── Symbol rotation queue ────────────────────────────────────────────────────
// Bot cycles through these in order. Each gets its own TP before moving on.
const SYMBOL_QUEUE = [
  { label: "Volatility 10 Index",   symbol: "R_10",      contractType: "DIGITDIFF"  },
  { label: "Volatility 10 (1s)",    symbol: "1HZ10V",    contractType: "DIGITDIFF"  },
  { label: "Volatility 25 Index",   symbol: "R_25",      contractType: "DIGITDIFF"  },
  { label: "Volatility 25 (1s)",    symbol: "1HZ25V",    contractType: "DIGITMATCH" },
  { label: "Volatility 50 Index",   symbol: "R_50",      contractType: "DIGITDIFF"  },
  { label: "Volatility 50 (1s)",    symbol: "1HZ50V",    contractType: "DIGITMATCH" },
  { label: "Volatility 75 Index",   symbol: "R_75",      contractType: "DIGITDIFF"  },
  { label: "Volatility 75 (1s)",    symbol: "1HZ75V",    contractType: "DIGITDIFF"  },
  { label: "Volatility 100 Index",  symbol: "R_100",     contractType: "DIGITMATCH" },
  { label: "Volatility 100 (1s)",   symbol: "1HZ100V",   contractType: "DIGITDIFF"  },
];

const STRATEGIES = [
  { label: "Matches / Differs", value: "AUTO" },
  { label: "Differs Only",      value: "DIGITDIFF" },
  { label: "Matches Only",      value: "DIGITMATCH" },
];

// ─── WebSocket hook ───────────────────────────────────────────────────────────
function useDerivWS(token) {
  const ws = useRef(null);
  const [connected, setConnected] = useState(false);
  const [account,  setAccount]  = useState(null);
  const [balance,  setBalance]  = useState(null);
  const listeners = useRef({});

  const on   = useCallback((k, fn) => { listeners.current[k] = fn; }, []);
  const off  = useCallback((k)      => { delete listeners.current[k]; }, []);
  const send = useCallback((obj)    => {
    if (ws.current?.readyState === 1) ws.current.send(JSON.stringify(obj));
  }, []);

  useEffect(() => {
    if (!token) return;
    const socket = new WebSocket(WS_URL);
    ws.current = socket;
    socket.onopen    = () => { setConnected(true); socket.send(JSON.stringify({ authorize: token })); };
    socket.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.msg_type === "authorize") { setAccount(d.authorize); socket.send(JSON.stringify({ balance: 1, subscribe: 1 })); }
      if (d.msg_type === "balance")   setBalance(d.balance);
      Object.values(listeners.current).forEach(fn => fn(d));
    };
    socket.onclose = () => setConnected(false);
    socket.onerror = () => setConnected(false);
    return () => socket.close();
  }, [token]);

  return { connected, account, balance, send, on, off };
}

// ─── Live sparkline chart ─────────────────────────────────────────────────────
function LiveChart({ ticks, symbol, price }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || ticks.length < 2) return;
    const dpr = window.devicePixelRatio || 1;
    const cW = canvas.offsetWidth, cH = canvas.offsetHeight;
    canvas.width = cW * dpr; canvas.height = cH * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const pts = [...ticks].reverse().slice(0, 80);
    const min = Math.min(...pts) - 0.05, max = Math.max(...pts) + 0.05;
    const rng = max - min || 1;
    const px = i => (i / (pts.length - 1)) * cW;
    const py = v => cH - 4 - ((v - min) / rng) * (cH - 8);
    ctx.clearRect(0, 0, cW, cH);
    [0, 0.5, 1].forEach(f => {
      const y = cH - 4 - f * (cH - 8);
      ctx.strokeStyle = "#f0f0f5"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cW, y); ctx.stroke();
      ctx.fillStyle = "#bbb"; ctx.font = "9px Inter,sans-serif"; ctx.textAlign = "left";
      ctx.fillText((min + rng * f).toFixed(2), 2, y - 2);
    });
    ctx.beginPath();
    pts.forEach((v, i) => i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v)));
    ctx.strokeStyle = "#6c63ff"; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
  }, [ticks]);

  const label = SYMBOL_QUEUE.find(s => s.symbol === symbol)?.label ?? symbol;
  return (
    <div style={{ background:"#fff", borderRadius:16, padding:"18px 20px", border:"1px solid #ebebf0", boxShadow:"0 1px 4px rgba(0,0,0,.05)" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
        <div style={{ fontWeight:700, fontSize:15, color:"#1a1a2e" }}>{label}</div>
        <div style={{ fontWeight:700, fontSize:22, color:"#ef4444", fontVariantNumeric:"tabular-nums" }}>{price?.toFixed(2) ?? "—"}</div>
      </div>
      <canvas ref={canvasRef} style={{ width:"100%", height:100, display:"block" }} />
    </div>
  );
}

// ─── Digit frequency circles ──────────────────────────────────────────────────
function DigitStats({ ticks, selected, onSelect }) {
  const counts = Array(10).fill(0);
  ticks.forEach(d => { if (d >= 0 && d <= 9) counts[d]++; });
  const total = ticks.length || 1;
  const pcts  = counts.map(c => (c / total) * 100);
  const maxD  = pcts.indexOf(Math.max(...pcts));
  const minD  = pcts.indexOf(Math.min(...pcts));
  return (
    <div style={{ background:"#fff", borderRadius:16, padding:"18px 20px", border:"1px solid #ebebf0", boxShadow:"0 1px 4px rgba(0,0,0,.05)" }}>
      <div style={{ fontSize:11, fontWeight:700, color:"#6b7280", letterSpacing:".08em", textTransform:"uppercase", marginBottom:14 }}>Last Digit Stats (0 – 9)</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:10 }}>
        {[0,1,2,3,4,5,6,7,8,9].map(d => {
          const isMax = d===maxD, isMin = d===minD, isSel = d===selected;
          return (
            <div key={d} onClick={() => onSelect(d === selected ? null : d)} style={{
              display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
              width:60, height:60, borderRadius:"50%", margin:"0 auto",
              border:`2px solid ${isMax?"#22c55e":isMin?"#ef4444":isSel?"#6c63ff":"#e8eaf0"}`,
              cursor:"pointer", background:"#fff",
              boxShadow: isSel ? "0 0 0 3px rgba(108,99,255,.15)" : "none",
              transition:"all .15s",
            }}>
              <div style={{ fontSize:18, fontWeight:700, color:"#1a1a2e", lineHeight:1 }}>{d}</div>
              <div style={{ fontSize:11, fontWeight:600, marginTop:3, color:isMax?"#16a34a":isMin?"#dc2626":"#9ca3af" }}>{pcts[d].toFixed(1)}%</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Symbol rotation progress bar ────────────────────────────────────────────
function RotationTracker({ queue, currentIdx, symbolResults, running }) {
  return (
    <div style={{ background:"#fff", borderRadius:16, padding:"18px 20px", border:"1px solid #ebebf0", boxShadow:"0 1px 4px rgba(0,0,0,.05)" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
        <div style={{ fontSize:11, fontWeight:700, color:"#6b7280", letterSpacing:".08em", textTransform:"uppercase" }}>Symbol Rotation Queue</div>
        {running && <div style={{ fontSize:12, color:"#6c63ff", fontWeight:600, display:"flex", alignItems:"center", gap:5 }}>
          <div style={{ width:7, height:7, borderRadius:"50%", background:"#6c63ff", animation:"pulse 1.2s infinite" }} />
          Running {currentIdx + 1} / {queue.length}
        </div>}
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {queue.map((s, i) => {
          const result = symbolResults[s.symbol];
          const isActive = running && i === currentIdx;
          const isDone   = result !== undefined;
          const isWaiting = !running || i > currentIdx;
          return (
            <div key={s.symbol} style={{
              display:"flex", alignItems:"center", gap:12, padding:"10px 14px",
              borderRadius:10, transition:"all .2s",
              background: isActive ? "rgba(108,99,255,.07)" : isDone ? (result.pnl >= 0 ? "#f0fdf4" : "#fef2f2") : "#f8f9fc",
              border: `1px solid ${isActive ? "rgba(108,99,255,.25)" : isDone ? (result.pnl >= 0 ? "#bbf7d0" : "#fecaca") : "#f0f0f5"}`,
            }}>
              {/* Status dot */}
              <div style={{ width:10, height:10, borderRadius:"50%", flexShrink:0,
                background: isActive ? "#6c63ff" : isDone ? (result.pnl >= 0 ? "#22c55e" : "#ef4444") : "#d1d5db",
                animation: isActive ? "pulse 1.2s infinite" : "none",
              }} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:isActive?700:600, color:"#1a1a2e", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{s.label}</div>
                <div style={{ fontSize:11, color:"#9ca3af", marginTop:2 }}>
                  {s.contractType === "DIGITDIFF" ? "Differs" : "Matches"}
                  {isActive && " · Trading now…"}
                  {isDone && ` · ${result.trades} trades`}
                  {isWaiting && !isDone && " · Queued"}
                </div>
              </div>
              {isDone && (
                <div style={{ fontWeight:700, fontSize:13, color:result.pnl>=0?"#16a34a":"#dc2626", flexShrink:0 }}>
                  {result.pnl>=0?"+":""}{result.pnl.toFixed(2)}
                </div>
              )}
              {isActive && (
                <div style={{ fontSize:11, background:"rgba(108,99,255,.12)", color:"#6c63ff", borderRadius:6, padding:"3px 8px", fontWeight:600, flexShrink:0 }}>LIVE</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── MTN MoMo modal ───────────────────────────────────────────────────────────
function MoMoModal({ type, onClose }) {
  const [phone, setPhone] = useState(""); const [amount, setAmount] = useState(""); const [step, setStep] = useState("form");
  const ifield = { width:"100%", padding:"13px 16px", border:"1.5px solid #e8eaf0", borderRadius:12, fontSize:14, outline:"none", fontFamily:"inherit", background:"#f8f9fc", boxSizing:"border-box", color:"#1a1a2e" };
  const lbl    = { fontSize:11, fontWeight:700, color:"#6b7280", letterSpacing:".08em", textTransform:"uppercase", marginBottom:6, display:"block" };
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:300, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div style={{ background:"#fff", borderRadius:20, padding:28, width:"100%", maxWidth:400 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <div><div style={{ fontWeight:800, fontSize:18 }}>{type==="deposit"?"Deposit Funds":"Withdraw Funds"}</div><div style={{ fontSize:12, color:"#9ca3af", marginTop:2 }}>MTN Mobile Money · Uganda</div></div>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:24, cursor:"pointer", color:"#9ca3af" }}>×</button>
        </div>
        <div style={{ background:"linear-gradient(135deg,#fbbf24,#f59e0b)", borderRadius:14, padding:"14px 18px", marginBottom:20, display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ fontSize:30 }}>📱</span>
          <div><div style={{ fontWeight:700, color:"#78350f", fontSize:14 }}>MTN MoMo</div><div style={{ fontSize:12, color:"#92400e" }}>Instant · Uganda</div></div>
        </div>
        {step==="form" && (<>
          <div style={{ marginBottom:14 }}><label style={lbl}>MTN Number</label><input style={ifield} placeholder="0771234567" value={phone} onChange={e=>setPhone(e.target.value)} /></div>
          <div style={{ marginBottom:8 }}><label style={lbl}>Amount (UGX)</label><input style={ifield} type="number" placeholder="50000" value={amount} onChange={e=>setAmount(e.target.value)} /></div>
          {amount && <div style={{ fontSize:12, color:"#6c63ff", marginBottom:16, fontWeight:600 }}>≈ ${(parseFloat(amount)/3750).toFixed(2)} USD</div>}
          <button disabled={!phone||!amount} onClick={()=>setStep("confirm")} style={{ width:"100%", padding:14, borderRadius:12, border:"none", background:"linear-gradient(135deg,#fbbf24,#f59e0b)", color:"#78350f", fontSize:15, fontWeight:700, cursor:"pointer", opacity:(!phone||!amount)?.5:1 }}>{type==="deposit"?"Request Deposit":"Request Withdrawal"}</button>
        </>)}
        {step==="confirm" && (<>
          <div style={{ background:"#f8f9fc", borderRadius:12, padding:16, marginBottom:16 }}>
            {[["Phone",phone],["Amount",`UGX ${parseInt(amount).toLocaleString()}`],["USD",`$${(parseFloat(amount)/3750).toFixed(2)}`]].map(([l,v])=>(
              <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:"1px solid #f0f0f5" }}><span style={{ color:"#9ca3af", fontSize:13 }}>{l}</span><span style={{ fontWeight:700, fontSize:13 }}>{v}</span></div>
            ))}
          </div>
          <div style={{ background:"#fffbeb", border:"1px solid #fde68a", borderRadius:10, padding:"10px 14px", marginBottom:16, fontSize:12, color:"#92400e" }}>⚠️ PIN prompt will be sent to {phone}. Approve with your MoMo PIN.</div>
          <button onClick={()=>setStep("done")} style={{ width:"100%", padding:14, borderRadius:12, border:"none", background:"linear-gradient(135deg,#fbbf24,#f59e0b)", color:"#78350f", fontSize:15, fontWeight:700, cursor:"pointer", marginBottom:10 }}>Confirm & Send Prompt</button>
          <button onClick={()=>setStep("form")} style={{ width:"100%", padding:12, borderRadius:12, border:"1px solid #e8eaf0", background:"#fff", fontSize:14, cursor:"pointer", fontFamily:"inherit", color:"#6b7280" }}>Back</button>
        </>)}
        {step==="done" && (<div style={{ textAlign:"center", padding:"10px 0" }}>
          <div style={{ fontSize:50, marginBottom:14 }}>✅</div>
          <div style={{ fontWeight:800, fontSize:17, marginBottom:8 }}>{type==="deposit"?"Deposit Initiated!":"Withdrawal Initiated!"}</div>
          <div style={{ color:"#9ca3af", fontSize:13, marginBottom:20, lineHeight:1.7 }}>{type==="deposit"?`Approve the MoMo prompt on ${phone}. Funds reflect within 1–5 mins.`:`UGX ${parseInt(amount).toLocaleString()} will arrive on ${phone} within 1–10 mins.`}</div>
          <button onClick={onClose} style={{ width:"100%", padding:14, borderRadius:12, border:"none", background:"linear-gradient(135deg,#6c63ff,#8b5cf6)", color:"#fff", fontSize:15, fontWeight:700, cursor:"pointer" }}>Done</button>
        </div>)}
      </div>
    </div>
  );
}

// ─── Login page ───────────────────────────────────────────────────────────────
function LoginPage() {
  const handleDerivAuth = () => { window.location.href = DERIV_OAUTH_URL; };

  return (
    <div style={{ minHeight:"100vh", background:"#f0f0f8", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Inter',system-ui,sans-serif", padding:20 }}>
      <div style={{ width:"100%", maxWidth:420 }}>

        {/* Logo */}
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <div style={{ fontWeight:900, fontSize:28, color:"#6c63ff", letterSpacing:"-1px" }}>⚡ DerivBot</div>
          <div style={{ fontSize:13, color:"#9ca3af", marginTop:6 }}>Your trades. Your funds. Your control.</div>
        </div>

        <div style={{ background:"#fff", borderRadius:24, padding:36, boxShadow:"0 8px 40px rgba(108,99,255,.1)", border:"1px solid #ebebf0" }}>
          <div style={{ fontWeight:800, fontSize:22, color:"#1a1a2e", marginBottom:6 }}>Trading Console</div>
          <div style={{ fontSize:14, color:"#6b7280", marginBottom:28, lineHeight:1.6 }}>
            Connect your Deriv account to start automated trading. You'll be taken to Deriv's website to log in securely.
          </div>

          {/* Main CTA */}
          <button onClick={handleDerivAuth} style={{
            width:"100%", padding:"16px", borderRadius:14, border:"none",
            background:"linear-gradient(135deg,#ef4444,#dc2626)",
            color:"#fff", fontSize:16, fontWeight:800, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center", gap:12,
            marginBottom:20,
          }}>
            <svg width="22" height="22" viewBox="0 0 40 40" fill="none">
              <circle cx="20" cy="20" r="20" fill="rgba(255,255,255,.25)"/>
              <path d="M10 20L20 10L30 20L20 30Z" fill="white"/>
            </svg>
            Connect with Deriv
          </button>

          {/* How it works steps */}
          <div style={{ borderTop:"1px solid #f0f0f5", paddingTop:20 }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#9ca3af", letterSpacing:".08em", textTransform:"uppercase", marginBottom:14 }}>How it works</div>
            {[
              { n:"1", text:"Click Connect with Deriv above" },
              { n:"2", text:"Log in on Deriv's official website" },
              { n:"3", text:"Get redirected back here automatically" },
              { n:"4", text:"Start trading — no copy-pasting anything" },
            ].map(s => (
              <div key={s.n} style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12 }}>
                <div style={{ width:26, height:26, borderRadius:"50%", background:"#f0eeff", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:"#6c63ff", flexShrink:0 }}>{s.n}</div>
                <div style={{ fontSize:13, color:"#6b7280" }}>{s.text}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Safety note */}
        <div style={{ marginTop:16, background:"#fff", border:"1px solid #e8eaf0", borderRadius:14, padding:"14px 18px", display:"flex", gap:12, alignItems:"flex-start" }}>
          <div style={{ fontSize:18, flexShrink:0 }}>🔒</div>
          <div style={{ fontSize:12, color:"#6b7280", lineHeight:1.6 }}>
            Your funds stay in your Deriv account at all times. DerivBot never holds your money or asks for wallet deposits.
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── Trade history row ────────────────────────────────────────────────────────
function TradeRow({ t }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px", borderRadius:10, background:t.won?"#f0fdf4":"#fef2f2", border:`1px solid ${t.won?"#bbf7d0":"#fecaca"}` }}>
      <div style={{ width:8, height:8, borderRadius:"50%", background:t.won?"#22c55e":"#ef4444", flexShrink:0 }} />
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontWeight:600, fontSize:13, color:"#1a1a2e" }}>{t.symbolLabel} · {t.type} · D{t.digit}</div>
        <div style={{ fontSize:11, color:"#9ca3af", marginTop:2 }}>Last: {t.lastDigit??"—"} · Step {t.step+1} · ${t.stake?.toFixed(2)}</div>
      </div>
      <div style={{ fontWeight:700, fontSize:13, color:t.won?"#16a34a":"#dc2626", flexShrink:0 }}>{t.won?"+":"-"}${Math.abs(t.profit).toFixed(2)}</div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [token,  setToken]  = useState(() => extractDerivTokenFromURL() || localStorage.getItem("deriv_token") || "");
  const [activeTab, setActiveTab] = useState("trade");

  // Config
  const [strategy,     setStrategy]     = useState(STRATEGIES[0]);
  const [selectedDigit,setSelectedDigit]= useState(5);
  const [stake,        setStake]        = useState(0.35);
  const [symbolTp,     setSymbolTp]     = useState(5);   // TP per symbol before rotating
  const [globalSl,     setGlobalSl]     = useState(50);  // Global SL for full session
  const [skipOnSl,     setSkipOnSl]     = useState(true);// Skip symbol on SL or stop session

  // Session state
  const [running,        setRunning]        = useState(false);
  const [currentSymIdx,  setCurrentSymIdx]  = useState(0);
  const [step,           setStep]           = useState(0);
  const [symbolPnl,      setSymbolPnl]      = useState(0);   // PnL for current symbol
  const [sessionPnl,     setSessionPnl]     = useState(0);   // PnL across ALL symbols
  const [symbolResults,  setSymbolResults]  = useState({});  // { symbol: { pnl, trades } }
  const [trades,         setTrades]         = useState([]);
  const [status,         setStatus]         = useState("idle");
  const [logs,           setLogs]           = useState([]);
  const [momoModal,      setMomoModal]      = useState(null);

  // Live data
  const [priceTicks,  setPriceTicks]  = useState([]);
  const [digitTicks,  setDigitTicks]  = useState([]);
  const [currentPrice,setCurrentPrice]= useState(null);

  const pendingRef      = useRef(null);
  const sessionPnlRef   = useRef(0);
  const symbolPnlRef    = useRef(0);
  const stepRef         = useRef(0);
  const currentSymIdxRef= useRef(0);

  const { connected, account, balance, send, on, off } = useDerivWS(token);
  const handleLogout = () => { localStorage.removeItem("deriv_token"); setToken(""); setRunning(false); };
  if (!token) return <LoginPage />;

  const addLog = (msg, type="info") => setLogs(p => [{ msg, type, ts: new Date().toLocaleTimeString() }, ...p].slice(0, 100));

  const getStakeAt = useCallback((s) => {
    let v = stake; for (let i=0;i<s;i++) v*=MULT; return parseFloat(v.toFixed(2));
  }, [stake]);

  const currentSym = SYMBOL_QUEUE[currentSymIdx];

  // Resolve contract type per symbol based on strategy setting
  const resolveContractType = useCallback((symEntry) => {
    if (strategy.value === "AUTO")       return symEntry.contractType; // per-symbol assignment
    return strategy.value;
  }, [strategy]);

  // ── Tick subscription (follows active symbol) ────────────────────────────
  useEffect(() => {
    if (!connected) return;
    send({ ticks: currentSym.symbol, subscribe: 1 });
    setPriceTicks([]); setDigitTicks([]);
    on("ticks", d => {
      if (d.msg_type === "tick" && d.tick?.symbol === currentSym.symbol) {
        const p = d.tick.quote;
        const ld = parseInt(p.toFixed(2).toString().slice(-1));
        setCurrentPrice(p);
        setPriceTicks(prev => [p, ...prev].slice(0, 100));
        setDigitTicks(prev => [ld, ...prev].slice(0, 200));
      }
    });
    return () => { send({ forget_all: "ticks" }); off("ticks"); };
  }, [connected, currentSymIdx]);

  // ── Advance to next symbol ───────────────────────────────────────────────
  const advanceSymbol = useCallback((resultPnl, resultTrades, reason) => {
    const sym = SYMBOL_QUEUE[currentSymIdxRef.current];
    setSymbolResults(prev => ({ ...prev, [sym.symbol]: { pnl: resultPnl, trades: resultTrades } }));
    addLog(`${sym.label} done (${reason}) · ${resultPnl>=0?"+":""}$${resultPnl.toFixed(2)}`, resultPnl>=0?"success":"warning");

    const nextIdx = currentSymIdxRef.current + 1;
    if (nextIdx >= SYMBOL_QUEUE.length) {
      // All symbols done — session complete
      setRunning(false);
      addLog(`✅ All symbols complete · Session P&L: ${sessionPnlRef.current>=0?"+":""}$${sessionPnlRef.current.toFixed(2)}`, "success");
      return;
    }
    // Move to next symbol
    stepRef.current = 0;
    symbolPnlRef.current = 0;
    currentSymIdxRef.current = nextIdx;
    setCurrentSymIdx(nextIdx);
    setStep(0);
    setSymbolPnl(0);
    setStatus("idle");
    addLog(`▶ Moving to ${SYMBOL_QUEUE[nextIdx].label}`, "info");
  }, []);

  // ── Contract result listener ─────────────────────────────────────────────
  useEffect(() => {
    on("contracts", d => {
      if (d.msg_type === "buy") {
        if (d.error) {
          addLog(`Buy error: ${d.error.message}`, "danger");
          setStatus("idle"); pendingRef.current = null;
        } else {
          send({ proposal_open_contract: 1, contract_id: d.buy.contract_id, subscribe: 1 });
        }
      }
      if (d.msg_type === "proposal_open_contract") {
        const c = d.proposal_open_contract;
        if (c.status !== "won" && c.status !== "lost") return;

        const won      = c.status === "won";
        const profit   = won ? parseFloat(c.profit) : -parseFloat(c.buy_price);
        const lastDigit= c.exit_tick?.toString().slice(-1);
        const ts       = pendingRef.current?.step ?? 0;
        const sym      = SYMBOL_QUEUE[currentSymIdxRef.current];
        const ct       = pendingRef.current?.contractType ?? sym.contractType;

        // Record trade
        setTrades(prev => [{
          won, profit, step: ts,
          stake: getStakeAt(ts),
          type: ct === "DIGITDIFF" ? "Differs" : "Matches",
          digit: selectedDigit,
          lastDigit,
          symbol: sym.symbol,
          symbolLabel: sym.label,
        }, ...prev]);

        // Update PnLs
        const newSymPnl  = parseFloat((symbolPnlRef.current + profit).toFixed(2));
        const newSessPnl = parseFloat((sessionPnlRef.current + profit).toFixed(2));
        symbolPnlRef.current  = newSymPnl;
        sessionPnlRef.current = newSessPnl;
        setSymbolPnl(newSymPnl);
        setSessionPnl(newSessPnl);

        // Log
        if (won) addLog(`WIN +$${profit.toFixed(2)} · ${sym.label}`, "success");
        else     addLog(`LOSS -$${Math.abs(profit).toFixed(2)} · step ${ts+1}`, "warning");

        // Global SL check
        if (newSessPnl <= -globalSl) {
          addLog(`🛑 Global stop loss hit -$${Math.abs(newSessPnl).toFixed(2)}`, "danger");
          setRunning(false); setStatus("idle"); pendingRef.current = null;
          setSymbolResults(prev => ({ ...prev, [sym.symbol]: { pnl: newSymPnl, trades: (prev[sym.symbol]?.trades??0)+1 } }));
          return;
        }

        pendingRef.current = null;

        if (won) {
          stepRef.current = 0;
          setStep(0);
          // Check symbol TP
          if (newSymPnl >= symbolTp) {
            const totalTrades = trades.length + 1;
            advanceSymbol(newSymPnl, totalTrades, "TP hit");
          } else {
            setStatus("idle");
          }
        } else {
          const nextStep = ts + 1;
          if (nextStep >= 6) {
            // Max martingale steps — skip this symbol
            addLog(`Max steps on ${sym.label} — skipping`, "danger");
            const totalTrades = trades.length + 1;
            advanceSymbol(newSymPnl, totalTrades, "max steps");
          } else {
            stepRef.current = nextStep;
            setStep(nextStep);
            setStatus("idle");
          }
        }
      }
    });
    return () => off("contracts");
  }, [connected, selectedDigit, strategy, globalSl, symbolTp, getStakeAt, advanceSymbol]);

  // ── Trade placement loop ─────────────────────────────────────────────────
  useEffect(() => {
    if (!running || !connected || status !== "idle") return;
    const t = setTimeout(() => {
      const sym = SYMBOL_QUEUE[currentSymIdxRef.current];
      const ct  = resolveContractType(sym);
      const s   = getStakeAt(stepRef.current);
      setStatus("placing");
      pendingRef.current = { step: stepRef.current, contractType: ct };
      send({
        buy: 1, price: s,
        parameters: {
          amount: s, basis: "stake", contract_type: ct,
          currency: "USD", duration: 1, duration_unit: "t",
          symbol: sym.symbol, barrier: selectedDigit.toString(),
        }
      });
    }, 1200);
    return () => clearTimeout(t);
  }, [running, connected, status, selectedDigit, resolveContractType, getStakeAt]);

  // ── Session controls ─────────────────────────────────────────────────────
  const startSession = () => {
    setSymbolResults({});
    setTrades([]);
    setSessionPnl(0);
    setSymbolPnl(0);
    setStep(0);
    setStatus("idle");
    currentSymIdxRef.current = 0;
    sessionPnlRef.current    = 0;
    symbolPnlRef.current     = 0;
    stepRef.current          = 0;
    setCurrentSymIdx(0);
    setRunning(true);
    addLog(`🚀 Session started · Digit ${selectedDigit} · ${strategy.label} · $${stake} stake`, "info");
    addLog(`Cycling through ${SYMBOL_QUEUE.length} symbols · Symbol TP $${symbolTp} · Global SL $${globalSl}`, "info");
  };

  const stopSession = () => {
    setRunning(false); setStatus("idle");
    addLog("Session stopped manually", "warning");
  };

  const wins    = trades.filter(t => t.won).length;
  const winRate = trades.length ? ((wins / trades.length) * 100).toFixed(1) : null;

  // Styles
  const inputStyle = { background:"#f4f5f9", border:"none", borderRadius:10, padding:"13px 16px", fontSize:15, fontWeight:600, color:"#1a1a2e", fontFamily:"inherit", outline:"none", width:"100%", boxSizing:"border-box" };
  const lbl = { fontSize:11, fontWeight:700, color:"#9ca3af", letterSpacing:".08em", textTransform:"uppercase", marginBottom:6, display:"block" };
  const inputBox = (children) => (<div style={{ background:"#f4f5f9", borderRadius:12, padding:"13px 16px", marginBottom:10 }}>{children}</div>);

  // SVG icons
  const TradeIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>;
  const HistIcon  = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>;
  const ProfIcon  = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>;

  return (
    <div style={{ minHeight:"100vh", background:"#f0f0f8", fontFamily:"'Inter',system-ui,sans-serif", color:"#1a1a2e", fontSize:14 }}>
      {momoModal && <MoMoModal type={momoModal} onClose={()=>setMomoModal(null)} />}

      {/* ── Top nav ── */}
      <div style={{ background:"#fff", borderBottom:"1px solid #e8eaf0", padding:"0 24px", height:54, display:"flex", alignItems:"center", gap:14, position:"sticky", top:0, zIndex:100, boxShadow:"0 1px 4px rgba(0,0,0,.05)" }}>
        <div style={{ fontWeight:900, fontSize:18, color:"#6c63ff", letterSpacing:"-0.5px" }}>⚡ DerivBot</div>
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, background:connected?"#f0fdf4":"#fef2f2", border:`1px solid ${connected?"#bbf7d0":"#fecaca"}`, borderRadius:20, padding:"4px 12px", fontSize:12, color:connected?"#16a34a":"#dc2626" }}>
            <div style={{ width:7, height:7, borderRadius:"50%", background:connected?"#22c55e":"#ef4444" }} />
            {connected?(account?.loginid??"Connected"):"Connecting…"}
          </div>
          {connected && balance && <div style={{ fontWeight:700, fontSize:15 }}>${balance.balance.toFixed(2)} <span style={{ fontWeight:400, color:"#9ca3af", fontSize:12 }}>{balance.currency}</span></div>}
          <button onClick={handleLogout} style={{ background:"none", border:"1px solid #e8eaf0", borderRadius:8, padding:"5px 14px", fontSize:13, color:"#6b7280", cursor:"pointer", fontFamily:"inherit" }}>Logout</button>
        </div>
      </div>

      {/* ── Trade tab ── */}
      {activeTab==="trade" && (
        <div style={{ display:"grid", gridTemplateColumns:"360px 1fr", minHeight:"calc(100vh - 54px - 62px)" }}>

          {/* LEFT SIDEBAR */}
          <div style={{ background:"#f4f5f9", borderRight:"1px solid #e8eaf0", padding:20, display:"flex", flexDirection:"column", gap:16, overflowY:"auto" }}>

            {/* Balance */}
            <div style={{ background:"#fff", borderRadius:16, padding:"18px 20px", border:"1px solid #ebebf0", boxShadow:"0 1px 4px rgba(0,0,0,.04)" }}>
              <div style={lbl}>Account Balance</div>
              <div style={{ fontSize:32, fontWeight:900, color:"#1a1a2e", marginBottom:16 }}>${balance?.balance?.toFixed(2)??"0.00"}</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
                {[
                  { label:"Deposit Funds",       sub:"M-Pesa / Crypto",  action:()=>setMomoModal("deposit") },
                  { label:"Withdraw Funds",       sub:"Fast Processing",  action:()=>setMomoModal("withdraw") },
                  { label:"Transaction History",  sub:null,               action:()=>setActiveTab("history") },
                ].map(({ label, sub, action }) => (
                  <button key={label} onClick={action} style={{ background:"#f4f5f9", border:"1px solid #e8eaf0", borderRadius:12, padding:"12px 8px", textAlign:"left", cursor:"pointer" }}>
                    <div style={{ fontWeight:700, fontSize:12, color:"#1a1a2e" }}>{label}</div>
                    {sub && <div style={{ fontSize:11, color:"#9ca3af", marginTop:2 }}>{sub}</div>}
                  </button>
                ))}
              </div>
            </div>

            {/* Digit Stats */}
            <DigitStats ticks={digitTicks} selected={selectedDigit} onSelect={d => setSelectedDigit(d ?? 5)} />

            {/* Trading Engine */}
            <div style={{ background:"#fff", borderRadius:16, padding:"18px 20px", border:"1px solid #ebebf0", boxShadow:"0 1px 4px rgba(0,0,0,.04)" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                <div style={{ fontWeight:800, fontSize:16 }}>Trading Engine</div>
                <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:12, background:running?"rgba(108,99,255,.1)":"#f4f5f9", border:`1px solid ${running?"rgba(108,99,255,.3)":"#e8eaf0"}`, borderRadius:20, padding:"4px 12px", color:running?"#6c63ff":"#9ca3af" }}>
                  <div style={{ width:7, height:7, borderRadius:"50%", background:running?"#6c63ff":"#9ca3af", animation:running?"pulse 1.2s infinite":"none" }} />
                  {running?"LIVE":"IDLE"}
                </div>
              </div>

              {/* AI Bot / Manual toggle */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", background:"#f4f5f9", borderRadius:12, padding:4, marginBottom:16 }}>
                {["AI Bot","Manual"].map((m,i)=>(<button key={m} style={{ padding:"10px", borderRadius:10, border:"none", background:i===0?"#fff":"transparent", fontWeight:i===0?700:500, fontSize:14, color:i===0?"#1a1a2e":"#9ca3af", cursor:"pointer", fontFamily:"inherit", boxShadow:i===0?"0 1px 6px rgba(0,0,0,.1)":"none" }}>{m}</button>))}
              </div>

              {!connected && <div style={{ background:"#f4f5f9", borderRadius:10, padding:14, textAlign:"center", marginBottom:16 }}><div style={{ fontSize:12, fontWeight:700, color:"#9ca3af", letterSpacing:".06em", textTransform:"uppercase" }}>Waiting for Connection...</div></div>}

              {inputBox(<><label style={lbl}>Stake ($) <span style={{ color:"#6c63ff", textTransform:"none", letterSpacing:0 }}>(Min 0.35)</span></label><input style={inputStyle} type="number" min="0.35" step="0.05" value={stake} onChange={e=>setStake(parseFloat(e.target.value)||0.35)} /></>)}
              {inputBox(<><label style={lbl}>Strategy</label><select style={{ ...inputStyle, cursor:"pointer" }} value={strategy.value} onChange={e=>setStrategy(STRATEGIES.find(s=>s.value===e.target.value))}>{STRATEGIES.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}</select></>)}

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
                <div style={{ background:"#f4f5f9", borderRadius:12, padding:"13px 16px" }}>
                  <label style={lbl}>Symbol TP ($)</label>
                  <input style={inputStyle} type="number" value={symbolTp} onChange={e=>setSymbolTp(parseFloat(e.target.value)||1)} />
                  <div style={{ fontSize:10, color:"#9ca3af", marginTop:4 }}>Profit to rotate symbol</div>
                </div>
                <div style={{ background:"#f4f5f9", borderRadius:12, padding:"13px 16px" }}>
                  <label style={lbl}>Global SL ($)</label>
                  <input style={inputStyle} type="number" value={globalSl} onChange={e=>setGlobalSl(parseFloat(e.target.value)||1)} />
                  <div style={{ fontSize:10, color:"#9ca3af", marginTop:4 }}>Stop full session</div>
                </div>
              </div>

              {inputBox(<><label style={lbl}>Martingale Multiplier</label><div style={{ fontSize:20, fontWeight:800, color:"#1a1a2e" }}>2.1×</div></>)}

              {/* Current symbol indicator */}
              {running && (
                <div style={{ background:"rgba(108,99,255,.07)", border:"1px solid rgba(108,99,255,.2)", borderRadius:10, padding:"10px 14px", marginBottom:14, fontSize:12 }}>
                  <div style={{ color:"#6c63ff", fontWeight:700, marginBottom:3 }}>Now trading: {currentSym.label}</div>
                  <div style={{ color:"#9ca3af" }}>
                    {resolveContractType(currentSym)==="DIGITDIFF"?"Differs":"Matches"} · Digit {selectedDigit} · Step {step+1} · ${getStakeAt(step).toFixed(2)}
                    {" · "}{status==="placing"?"Placing…":"Waiting for tick…"}
                  </div>
                  <div style={{ marginTop:6, color:"#9ca3af" }}>Symbol P&L: <span style={{ color:symbolPnl>=0?"#16a34a":"#dc2626", fontWeight:700 }}>{symbolPnl>=0?"+":""}{symbolPnl.toFixed(2)}</span> / TP ${symbolTp}</div>
                </div>
              )}

              {!running
                ? <button onClick={startSession} disabled={!connected} style={{ width:"100%", padding:"15px", borderRadius:14, border:"none", background:connected?"linear-gradient(135deg,#6c63ff,#8b5cf6)":"#e8eaf0", color:connected?"#fff":"#9ca3af", fontSize:16, fontWeight:800, cursor:connected?"pointer":"not-allowed" }}>
                    Start Trading Bot
                  </button>
                : <button onClick={stopSession} style={{ width:"100%", padding:"15px", borderRadius:14, border:"none", background:"linear-gradient(135deg,#ef4444,#dc2626)", color:"#fff", fontSize:16, fontWeight:800, cursor:"pointer" }}>
                    Stop Trading Bot
                  </button>
              }
            </div>
          </div>

          {/* RIGHT MAIN */}
          <div style={{ padding:24, display:"flex", flexDirection:"column", gap:18, overflowY:"auto" }}>

            {/* Session stats */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14 }}>
              {[
                { label:"Session P&L",   value:`${sessionPnl>=0?"+":""}$${sessionPnl.toFixed(2)}`, color:sessionPnl>0?"#16a34a":sessionPnl<0?"#dc2626":"#1a1a2e" },
                { label:"Symbol P&L",    value:`${symbolPnl>=0?"+":""}$${symbolPnl.toFixed(2)}`,   color:symbolPnl>0?"#16a34a":symbolPnl<0?"#dc2626":"#1a1a2e" },
                { label:"Win Rate",      value:winRate?`${winRate}%`:"—",                           color:"#6c63ff" },
                { label:"Total Trades",  value:trades.length,                                        color:"#1a1a2e" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background:"#fff", borderRadius:16, padding:"16px 18px", border:"1px solid #ebebf0", boxShadow:"0 1px 4px rgba(0,0,0,.04)" }}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:".08em", marginBottom:8 }}>{label}</div>
                  <div style={{ fontSize:22, fontWeight:800, color, fontVariantNumeric:"tabular-nums" }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Live chart of current symbol */}
            <LiveChart ticks={priceTicks} symbol={currentSym.symbol} price={currentPrice} />

            {/* Symbol rotation tracker — THE KEY FEATURE */}
            <RotationTracker
              queue={SYMBOL_QUEUE}
              currentIdx={currentSymIdx}
              symbolResults={symbolResults}
              running={running}
            />

            {/* Recent trades */}
            {trades.length > 0 && (
              <div style={{ background:"#fff", borderRadius:16, padding:"18px 20px", border:"1px solid #ebebf0", boxShadow:"0 1px 4px rgba(0,0,0,.04)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:14 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:".08em" }}>Recent Trades</div>
                  <div style={{ fontSize:12, fontWeight:600, color:"#22c55e" }}>{wins}W / {trades.length-wins}L</div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {trades.slice(0,8).map((t,i)=><TradeRow key={i} t={t} />)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── History tab ── */}
      {activeTab==="history" && (
        <div style={{ padding:24, maxWidth:740, margin:"0 auto" }}>
          {/* Symbol summary cards */}
          {Object.keys(symbolResults).length > 0 && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:16 }}>
              {Object.entries(symbolResults).map(([sym, res]) => {
                const entry = SYMBOL_QUEUE.find(s=>s.symbol===sym);
                return (
                  <div key={sym} style={{ background:"#fff", borderRadius:12, padding:"12px 14px", border:`1px solid ${res.pnl>=0?"#bbf7d0":"#fecaca"}` }}>
                    <div style={{ fontSize:12, fontWeight:700, color:"#1a1a2e", marginBottom:4 }}>{entry?.label??sym}</div>
                    <div style={{ fontWeight:800, fontSize:18, color:res.pnl>=0?"#16a34a":"#dc2626" }}>{res.pnl>=0?"+":""}${res.pnl.toFixed(2)}</div>
                    <div style={{ fontSize:11, color:"#9ca3af", marginTop:2 }}>{res.trades} trades</div>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ background:"#fff", borderRadius:16, padding:24, border:"1px solid #ebebf0", marginBottom:16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:16 }}>
              <div style={{ fontWeight:800, fontSize:17 }}>Trade History ({trades.length})</div>
              {winRate && <div style={{ fontSize:13, color:"#9ca3af" }}>{winRate}% win rate</div>}
            </div>
            {trades.length===0 ? <div style={{ color:"#9ca3af", textAlign:"center", padding:"40px 0" }}>No trades yet</div> : <div style={{ display:"flex", flexDirection:"column", gap:8 }}>{trades.map((t,i)=><TradeRow key={i} t={t} />)}</div>}
          </div>
          <div style={{ background:"#fff", borderRadius:16, padding:24, border:"1px solid #ebebf0" }}>
            <div style={{ fontWeight:800, fontSize:17, marginBottom:14 }}>Activity Log</div>
            {logs.length===0 ? <div style={{ color:"#9ca3af", fontSize:13 }}>No activity yet</div> : (
              <div style={{ display:"flex", flexDirection:"column", gap:5, maxHeight:360, overflowY:"auto" }}>
                {logs.map((l,i)=>(<div key={i} style={{ display:"flex", gap:10, fontSize:12 }}><span style={{ color:"#9ca3af", flexShrink:0 }}>{l.ts}</span><span style={{ color:l.type==="success"?"#16a34a":l.type==="danger"?"#dc2626":l.type==="warning"?"#d97706":"#6b7280" }}>{l.msg}</span></div>))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Profile tab ── */}
      {activeTab==="profile" && (
        <div style={{ padding:24, maxWidth:500, margin:"0 auto" }}>
          <div style={{ background:"#fff", borderRadius:16, padding:24, border:"1px solid #ebebf0" }}>
            <div style={{ fontWeight:800, fontSize:17, marginBottom:20 }}>Profile</div>
            {[["Login ID",account?.loginid],["Account Type",account?.account_type],["Currency",balance?.currency],["Balance",balance?`$${balance.balance.toFixed(2)}`:null],["Email",account?.email]].map(([l,v])=>(
              <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"11px 0", borderBottom:"1px solid #f0f0f5" }}><span style={{ color:"#9ca3af", fontSize:13 }}>{l}</span><span style={{ fontWeight:600, fontSize:13 }}>{v??"—"}</span></div>
            ))}
            <button onClick={handleLogout} style={{ marginTop:24, width:"100%", padding:14, borderRadius:12, border:"none", background:"linear-gradient(135deg,#ef4444,#dc2626)", color:"#fff", fontSize:15, fontWeight:700, cursor:"pointer" }}>Disconnect Account</button>
          </div>
        </div>
      )}

      {/* ── Bottom nav ── */}
      <div style={{ position:"fixed", bottom:0, left:0, right:0, background:"#fff", borderTop:"1px solid #e8eaf0", display:"flex", justifyContent:"space-around", padding:"10px 0 14px", zIndex:100 }}>
        {[{ id:"trade",icon:TradeIcon,label:"Trade" },{ id:"history",icon:HistIcon,label:"History" },{ id:"profile",icon:ProfIcon,label:"Profile" }].map(({ id, icon, label })=>(
          <button key={id} onClick={()=>setActiveTab(id)} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, background:"none", border:"none", cursor:"pointer", padding:"4px 32px", color:activeTab===id?"#6c63ff":"#9ca3af", fontFamily:"inherit", fontSize:12, fontWeight:activeTab===id?700:400, borderTop:activeTab===id?"2px solid #6c63ff":"2px solid transparent" }}>
            {icon}{label}
          </button>
        ))}
      </div>
      <div style={{ height:72 }} />
      <style>{`*{box-sizing:border-box;margin:0;padding:0}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#e8eaf0;border-radius:4px}select option{background:#fff}`}</style>
    </div>
  );
}
