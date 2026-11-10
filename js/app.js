// Agent Market mint page v3: live board + wallet mint widget + Agent ID tools
// + Mint on Agent modal. Mirrors the reference drop feature set, reads and
// writes go through AMW (js/wallet.js).
const { ethCall, asUint, asBool, padAddr, u256, fmt, fmtBNB, toast, friendlyError } = window.AMW;

const STALL = "0xE3dE7fD0d12cFF4a46d8Bf702Ab593B6f921b308";
const PRESALE = "0xA6Ef01e926eFbD35661e7B1d3E1CBeE360750b16";
const CLAIM = "0xf40c9345D8EccA7B437c45e5DabADb0Ed8cdd209";
const REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
const SUPPLY = 12000;
const MAXW = 25;
const T1 = 300000000000000n, T2 = 500000000000000n, T3 = 700000000000000n;

const SEL = {
  totalSupply: "0x18160ddd", mintOpen: "0x24bbd049", mintedBy: "0x3cef28d2",
  costFor: "0xf31cc4e6", balanceOf: "0x70a08231", holdsAgentId: "0x11213086",
  startTime: "0x78e97925", endTime: "0x3197cbb6", sold: "0x02c7e7af",
  handleOf: "0xc50a1514",
};
const $ = (id) => document.getElementById(id);
const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };

// Animated stat numbers: counts from the last shown value to the new one
// whenever the live board refreshes, and from zero on first appearance.
// The final frame always writes finalText, the exact string the plain
// setter would have produced. Reduced motion writes the value directly.
const REDUCED = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
const numAnim = {};
function setNum(id, target, finalText) {
  const el = $(id);
  if (!el) return;
  const st = numAnim[id] || (numAnim[id] = { val: 0, raf: 0 });
  if (st.raf) cancelAnimationFrame(st.raf);
  const from = st.val;
  st.val = target;
  if (REDUCED || from === target) { el.textContent = finalText; st.raf = 0; return; }
  const t0 = performance.now(), dur = 700;
  const stepFn = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(Math.round(from + (target - from) * e));
    if (k < 1) st.raf = requestAnimationFrame(stepFn);
    else { el.textContent = finalText; st.raf = 0; }
  };
  st.raf = requestAnimationFrame(stepFn);
}

function priceFor(n, hasId) {
  if (n === 1 && hasId) return 0n;
  if (n <= 10) return T1;
  if (n <= 20) return T2;
  return T3;
}
function costLocal(owned, qty, hasId) {
  let s = 0n;
  for (let i = 1; i <= qty; i++) s += priceFor(owned + i, hasId);
  return s;
}

const n = { qty: 1, owned: 0, minted: 0, mintOpen: false, agent: false, agentName: null, checking: false, busy: false };
let endTimeSec = 0;

// ---- Live board -----------------------------------------------------------
function tickCountdown() {
  if (!endTimeSec) return;
  const left = endTimeSec - Math.floor(Date.now() / 1000);
  if (left <= 0) { set("st-countdown", "Presale ended"); return; }
  const dd = Math.floor(left / 86400), hh = Math.floor((left % 86400) / 3600), mm = Math.floor((left % 3600) / 60), ss = left % 60;
  set("st-countdown", `${dd}d ${String(hh).padStart(2, "0")}h ${String(mm).padStart(2, "0")}m ${String(ss).padStart(2, "0")}s`);
}

async function refreshBoard() {
  try {
    const [supply, open, start, end, sold] = await Promise.all([
      ethCall(STALL, SEL.totalSupply).then(asUint),
      ethCall(STALL, SEL.mintOpen).then(asBool),
      ethCall(PRESALE, SEL.startTime).then(asUint),
      ethCall(PRESALE, SEL.endTime).then(asUint),
      ethCall(PRESALE, SEL.sold).then(asUint),
    ]);
    n.minted = Number(supply);
    n.mintOpen = open;
    setNum("st-minted", n.minted, fmt(n.minted));
    setNum("st-left", SUPPLY - n.minted, fmt(SUPPLY - n.minted));
    set("st-mint-status", open ? "OPEN" : "NOT OPEN YET");
    setNum("st-sold", Number(sold / 10n ** 18n), fmt(sold / 10n ** 18n));
    const pf = $("pgFill");
    if (pf) pf.style.width = Math.min(100, (n.minted / SUPPLY) * 100).toFixed(2) + "%";
    if (start === 0n) {
      set("st-presale", "NOT STARTED");
      set("st-countdown", "Starts on announcement");
      endTimeSec = 0;
    } else if (BigInt(Math.floor(Date.now() / 1000)) < end) {
      set("st-presale", "OPEN");
      endTimeSec = Number(end);
      tickCountdown();
    } else {
      set("st-presale", "ENDED");
      set("st-countdown", "Ended · claims open");
      endTimeSec = 0;
    }
  } catch (e) { /* keep last values */ }
  renderWidget();
}

