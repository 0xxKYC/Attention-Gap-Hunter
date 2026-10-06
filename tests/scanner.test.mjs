import test from "node:test";
import assert from "node:assert/strict";
import { classify, parseSmartMoney, scoreCoins } from "../dist/app.js";

test("classifies market and attention gaps", () => {
  assert.equal(classify(75, 0).id, "early");
  assert.equal(classify(75, 70).id, "confirmed");
  assert.equal(classify(20, 70).id, "trap");
});

test("counts only active profitable wallets as smart flow", () => {
  const traders = { data: { attributes: { traders: [
    { address: "0xsmart", realized_pnl_usd: "12500", total_buy_count: 8, total_sell_count: 5 },
    { address: "0xloss", realized_pnl_usd: "-400", total_buy_count: 20, total_sell_count: 20 }
  ] } } };
  const trades = { data: [
    { attributes: { tx_from_address: "0xsmart", to_token_address: "0xtoken", from_token_address: "0xusd", volume_in_usd: "30000" } },
    { attributes: { tx_from_address: "0xsmart", to_token_address: "0xusd", from_token_address: "0xtoken", volume_in_usd: "5000" } },
    { attributes: { tx_from_address: "0xloss", to_token_address: "0xtoken", from_token_address: "0xusd", volume_in_usd: "90000" } }
  ] };
  const smart = parseSmartMoney(traders, trades, "0xtoken");
  assert.equal(smart.activeWallets, 1);
  assert.equal(smart.netFlow, 25000);
  assert.equal(smart.label, "Smart accumulation");
});

test("scores a liquid universe and excludes stablecoins", () => {
  const coins = [
    { id: "alpha", name: "Alpha", symbol: "alp", image: "", current_price: 1, market_cap: 200e6, total_volume: 40e6, price_change_percentage_24h: 8, price_change_percentage_7d_in_currency: 7 },
    { id: "beta", name: "Beta", symbol: "bet", image: "", current_price: 1, market_cap: 300e6, total_volume: 20e6, price_change_percentage_24h: -2, price_change_percentage_7d_in_currency: 0 },
    { id: "usd-coin", name: "USD Coin", symbol: "usdc", image: "", current_price: 1, market_cap: 50e9, total_volume: 5e9, price_change_percentage_24h: 0, price_change_percentage_7d_in_currency: 0 }
  ];
  const scored = scoreCoins(coins, { coins: [{ item: { id: "alpha" } }] });
  assert.equal(scored.length, 2);
  assert.equal(scored[0].id, "alpha");
  assert.equal(scored[0].attention, 100);
});
