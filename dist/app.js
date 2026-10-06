const API_PLANS = {
  demo: { baseUrl: "https://api.coingecko.com/api/v3", header: "x-cg-demo-api-key", label: "Demo" },
  pro: { baseUrl: "https://pro-api.coingecko.com/api/v3", header: "x-cg-pro-api-key", label: "Pro / Analyst" }
};

const $ = (id) => document.getElementById(id);
const state = { report: null };
const DEFAULT_WALLET_SCAN_LIMIT = 12;
const pct = (n) => `${n >= 0 ? "+" : ""}${Number(n || 0).toFixed(2)}%`;
const clamp = (n, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));

function percentile(values, value) {
  if (values.length < 2) return 50;
  const sorted = [...values].sort((a, b) => a - b);
  const below = sorted.filter((v) => v < value).length;
  const equal = sorted.filter((v) => v === value).length;
  return ((below + Math.max(0, equal - 1) / 2) / (sorted.length - 1)) * 100;
}

async function cg(path, key, plan, params = {}) {
  const config = API_PLANS[plan];
  const url = new URL(`${config.baseUrl}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, { headers: { accept: "application/json", ...(key ? { [config.header]: key } : {}) }, signal: controller.signal });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 220);
      if (body.includes('"error_code":10010')) throw new Error("This is a Pro/Analyst key. Select Pro / Analyst and scan again.");
      if (body.includes('"error_code":10011')) throw new Error("This is a Demo key. Select Demo and scan again.");
      if (res.status === 401) throw new Error(`CoinGecko rejected the ${config.label} key. Check the key and selected plan.`);
      throw new Error(`CoinGecko returned ${res.status}${body ? `: ${body}` : ""}`);
    }
    return res.json();
  } finally { clearTimeout(timer); }
}

function classify(market, attention) {
  if (market >= 65 && attention >= 35) return { id: "confirmed", label: "Confirmed breakout", tone: "green" };
  if (market >= 65) return { id: "early", label: "Market leads attention", tone: "blue" };
  if (attention >= 35) return { id: "trap", label: "Attention trap", tone: "red" };
  return { id: "noedge", label: "No edge", tone: "muted" };
}

function sameAddress(a, b) {
  if (!a || !b) return false;
  return a === b || String(a).toLowerCase() === String(b).toLowerCase();
}

function chooseContract(platforms, networkMap) {
  const preferred = ["ethereum", "base", "solana", "arbitrum-one", "binance-smart-chain", "optimistic-ethereum", "polygon-pos", "sui", "the-open-network", "ronin"];
  const entries = Object.entries(platforms || {}).filter(([, address]) => address);
  const priority = (platform) => { const index = preferred.indexOf(platform); return index === -1 ? 999 : index; };
  const sorted = entries.sort(([a], [b]) => priority(a) - priority(b));
  for (const [platform, address] of sorted) {
    const network = networkMap.get(platform);
    if (network) return { platform, network, address };
  }
  return null;
}

function parseSmartMoney(topTradersPayload, tradesPayload, tokenAddress) {
  const traders = topTradersPayload?.data?.attributes?.traders || [];
  const qualified = new Map(traders.filter((t) => Number(t.realized_pnl_usd || 0) > 0 && Number(t.total_buy_count || 0) + Number(t.total_sell_count || 0) >= 5).map((t) => [String(t.address).toLowerCase(), t]));
  const trades = Array.isArray(tradesPayload?.data) ? tradesPayload.data : [];
  let buyUsd = 0, sellUsd = 0, buyCount = 0, sellCount = 0;
  const active = new Set();
  for (const row of trades) {
    const t = row.attributes || row;
    const wallet = String(t.tx_from_address || t.wallet_address || "").toLowerCase();
    if (!qualified.has(wallet)) continue;
    const usd = Number(t.volume_in_usd || t.volume_usd || 0);
    if (!Number.isFinite(usd) || usd <= 0) continue;
    if (sameAddress(t.to_token_address, tokenAddress)) { buyUsd += usd; buyCount += 1; active.add(wallet); }
    else if (sameAddress(t.from_token_address, tokenAddress)) { sellUsd += usd; sellCount += 1; active.add(wallet); }
  }
  const gross = buyUsd + sellUsd;
  const netFlow = buyUsd - sellUsd;
  const imbalance = gross ? netFlow / gross : 0;
  const score = clamp(50 + imbalance * 40 + Math.min(active.size, 5) * 2);
  const label = gross === 0 ? "No recent overlap" : score >= 62 ? "Smart accumulation" : score <= 38 ? "Smart distribution" : "Mixed smart flow";
  const confidence = active.size >= 3 && gross >= 50_000 ? "High" : active.size >= 1 && gross >= 10_000 ? "Medium" : "Low";
  return { score, label, confidence, netFlow, buyUsd, sellUsd, buyCount, sellCount, activeWallets: active.size, qualifiedWallets: qualified.size, sampledTrades: trades.length };
}

async function mapContracts(key) {
  const [coinList, networksPayload] = await Promise.all([
    cg("/coins/list", key, "pro", { include_platform: true }),
    cg("/onchain/networks", key, "pro")
  ]);
  const networkMap = new Map([
    ["ethereum", "eth"], ["base", "base"], ["solana", "solana"], ["arbitrum-one", "arbitrum"],
    ["binance-smart-chain", "bsc"], ["optimistic-ethereum", "optimism"], ["polygon-pos", "polygon_pos"],
    ["sui", "sui-network"], ["the-open-network", "ton"], ["ronin", "ronin"]
  ]);
  for (const n of networksPayload.data || []) networkMap.set(n.attributes?.coingecko_asset_platform_id, n.id);
  const contracts = new Map();
  for (const coin of coinList) {
    const contract = chooseContract(coin.platforms, networkMap);
    if (contract) contracts.set(coin.id, contract);
  }
  return contracts;
}

async function enrichOneCoin(coin, contract, key) {
  try {
    const base = `/onchain/networks/${encodeURIComponent(contract.network)}/tokens/${encodeURIComponent(contract.address)}`;
    const [topTraders, trades] = await Promise.all([
      cg(`${base}/top_traders`, key, "pro"),
      cg(`${base}/trades`, key, "pro", { trading_period: "1d", per_page: 300 })
    ]);
    return { ...coin, contract, smart: parseSmartMoney(topTraders, trades, contract.address) };
  } catch (error) {
    return { ...coin, contract, smartError: error.message };
  }
}

async function enrichSmartMoney(coins, key, onProgress, limit = DEFAULT_WALLET_SCAN_LIMIT) {
  const contracts = await mapContracts(key);
  const eligible = coins.filter((c) => c.signal.id !== "noedge" && contracts.has(c.id));
  const candidates = eligible.slice(0, limit === "all" ? eligible.length : Number(limit));
  const enriched = [];
  for (let i = 0; i < candidates.length; i += 3) {
    const batch = candidates.slice(i, i + 3);
    const rows = await Promise.all(batch.map((coin) => enrichOneCoin(coin, contracts.get(coin.id), key)));
    enriched.push(...rows);
    onProgress(Math.min(candidates.length, i + batch.length), candidates.length);
  }
  const byId = new Map(enriched.map((c) => [c.id, c]));
  return coins.map((c) => byId.get(c.id) || c);
}

function scoreCoins(coins, trending) {
  const trendRank = new Map((trending.coins || []).map((x, i) => [x.item.id, i]));
  const stableSymbols = new Set(["usdt", "usdc", "dai", "usde", "usds", "fdusd", "usdf", "tusd", "pyusd", "usdd", "frax", "susds"]);
  const universe = coins.filter((c) => c.market_cap >= 100_000_000 && c.total_volume >= 10_000_000 && !stableSymbols.has(c.symbol.toLowerCase()) && Number.isFinite(c.price_change_percentage_24h) && Number.isFinite(c.price_change_percentage_7d_in_currency));
  const momentum = universe.map((c) => c.price_change_percentage_24h);
  const turnover = universe.map((c) => c.total_volume / c.market_cap);
  const acceleration = universe.map((c) => c.price_change_percentage_24h - c.price_change_percentage_7d_in_currency / 7);

  return universe.map((c) => {
    const turn = c.total_volume / c.market_cap;
    const accel = c.price_change_percentage_24h - c.price_change_percentage_7d_in_currency / 7;
    const market = clamp(percentile(momentum, c.price_change_percentage_24h) * .45 + percentile(turnover, turn) * .35 + percentile(acceleration, accel) * .20);
    const rank = trendRank.get(c.id);
    const attention = rank == null ? 0 : clamp(100 - rank * 9);
    return { id: c.id, name: c.name, symbol: c.symbol.toUpperCase(), image: c.image, price: c.current_price, marketCap: c.market_cap, volume: c.total_volume, change24h: c.price_change_percentage_24h, change7d: c.price_change_percentage_7d_in_currency, turnover: turn, acceleration: accel, market, attention, trendRank: rank == null ? null : rank + 1, signal: classify(market, attention) };
  }).sort((a, b) => b.market - a.market);
}

function coinChip(c) { return `<div class="coin-chip"><img src="${c.image}" alt=""><span>${c.symbol}</span></div>`; }

function opinion(c) {
  if (c.signal.id === "early") return "Money is moving before discovery catches up. This is the gap I research first—not a blind buy.";
  if (c.signal.id === "confirmed") return "Price, liquidity and discovery agree. Strong trend, but the easy entry may already be gone.";
  if (c.signal.id === "trap") return "High discovery, weak market confirmation. Attention is not the same thing as demand.";
  return "No meaningful attention-market mismatch right now.";
}

function callCard(c, index) {
  const smart = c.smart ? `<div class="smart-strip ${c.smart.score >= 62 ? "accum" : c.smart.score <= 38 ? "distrib" : "mixed"}"><div><span>SMART MONEY · 24H</span><strong>${c.smart.label}</strong></div><div class="smart-stats"><b>${money(c.smart.netFlow)}</b><span>${c.smart.activeWallets} active profitable wallets · ${c.smart.confidence} confidence</span></div></div>` : c.contract ? `<div class="smart-strip unavailable"><span>SMART MONEY</span><strong>${c.smartError ? "Wallet data unavailable" : "No recent wallet overlap"}</strong></div>` : `<div class="smart-strip unavailable"><span>SMART MONEY</span><strong>No supported onchain contract</strong></div>`;
  return `<article class="call ${c.signal.tone}"><div class="call-top"><span class="call-rank">0${index + 1}</span><span class="signal-label">${c.signal.label}</span></div><div class="coin-title">${coinChip(c)}<strong>${c.name}</strong></div><div class="call-metrics"><span><b class="${c.change24h >= 0 ? "up" : "down"}">${pct(c.change24h)}</b>24H</span><span><b>${(c.turnover * 100).toFixed(1)}%</b>turnover</span><span><b>${c.attention}</b>attention</span></div>${smart}<p>${opinion(c)}</p></article>`;
}

function smartRow(c) {
  if (c.smart) {
    const flowClass = c.smart.score >= 62 ? "up" : c.smart.score <= 38 ? "down" : "";
    return `<div class="wallet-row"><div>${coinChip(c)}<span>${c.signal.label}</span></div><div><b class="${flowClass}">${c.smart.label}</b><span>${money(c.smart.netFlow)}</span></div><div><b>${c.smart.activeWallets}</b><span>active / ${c.smart.qualifiedWallets} qualified</span></div><div><b>${c.smart.buyCount} / ${c.smart.sellCount}</b><span>buys / sells</span></div><div><b>${c.smart.confidence}</b><span>confidence</span></div></div>`;
  }
  return `<div class="wallet-row unavailable"><div>${coinChip(c)}<span>${c.signal.label}</span></div><div><b>Unavailable</b><span>${c.smartError || "No recent wallet overlap"}</span></div></div>`;
}

function money(n) {
  const sign = n >= 0 ? "+" : "−";
  const v = Math.abs(Number(n || 0));
  if (v >= 1_000_000) return `${sign}$${(v / 1_000_000).toFixed(2)}M net`;
  if (v >= 1_000) return `${sign}$${(v / 1_000).toFixed(1)}K net`;
  return `${sign}$${v.toFixed(0)} net`;
}

function renderMap(coins) {
  const selected = [...coins.slice(0, 18), ...coins.filter((c) => c.attention > 0)].filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i);
  $("mapDots").innerHTML = selected.map((c) => `<button class="dot ${c.signal.tone}" style="left:${clamp(c.market, 3, 97)}%;bottom:${clamp(c.attention, 4, 94)}%" title="${c.symbol}: market ${c.market.toFixed(0)}, attention ${c.attention}"><img src="${c.image}" alt="${c.name}"><span>${c.symbol}</span></button>`).join("");
}

function render(report) {
  state.report = report;
  const early = report.coins.filter((c) => c.signal.id === "early").slice(0, 3);
  const confirmed = report.coins.filter((c) => c.signal.id === "confirmed").slice(0, 3);
  const traps = report.coins.filter((c) => c.signal.id === "trap").sort((a, b) => b.attention - a.attention).slice(0, 3);
  const calls = [...early.slice(0, 2), ...confirmed.slice(0, 2), ...traps.slice(0, 2)].slice(0, 6);
  $("emptyState").hidden = true; $("results").hidden = false; $("copyButton").disabled = false;
  $("universeCount").textContent = report.universeCount;
  $("earlyCount").textContent = report.coins.filter((c) => c.signal.id === "early").length;
  $("confirmedCount").textContent = report.coins.filter((c) => c.signal.id === "confirmed").length;
  $("trapCount").textContent = report.coins.filter((c) => c.signal.id === "trap").length;
  const smartRows = report.coins.filter((c) => c.smart && c.smart.activeWallets > 0);
  $("smartCount").textContent = smartRows.length || "—";
  $("smartLead").textContent = smartRows.sort((a, b) => b.smart.score - a.smart.score)[0]?.symbol || "—";
  $("calls").innerHTML = calls.length ? calls.map(callCard).join("") : '<p class="no-calls">No strong dislocation cleared the filter in this scan.</p>';
  const walletRows = report.coins.filter((c) => c.contract);
  $("walletBoard").innerHTML = walletRows.length ? walletRows.map(smartRow).join("") : '<p class="no-calls">Wallet intelligence requires a Pro / Analyst key and a supported token contract.</p>';
  renderMap(report.coins);
  const lead = early[0] || confirmed[0] || report.coins[0];
  const trap = traps[0];
  $("verdict").innerHTML = lead ? `<strong>${lead.symbol} is today’s highest-conviction research lead.</strong> ${opinion(lead)}${trap ? ` Meanwhile, ${trap.symbol} looks like the cleanest attention trap.` : ""}` : "No actionable gap found.";
  $("timestamp").textContent = `${new Date(report.generatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} · ${report.authenticated ? API_PLANS[report.plan].label : "Public"} data`;
}

async function run() {
  const key = $("apiKey").value.trim(); const plan = $("apiPlan").value;
  if (plan === "pro" && !key) return showError("Enter your Pro/Analyst key, or select Demo for public mode.");
  const button = $("runButton"); button.disabled = true; button.textContent = "Scanning 250 assets…";
  $("errorBox").hidden = true; $("apiStatus").className = "status"; $("apiStatus").innerHTML = "<span></span> Pulling live market data";
  try {
    const params = { vs_currency: "usd", order: "market_cap_desc", per_page: 250, page: 1, sparkline: false, price_change_percentage: "1h,24h,7d" };
    const [coins, trending] = await Promise.all([cg("/coins/markets", key, plan, params), cg("/search/trending", key, plan, plan === "pro" ? { show_max: "coins" } : {})]);
    let scored = scoreCoins(coins, trending);
    if (scored.length < 50) throw new Error("CoinGecko returned too few liquid assets for a reliable scan.");
    if (plan === "pro" && key) {
      button.textContent = "Mapping onchain contracts…";
      const walletDepth = $("walletDepth").value === "all" ? "all" : Number($("walletDepth").value);
      scored = await enrichSmartMoney(scored, key, (done, total) => { button.textContent = `Reading wallets ${done}/${total}…`; }, walletDepth);
    }
    render({ generatedAt: new Date().toISOString(), plan, authenticated: Boolean(key), universeCount: scored.length, coins: scored });
    $("apiStatus").className = "status live"; $("apiStatus").innerHTML = `<span></span> Live · ${key ? API_PLANS[plan].label : "public"}`;
  } catch (error) { showError(error.name === "AbortError" ? "CoinGecko timed out. Wait a moment and try again." : error.message); }
  finally { button.disabled = false; button.textContent = "Run market + wallet scan"; }
}

function showError(message) { $("apiStatus").className = "status error"; $("apiStatus").innerHTML = "<span></span> Scan failed"; $("errorBox").hidden = false; $("errorBox").textContent = message; }

function shareText() {
  const coins = state.report?.coins || [];
  const early = coins.filter((c) => c.signal.id === "early").slice(0, 3);
  const confirmed = coins.filter((c) => c.signal.id === "confirmed").slice(0, 3);
  const traps = coins.filter((c) => c.signal.id === "trap").sort((a, b) => b.attention - a.attention).slice(0, 3);
  const smart = coins.filter((c) => c.smart && c.smart.activeWallets > 0).sort((a, b) => b.smart.score - a.smart.score).slice(0, 3);
  return `Most dashboards tell me what is pumping. Mine checks whether attention, market activity and profitable wallets agree.\n\nMARKET > ATTENTION: ${early.map((c) => `$${c.symbol}`).join(", ") || "none"}\nCONFIRMED: ${confirmed.map((c) => `$${c.symbol}`).join(", ") || "none"}\nATTENTION TRAPS: ${traps.map((c) => `$${c.symbol}`).join(", ") || "none"}\nSMART WALLET LEADS: ${smart.map((c) => `$${c.symbol} ${money(c.smart.netFlow)}`).join(", ") || "none"}\n\nBuilt with CoinGecko API data.`;
}

if (typeof document !== "undefined") {
  $("runButton").addEventListener("click", run);
  $("apiPlan").addEventListener("change", () => { const plan = $("apiPlan").value; $("keyHelp").textContent = `Sent only to ${new URL(API_PLANS[plan].baseUrl).host}. Never stored.`; $("errorBox").hidden = true; });
  $("toggleKey").addEventListener("click", () => { const input = $("apiKey"); const show = input.type === "password"; input.type = show ? "text" : "password"; $("toggleKey").textContent = show ? "Hide" : "Show"; });
  $("copyButton").addEventListener("click", async () => { await navigator.clipboard.writeText(shareText()); $("copyButton").textContent = "Copied"; setTimeout(() => $("copyButton").textContent = "Copy share summary", 1400); });
}

export { classify, parseSmartMoney, scoreCoins };