// ---- Live claim ledger ------------------------------------------------------
// Reads totalClaims() and poolBalance() from the AgentMarketClaim contract
// through the same raced public RPCs as the mint board. On any failure the
// last shown values stay on screen; nothing is ever replaced with a fake 0.
const CLAIM_SEL = { totalClaims: "0x41c61383", poolBalance: "0x96365d44", claimPool: "0xeea9aef7" };
const CLAIM_POOL_FALLBACK = 300000000n * 10n ** 18n;
let claimPoolTotal = 0n;
async function refreshClaims() {
  try {
    if (!claimPoolTotal) {
      claimPoolTotal = await ethCall(CLAIM, CLAIM_SEL.claimPool).then(asUint).catch(() => 0n);
      if (!claimPoolTotal) claimPoolTotal = CLAIM_POOL_FALLBACK;
    }
    const [total, pool] = await Promise.all([
      ethCall(CLAIM, CLAIM_SEL.totalClaims).then(asUint),
      ethCall(CLAIM, CLAIM_SEL.poolBalance).then(asUint),
    ]);
    const claimed = claimPoolTotal > pool ? claimPoolTotal - pool : 0n;
    setNum("cl-total", Number(total), fmt(total));
    setNum("cl-claimed", Number(claimed / 10n ** 18n), fmt(claimed / 10n ** 18n));
    setNum("cl-pool", Number(pool / 10n ** 18n), fmt(pool / 10n ** 18n));
  } catch (e) { /* keep last values */ }
}

async function refreshOwned() {
  const st = window.AMW.state;
  if (!st.address) { n.owned = 0; renderWidget(); return; }
  try {
    n.owned = Number(await ethCall(STALL, SEL.mintedBy + padAddr(st.address)).then(asUint));
  } catch {}
  clampQty();
  renderWidget();
}

// ---- Mint widget ------------------------------------------------------------
function clampQty() {
  const left = MAXW - n.owned;
  n.qty = Math.max(left ? 1 : 0, Math.min(left, n.qty || 1));
}
$("minus").addEventListener("click", () => { n.qty = Math.max(1, n.qty - 1); renderWidget(); });
$("plus").addEventListener("click", () => { n.qty = Math.min(MAXW - n.owned, n.qty + 1); renderWidget(); });

function renderWidget() {
  const st = window.AMW.state;
  const hasId = !!n.agent;
  clampQty();
  set("qty", n.qty);
  $("minus").disabled = n.qty <= 1;
  $("plus").disabled = n.qty >= MAXW - n.owned;
  // Bill lines grouped like the reference: consecutive mints with same price.
  const groups = new Map();
  for (let i = 1; i <= n.qty; i++) {
    const num = n.owned + i;
    const p = priceFor(num, hasId);
    const key = (num === 1 ? "first" : "t") + p.toString();
    const g = groups.get(key) || { from: num, to: num, p, count: 0, first: num === 1 };
    g.to = num; g.count++; groups.set(key, g);
  }
  $("bill").innerHTML = [...groups.values()].map((g) => {
    const label = g.from === g.to ? `Stall #${g.from}` : `Stalls #${g.from} to #${g.to}`;
    const tag = g.first ? `<small>${hasId ? "Agent ID" : "No Agent ID"}</small>` : "";
    const val = g.p === 0n ? '<span class="free-t">Free</span>' : `<b class="num">${g.count} × ${fmtBNB(g.p)} BNB</b>`;
    return `<div class="bl"><span>${label}${tag}</span><span>${val}</span></div>`;
  }).join("");
  const total = costLocal(n.owned, n.qty, hasId);
  $("total").innerHTML = total === 0n ? "Free" : `${fmtBNB(total)} <b>BNB</b>`;
  set("ownedNote", n.owned ? `You hold ${n.owned}. ${MAXW - n.owned} left for this wallet.` : "Max 25 per wallet");
  renderMintBtn(st);
}

