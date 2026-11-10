// Agent Market swap: PancakeSwap V2 router, quotes read live through AMW's
// raced public RPC. BNB and USDT trade now; $AMKT unlocks by itself the
// moment the factory reports an AMKT/WBNB pair (pool created after presale).
(function () {
  const { ethCall, ethBalance, padAddr, u256, asUint, parseUnits, fmt, toast, friendlyError } = window.AMW;

  const ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
  const FACTORY = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73";
  const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
  const ZERO = "0x0000000000000000000000000000000000000000";
  const TOKENS = {
    BNB: { sym: "BNB", name: "BNB Chain", addr: null, img: "img/bnb.png" },
    USDT: { sym: "USDT", name: "Tether USD", addr: "0x55d398326f99059fF775485246999027B3197955", img: "img/usdt.png" },
    AMKT: { sym: "AMKT", name: "Agent Market", addr: "0x31BBB7A5614D0eD465a93d1BAFCE28CE0225cDDe", img: "img/amkt.png" },
  };
  const SEL = {
    balanceOf: "0x70a08231", allowance: "0xdd62ed3e", approve: "0x095ea7b3",
    getPair: "0xe6a43905", getAmountsOut: "0xd06ca61f",
    getReserves: "0x0902f1ac", token0: "0x0dfe1681",
    swapEth: "0xb6f9de95", swapToEth: "0x791ac947", swapTok: "0x5c11d795",
  };

  const $ = (id) => document.getElementById(id);
  const s = {
    in: "BNB", out: "USDT", slip: 100, pool: false,
    quote: null, impact: null, balIn: null, balOut: null, busy: "",
  };
  let quoteSeq = 0;

  const addrOf = (sym) => (sym === "BNB" ? WBNB : TOKENS[sym].addr);
  const involvesAmkt = () => s.in === "AMKT" || s.out === "AMKT";
  const poolBlocked = () => involvesAmkt() && !s.pool;

  function buildPath() {
    const a = addrOf(s.in), b = addrOf(s.out);
    return a === WBNB || b === WBNB ? [a, b] : [a, WBNB, b];
  }

  function fmtAmt(w) {
    w = BigInt(w);
    if (w === 0n) return "0";
    const whole = w / 10n ** 18n;
    let frac = (w % 10n ** 18n).toString().padStart(18, "0");
    frac = (whole > 0n ? frac.slice(0, 4) : frac.slice(0, 6)).replace(/0+$/, "");
    return fmt(whole.toString()) + (frac ? "." + frac : "");
  }
  // Plain decimal string of a wei amount, for filling the input on flip/max.
  function toDecimal(w) {
    w = BigInt(w);
    const whole = w / 10n ** 18n;
    const frac = (w % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
    return frac ? `${whole}.${frac}` : `${whole}`;
  }

  function amountIn() {
    const v = $("swIn").value.trim();
    if (!v) return null;
    try {
      const a = parseUnits(v, 18);
      return a > 0n ? a : null;
    } catch { return null; }
  }

  // ---- On-chain reads -----------------------------------------------------
  async function getAmounts(amount, path) {
    const data = SEL.getAmountsOut + u256(amount) + u256(64) + u256(path.length) + path.map(padAddr).join("");
    const hex = (await ethCall(ROUTER, data)).replace(/^0x/, "");
    const len = Number(BigInt("0x" + hex.slice(64, 128)));
    const out = [];
    for (let i = 0; i < len; i++) out.push(BigInt("0x" + hex.slice(128 + i * 64, 192 + i * 64)));
    return out;
  }

  async function checkPool() {
    try {
      const pair = await ethCall(FACTORY, SEL.getPair + padAddr(TOKENS.AMKT.addr) + padAddr(WBNB));
      s.pool = ("0x" + pair.slice(-40)).toLowerCase() !== ZERO;
    } catch { /* keep last state */ }
    render();
  }

  async function hopImpact(amount, path, quoteOut) {
    // Compare the real quote with the spot-price output, hop by hop.
    try {
      let spot = amount;
      for (let i = 0; i + 1 < path.length; i++) {
        const pair = "0x" + (await ethCall(FACTORY, SEL.getPair + padAddr(path[i]) + padAddr(path[i + 1]))).slice(-40);
        if (pair.toLowerCase() === ZERO) return null;
        const t0 = "0x" + (await ethCall(pair, SEL.token0)).slice(-40);
        const res = (await ethCall(pair, SEL.getReserves)).replace(/^0x/, "");
        const r0 = BigInt("0x" + res.slice(0, 64));
        const r1 = BigInt("0x" + res.slice(64, 128));
        const [rIn, rOut] = t0.toLowerCase() === path[i].toLowerCase() ? [r0, r1] : [r1, r0];
        if (rIn === 0n || rOut === 0n) return null;
        spot = (spot * rOut) / rIn;
      }
      if (spot <= 0n || quoteOut >= spot) return 0;
      return Number(((spot - quoteOut) * 10000n) / spot) / 100;
    } catch { return null; }
  }

  async function refreshBalances() {
    const st = window.AMW.state;
    if (!st.address) { s.balIn = null; s.balOut = null; renderMeta(); return; }
    const read = async (sym) => {
      try {
        if (sym === "BNB") return BigInt(await ethBalance(st.address));
        return await ethCall(TOKENS[sym].addr, SEL.balanceOf + padAddr(st.address)).then(asUint);
      } catch { return null; }
    };
    [s.balIn, s.balOut] = await Promise.all([read(s.in), read(s.out)]);
    renderMeta();
  }

  // ---- Quote ----------------------------------------------------------------
  async function refreshQuote() {
    const seq = ++quoteSeq;
    const amt = amountIn();
    if (!amt || poolBlocked()) {
      s.quote = null; s.impact = null;
      if (!poolBlocked()) $("swOut").textContent = "0.0";
      renderMeta();
      return;
    }
    try {
      const amounts = await getAmounts(amt, buildPath());
      if (seq !== quoteSeq) return;
      s.quote = { forAmt: amt, out: amounts[amounts.length - 1] };
      $("swOut").textContent = fmtAmt(s.quote.out);
      renderMeta();
      s.impact = await hopImpact(amt, buildPath(), s.quote.out);
      if (seq !== quoteSeq) return;
    } catch {
      if (seq !== quoteSeq) return;
      s.quote = null; s.impact = null;
      $("swOut").textContent = "···";
    }
    renderMeta();
  }
  let deb = null;
  const quoteSoon = () => { clearTimeout(deb); deb = setTimeout(refreshQuote, 350); };

  // ---- Rendering --------------------------------------------------------------
  function coinHTML(sym) {
    const t = TOKENS[sym];
    return `<img class="tok-ic-img" src="${t.img}" alt="">${t.sym}<span class="car">▾</span>`;
  }
  function menuHTML(menu, current) {
    menu.innerHTML = Object.keys(TOKENS).map((sym) => {
      const t = TOKENS[sym];
      const pool = sym === "AMKT"
        ? `<span class="tok-pool${s.pool ? " live" : ""}">${s.pool ? "Pool live" : "Pool soon"}</span>`
        : "";
      return `<button type="button" class="tok-opt" data-sym="${sym}" aria-selected="${sym === current}"><img class="tok-ic-img" src="${t.img}" alt=""><span class="tok-nm">${t.sym}<small>${t.name}</small></span>${pool}</button>`;
    }).join("");
    menu.querySelectorAll(".tok-opt").forEach((b) =>
      b.addEventListener("click", () => { pickToken(menu === $("swMenuIn") ? "in" : "out", b.dataset.sym); closeMenus(); })
    );
  }
  function renderTokens() {
    $("swTokIn").innerHTML = coinHTML(s.in);
    $("swTokOut").innerHTML = coinHTML(s.out);
    menuHTML($("swMenuIn"), s.in);
    menuHTML($("swMenuOut"), s.out);
  }

  function renderMeta() {
    $("swBalIn").textContent = s.balIn === null ? "···" : fmtAmt(s.balIn);
    $("swBalOut").textContent = s.balOut === null ? "···" : fmtAmt(s.balOut);
    $("swPoolNote").hidden = !poolBlocked();
    const amt = amountIn();
    const hasQuote = !!(s.quote && amt && s.quote.forAmt === amt);
    $("swMeta").hidden = !hasQuote;
    if (hasQuote) {
      const q = s.quote;
      const rate = Number(q.out) / Number(q.forAmt);
      $("swRate").innerHTML = `1 ${s.in} ≈ <b>${fmtAmt(q.out * 10n ** 18n / q.forAmt)} ${s.out}</b>`;
      const min = (q.out * BigInt(10000 - s.slip)) / 10000n;
      $("swMin").textContent = `${fmtAmt(min)} ${s.out}`;
      const im = $("swImpact");
      im.textContent = s.impact === null ? "···" : s.impact.toFixed(2) + "%";
      im.classList.toggle("warn", s.impact !== null && s.impact > 5);
    }
    renderBtn();
  }

  function renderBtn() {
    const b = $("swBtn");
    const st = window.AMW.state;
    const amt = amountIn();
    const set = (label, disabled, act) => { b.textContent = label; b.disabled = !!disabled; b.dataset.act = act || ""; };
    if (s.busy === "approve") return set("Approving…", true);
    if (s.busy === "swap") return set("Swapping…", true);
    if (poolBlocked()) return set("Pool not open yet", true);
    if (!st.connected) return set("Connect wallet", false, "connect");
    if (st.chainId !== 56) return set("Switch to BNB Chain", false, "switch");
    if (!amt) return set("Enter an amount", true);
    if (s.quote && s.quote.forAmt === amt && s.quote.out === 0n) return set("No liquidity for this pair", true);
    if (s.balIn !== null && amt > s.balIn) return set(`Insufficient ${s.in} balance`, true);
    return set(`Swap ${s.in} for ${s.out}`, false, "swap");
  }

  function render() { renderTokens(); renderMeta(); }

  // ---- Token picking ----------------------------------------------------------
  function pickToken(side, sym) {
    if (side === "in") {
      if (sym === s.out) s.out = s.in;
      s.in = sym;
    } else {
      if (sym === s.in) s.in = s.out;
      s.out = sym;
    }
    s.quote = null; s.impact = null;
    $("swOut").textContent = "0.0";
    render();
    refreshBalances();
    refreshQuote();
  }
  function closeMenus() {
    $("swMenuIn").hidden = true;
    $("swMenuOut").hidden = true;
    $("swTokIn").setAttribute("aria-expanded", "false");
    $("swTokOut").setAttribute("aria-expanded", "false");
  }
  function toggleMenu(which) {
    const menu = which === "in" ? $("swMenuIn") : $("swMenuOut");
    const btn = which === "in" ? $("swTokIn") : $("swTokOut");
    const willOpen = menu.hidden;
    closeMenus();
    if (willOpen) { menu.hidden = false; btn.setAttribute("aria-expanded", "true"); }
  }
  $("swTokIn").addEventListener("click", (e) => { e.stopPropagation(); toggleMenu("in"); });
  $("swTokOut").addEventListener("click", (e) => { e.stopPropagation(); toggleMenu("out"); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".tok-wrap")) closeMenus(); });

  $("swFlip").addEventListener("click", () => {
    [s.in, s.out] = [s.out, s.in];
    if (s.quote) $("swIn").value = toDecimal(s.quote.out);
    s.quote = null; s.impact = null;
    $("swOut").textContent = "0.0";
    render();
    refreshBalances();
    refreshQuote();
  });

  $("swMax").addEventListener("click", () => {
    if (s.balIn === null) return;
    let v = s.balIn;
    if (s.in === "BNB") { const keep = 10n ** 15n; v = v > keep ? v - keep : 0n; }
    $("swIn").value = toDecimal(v);
    quoteSoon();
    renderMeta();
  });

  $("swIn").addEventListener("input", () => {
    const el = $("swIn");
    const clean = el.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
    if (clean !== el.value) el.value = clean;
    quoteSoon();
    renderMeta();
  });

  $("swSlip").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      s.slip = Number(b.dataset.slip);
      $("swSlip").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
      renderMeta();
    })
  );

  // ---- Execution ----------------------------------------------------------------
  function swapData(sel, amtIn, minOut, path, to, deadline) {
    const tail = u256(deadline) + u256(path.length) + path.map(padAddr).join("");
    if (sel === SEL.swapEth) return sel + u256(minOut) + u256(128) + padAddr(to) + tail;
    return sel + u256(amtIn) + u256(minOut) + u256(160) + padAddr(to) + tail;
  }

  function swapError(e) {
    const n = String((e && (e.shortMessage || e.reason || e.message)) || e || "");
    if (/INSUFFICIENT_OUTPUT_AMOUNT|Too little received/i.test(n)) return "Price moved past your slippage. Raise the slippage or try again.";
    if (/TRANSFER_FAILED|transfer amount exceeds/i.test(n)) return "The token transfer failed. Check your balance and try again.";
    return friendlyError(e);
  }

  async function doSwap() {
    const st = window.AMW.state;
    const amt = amountIn();
    if (!amt || poolBlocked()) return;
    const path = buildPath();
    try {
      const amounts = await getAmounts(amt, path);
      const out = amounts[amounts.length - 1];
      if (out === 0n) { toast("No liquidity for this pair."); return; }
      const minOut = (out * BigInt(10000 - s.slip)) / 10000n;
      const deadline = Math.floor(Date.now() / 1000) + 1200;
      const inTok = TOKENS[s.in];
      if (inTok.addr) {
        const allow = await ethCall(inTok.addr, SEL.allowance + padAddr(st.address) + padAddr(ROUTER)).then(asUint);
        if (allow < amt) {
          s.busy = "approve"; renderBtn();
          await window.AMW.sendTx({ to: inTok.addr, data: SEL.approve + padAddr(ROUTER) + u256(amt), value: 0n });
        }
      }
      s.busy = "swap"; renderBtn();
      let data, value = 0n;
      if (s.in === "BNB") { data = swapData(SEL.swapEth, 0n, minOut, path, st.address, deadline); value = amt; }
      else if (s.out === "BNB") { data = swapData(SEL.swapToEth, amt, minOut, path, st.address, deadline); }
      else { data = swapData(SEL.swapTok, amt, minOut, path, st.address, deadline); }
      const hash = await window.AMW.sendTx({ to: ROUTER, data, value });
      toast(`Swapped ${s.in} for ${s.out}.`);
      const line = $("swTx");
      line.hidden = false;
      line.innerHTML = `Transaction: <a href="https://bscscan.com/tx/${hash}" target="_blank" rel="noopener">${hash}</a>`;
      s.busy = "";
      $("swIn").value = "";
      s.quote = null; s.impact = null;
      $("swOut").textContent = "0.0";
      renderMeta();
      refreshBalances();
    } catch (e) {
      s.busy = "";
      renderBtn();
      toast(swapError(e));
    }
  }

  $("swBtn").addEventListener("click", async () => {
    const act = $("swBtn").dataset.act;
    if (act === "connect") return window.AMW.connect();
    if (act === "switch") {
      try { await window.AMW.ensureBsc(); } catch { toast("Switch to BNB Chain in your wallet."); }
      return;
    }
    if (act === "swap") return doSwap();
  });

  let lastAddr = null;
  window.AMW.onWallet((st) => {
    if (st.address !== lastAddr) { lastAddr = st.address; refreshBalances(); }
    renderBtn();
  });

  // ---- Boot ---------------------------------------------------------------------
  render();
  checkPool();
  refreshQuote();
  setInterval(() => { if (!document.hidden) checkPool(); }, 30000);
  setInterval(() => { if (!document.hidden && amountIn()) refreshQuote(); }, 20000);

  // Exposed for the parity test suite (payload inspection only).
  window.__swap = { state: s, buildPath, swapData, getAmounts, TOKENS, ROUTER };
})();
