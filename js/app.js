// Agent Market live board: read-only chain reads raced across public BSC RPCs.
const RPCS = [
  "https://bsc-rpc.publicnode.com",
  "https://bsc-dataseed.bnbchain.org",
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.binance.org",
];
const STALL = "0xE3dE7fD0d12cFF4a46d8Bf702Ab593B6f921b308";
const PRESALE = "0xA6Ef01e926eFbD35661e7B1d3E1CBeE360750b16";
const MAX_SUPPLY = 12000n;

async function ethCall(to, data) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] });
  const tries = RPCS.map((url) =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(6000) })
      .then((r) => r.json())
      .then((j) => {
        if (!j.result || j.result === "0x") throw new Error("empty");
        return j.result;
      })
  );
  return Promise.any(tries);
}
const asUint = (hex) => BigInt(hex);
const asBool = (hex) => BigInt(hex) !== 0n;
const fmt = (n) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const fmtTok = (wei) => fmt(wei / 10n ** 18n);
const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

let endTimeSec = 0;
function tickCountdown() {
  if (!endTimeSec) return;
  const left = endTimeSec - Math.floor(Date.now() / 1000);
  if (left <= 0) { set("st-countdown", "Presale ended"); return; }
  const dd = Math.floor(left / 86400), hh = Math.floor((left % 86400) / 3600), mm = Math.floor((left % 3600) / 60), ss = left % 60;
  set("st-countdown", `${dd}d ${String(hh).padStart(2, "0")}h ${String(mm).padStart(2, "0")}m ${String(ss).padStart(2, "0")}s`);
}

async function refresh() {
  try {
    const [supply, open, start, end, sold] = await Promise.all([
      ethCall(STALL, "0x18160ddd").then(asUint),
      ethCall(STALL, "0x24bbd049").then(asBool),
      ethCall(PRESALE, "0x78e97925").then(asUint),
      ethCall(PRESALE, "0x3197cbb6").then(asUint),
      ethCall(PRESALE, "0x02c7e7af").then(asUint),
    ]);
    set("st-minted", fmt(supply));
    set("st-left", fmt(MAX_SUPPLY - supply));
    set("st-mint-status", open ? "OPEN" : "NOT OPEN YET");
    set("st-sold", fmtTok(sold));
    if (start === 0n) {
      set("st-presale", "NOT STARTED");
      set("st-countdown", "Starts on announcement");
    } else if (BigInt(Math.floor(Date.now() / 1000)) < end) {
      set("st-presale", "OPEN");
      endTimeSec = Number(end);
      tickCountdown();
    } else {
      set("st-presale", "ENDED");
      set("st-countdown", "Ended · claims open");
    }
  } catch (e) { /* keep placeholders, retry on interval */ }
}

document.querySelectorAll(".copy-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const src = document.getElementById(btn.dataset.copy);
    if (!src) return;
    try { await navigator.clipboard.writeText(src.textContent.trim()); btn.textContent = "Copied"; }
    catch (e) { btn.textContent = "Select and copy"; }
    setTimeout(() => (btn.textContent = "Copy prompt"), 1800);
  });
});

refresh();
setInterval(refresh, 30000);
setInterval(tickCountdown, 1000);