function renderMintBtn(st) {
  const t = $("mintBtn");
  if (!st.connected) { t.disabled = false; t.textContent = "Connect wallet"; t.dataset.act = "connect"; return; }
  if (st.chainId !== 56) { t.disabled = false; t.textContent = "Switch to BNB Chain"; t.dataset.act = "switch"; return; }
  if (n.busy) { t.disabled = true; t.textContent = "Confirm in your wallet…"; t.dataset.act = ""; return; }
  if (!n.mintOpen) { t.disabled = true; t.textContent = "Mint opens soon"; t.dataset.act = ""; return; }
  if (n.minted >= SUPPLY) { t.disabled = true; t.textContent = "Sold out"; t.dataset.act = ""; return; }
  if (n.owned >= MAXW) { t.disabled = true; t.textContent = "Wallet limit reached"; t.dataset.act = ""; return; }
  t.disabled = !n.qty;
  t.textContent = n.qty === 1 ? "Mint 1 Stall" : `Mint ${n.qty} Stalls`;
  t.dataset.act = "mint";
}

$("mintBtn").addEventListener("click", async () => {
  const act = $("mintBtn").dataset.act;
  if (act === "connect") return window.AMW.connect();
  if (act === "switch") {
    try { await window.AMW.ensureBsc(); } catch { toast("Switch to BNB Chain in your wallet."); }
    return;
  }
  if (act === "mint") return doMint();
});

async function doMint() {
  const st = window.AMW.state;
  const qty = n.qty;
  n.busy = true; renderWidget();
  try {
    const cost = await ethCall(STALL, SEL.costFor + padAddr(st.address) + u256(qty)).then(asUint);
    const hash = await window.AMW.sendTx({
      to: STALL,
      data: "0xa0712d68" + u256(qty),
      value: cost,
    });
    toast(qty === 1 ? "Minted 1 Stall." : `Minted ${qty} Stalls.`);
    const line = $("txline");
    line.hidden = false;
    line.innerHTML = `Transaction: <a href="https://bscscan.com/tx/${hash}" target="_blank" rel="noopener">${hash}</a>`;
    await Promise.all([refreshBoard(), refreshOwned()]);
  } catch (e) {
    toast(friendlyError(e));
  }
  n.busy = false;
  n.qty = 1;
  renderWidget();
}

// ---- Who row + Agent ID -----------------------------------------------------
function renderWho() {
  const st = window.AMW.state;
  const e = $("who");
  e.className = "who";
  const t = e.querySelector(".who-t");
  if (!st.connected) {
    t.innerHTML = "<b>Connect a wallet</b><small>We read your .ai Agent ID on BNB Chain to see if your first Stall is free.</small>";
    $("whoBtn").hidden = false;
    return;
  }
  $("whoBtn").hidden = true;
  if (n.checking) {
    e.classList.add("wait");
    t.innerHTML = `<b>${window.AMW.shortAddr(st.address)}</b><small>Reading the .ai Agent ID registry…</small>`;
    return;
  }
  if (n.agent === null) {
    t.innerHTML = `<b>${window.AMW.shortAddr(st.address)}</b><small>Couldn't read the Agent ID registry. Prices assume no Agent ID.</small>`;
    return;
  }
  if (n.agent) {
    e.classList.add("yes");
    t.innerHTML = `<b>${n.agentName || "Agent ID found"}</b><small>.ai Agent ID holder. Your first Stall is free.</small>`;
  } else {
    e.classList.add("no");
    t.innerHTML = `<b>${window.AMW.shortAddr(st.address)}</b><small>No .ai Agent ID, so your first Stall is 0.0003 BNB.</small>`;
  }
}
$("whoBtn").addEventListener("click", () => window.AMW.connect());

async function checkAgentId(address) {
  // Canonical registry read: balanceOf + handleOf, like the reference.
  const bal = await ethCall(REGISTRY, SEL.balanceOf + padAddr(address)).then(asUint);
  if (bal === 0n) return { has: false, name: null };
  let name = null;
  try {
    const raw = await ethCall(REGISTRY, SEL.handleOf + padAddr(address));
    const s = window.AMW.asString(raw);
    if (s) name = s + ".ai";
  } catch {}
  return { has: true, name };
}

let lastAddr = null;
window.AMW.onWallet(async (st) => {
  if (st.address !== lastAddr) {
    lastAddr = st.address;
    n.agent = false; n.agentName = null; n.owned = 0;
    if (st.connected) {
      n.checking = true; renderWho();
      try {
        const r = await checkAgentId(st.address);
        if (lastAddr !== st.address) return;
        n.agent = r.has; n.agentName = r.name;
        if (r.has) flipCard(r.name);
      } catch { n.agent = null; }
      n.checking = false;
      await refreshOwned();
    }
  }
  renderWho();
  renderWidget();
});

