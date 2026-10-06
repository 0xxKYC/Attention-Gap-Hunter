# Attention Gap

A zero-install crypto research scanner built on CoinGecko API data. It tests whether market momentum, discovery attention, and profitable-wallet activity agree for the same asset.

## Why it exists

Most dashboards rank what already moved. Attention Gap is designed for a more useful question:

> Is the market leading attention, is attention leading demand, and are historically profitable wallets confirming the move?

The browser scans 250 large liquid assets and classifies each one as:

- **Market leads attention** — market activity is strong before discovery catches up.
- **Confirmed breakout** — market activity and attention agree.
- **Attention trap** — discovery is high without enough market confirmation.
- **No edge** — neither side is strong enough to matter.

On Analyst plans, the strongest contract-backed signals receive a wallet overlay. Scan depth is configurable: top 12, top 25, or every actionable contract-backed asset.

- profitable wallets active in the last 24 hours;
- their sampled buy and sell volume;
- net smart-wallet flow;
- accumulation, distribution, or mixed-flow label;
- a confidence grade based on active-wallet count and sampled USD volume.

## Run it

No installation is required. Serve the `dist` folder from any static host, or open the deployed Site linked in the repository description.

For a local preview:

```bash
npm run serve
```

Then open `http://localhost:4173`.

The API key is entered at runtime, kept only in browser memory, and sent directly to the CoinGecko host selected in the UI. Never commit an API key.

## API plan support

- **Demo:** market and attention scan.
- **Pro / Analyst:** market scan plus token contracts, top traders, and 24-hour onchain trades.

Wallet enrichment requires Analyst or above.

## CoinGecko endpoints

- `GET /coins/markets`
- `GET /search/trending`
- `GET /coins/list?include_platform=true`
- `GET /onchain/networks`
- `GET /onchain/networks/{network}/tokens/{address}/top_traders`
- `GET /onchain/networks/{network}/tokens/{address}/trades?trading_period=1d`

## Scoring

Market confirmation is a cross-sectional percentile score:

- 24H momentum: 45%
- volume / market-cap turnover: 35%
- momentum acceleration versus the 7D daily average: 20%

Attention uses CoinGecko trending-search rank as a discovery proxy. It is not direct X data.

For wallet analysis, a wallet must have positive realized PnL and at least five historical buys plus sells in CoinGecko's Top Traders response. The scanner then intersects those qualified addresses with the token's sampled 24-hour onchain trades. A profitable history does not guarantee future performance.

## API-credit design

The market scan uses two calls. The wallet layer adds two mapping calls, then two calls per eligible candidate. The default cap is 12 to avoid wasting credits; users can choose 25 or all actionable contract-backed assets when they need exhaustive coverage.

## Tests

```bash
npm test
```

The tests cover signal classification, stablecoin filtering, and wallet-flow aggregation that excludes losing traders.

## Fork ideas

- Change the liquidity floor or percentile weights.
- Replace trending search with another attention source.
- Require more historical trades before a wallet qualifies.
- Persist daily snapshots and test whether smart-wallet flow improves next-day signal quality.
- Add chain filters or a custom token watchlist.

## Disclaimer

This is a research filter, not a CoinGecko product, financial advice, or a trading signal. “Smart money” is a transparent rule applied to CoinGecko wallet data—not a claim that a wallet is informed or will remain profitable.

## License

MIT