// ---- Agent ID card + checker --------------------------------------------------
function flipCard(name) {
  const base = name ? name.replace(/\.ai$/i, "") : "yourname";
  if ($("aidName").textContent === base) return;
  const card = $("aidCard");
  card.classList.remove("flip");
  void card.offsetWidth;
  card.classList.add("flip");
  setTimeout(() => {
    set("aidName", base);
    set("aidHandle", base + ".ai");
  }, 380);
  card.addEventListener("animationend", () => card.classList.remove("flip"), { once: true });
}

$("agForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const addr = $("agInput").value.trim();
  const res = $("agRes");
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    res.className = "ag-res bad";
    res.textContent = "That is not a wallet address.";
    return;
  }
  res.className = "ag-res";
  res.textContent = "Reading the registry…";
  try {
    const r = await checkAgentId(addr);
    res.className = "ag-res " + (r.has ? "good" : "bad");
    res.textContent = r.has
      ? `${r.name || "Agent ID found"}. First Stall is free for this wallet.`
      : "No .ai Agent ID on this wallet. First Stall costs 0.0003 BNB.";
    if (r.has) flipCard(r.name);
  } catch {
    res.className = "ag-res bad";
    res.textContent = "Could not reach BNB Chain. Try again in a moment.";
  }
});

// ---- Mint on Agent modal -------------------------------------------------------
const ag = { qty: 1 };
function renderAgentModal() {
  const total = costLocal(0, ag.qty, true); // priced as an Agent ID wallet, like the reference
  set("agmQty", ag.qty);
  $("agmMinus").disabled = ag.qty <= 1;
  $("agmPlus").disabled = ag.qty >= MAXW;
  $("agmTotal").textContent = total === 0n ? "Free" : `${fmtBNB(total)} BNB`;
  $("agmPrompt").textContent =
`Mint ${ag.qty} Agent Market Stall NFT${ag.qty > 1 ? "s" : ""} for me on BNB Chain (chain ID 56).

Contract: ${STALL}
Function: mint(${ag.qty})
Wallet: my .ai Agent ID wallet

Pricing: my first Stall is free with my .ai Agent ID. Stalls 2 to 10 cost 0.0003 BNB each, 11 to 20 cost 0.0005 BNB, 21 to 25 cost 0.0007 BNB. Send exactly ${fmtBNB(total)} BNB as the value for ${ag.qty} Stall${ag.qty > 1 ? "s" : ""}.

Before signing, show me the transaction, the BNB total and the gas.`;
}
function openAgent() {
  ag.qty = n.qty || 1;
  renderAgentModal();
  const m = $("agm");
  m.hidden = false;
  requestAnimationFrame(() => m.classList.add("in"));
}
function closeAgent() {
  const m = $("agm");
  m.classList.remove("in");
  setTimeout(() => { m.hidden = true; }, 220);
}
$("agentBtn").addEventListener("click", openAgent);
$("agmX").addEventListener("click", closeAgent);
$("agm").addEventListener("click", (e) => { if (e.target === $("agm")) closeAgent(); });
addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("agm").hidden) closeAgent(); });
$("agmMinus").addEventListener("click", () => { ag.qty = Math.max(1, ag.qty - 1); renderAgentModal(); });
$("agmPlus").addEventListener("click", () => { ag.qty = Math.min(MAXW, ag.qty + 1); renderAgentModal(); });
$("agmCopy").addEventListener("click", async () => {
  const btn = $("agmCopy");
  try { await navigator.clipboard.writeText($("agmPrompt").textContent); }
  catch {
    const range = document.createRange();
    range.selectNodeContents($("agmPrompt"));
    const sel = getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    document.execCommand("copy");
    sel.removeAllRanges();
  }
  btn.textContent = "Copied";
  setTimeout(() => (btn.textContent = "Copy prompt"), 1600);
});

// ---- Copy buttons for static prompts ------------------------------------------
document.querySelectorAll(".copy-btn[data-copy]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const src = $(btn.dataset.copy);
    if (!src) return;
    try { await navigator.clipboard.writeText(src.textContent.trim()); btn.textContent = "Copied"; }
    catch { btn.textContent = "Select and copy"; }
    setTimeout(() => (btn.textContent = "Copy prompt"), 1800);
  });
});

// ---- Boot -----------------------------------------------------------------------
window.AMW.mountButton($("wallet-slot"));
renderWidget();
refreshBoard();
refreshClaims();
setInterval(() => { if (!document.hidden) { refreshBoard(); refreshOwned(); } }, 20000);
setInterval(() => { if (!document.hidden) refreshClaims(); }, 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshClaims(); });
window.addEventListener("focus", refreshClaims);
setInterval(tickCountdown, 1000);
