# BSC Swap Bot

## Quick Start

```bash
npm install
npx ts-node src/index.ts swap <TOKEN_ADDRESS> --amount 0.01
```

## Architecture

**Swap через pair напрямую** — без router mapping. Контракт `UniversalSwap.sol` принимает `pairAddress` из Dexscreener.

```
src/
├── index.ts          # CLI (commander)
├── dexscreener.ts    # API client
├── swap.ts           # Вызов контракта
├── config.ts
├── logger.ts
└── types.ts

contracts/
└── UniversalSwap.sol # V2 + V3
```

## Dexscreener Filtering

**ВАЖНО:** Фильтруем по `chainId` + `labels`, НЕ по `dexId`:

```typescript
pairs
  .filter(p => p.chainId === "bsc")
  .filter(p => p.labels?.some(l => ["v2", "v3"].includes(l)))
  .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0]
```

- `labels: ["v2"]` — Uniswap V2 форк (любой DEX)
- `labels: ["v3"]` — Uniswap V3 форк (любой DEX)

## Контракты BSC

```
WBNB: 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c
```

## UniversalSwap.sol Interface

```solidity
// V2 — pair.swap() напрямую
function swapV2(address pair, address tokenIn, uint256 amountIn, uint256 amountOutMin, address recipient)

// V3 — pool.swap() напрямую
function swapV3(address pool, address tokenIn, uint256 amountIn, uint256 amountOutMin, address recipient)
```

## MEV Protection

- Slippage: CLI `--slippage` → .env `SLIPPAGE` → default `1%`
- Gas: +10-20% от base fee
- Опция: `RPC_URL=https://rpc.48.club` (MEV-protected)

## Gotchas

1. **НЕ фильтровать по dexId** — разные DEX'ы (biswap, apeswap, thena) используют одинаковые V2/V3 интерфейсы
2. **Router mapping не нужен** — свопаем через pair/pool напрямую
3. **Fee в V2 = 0.3%** — захардкожен в `getAmountOut`: `amountIn * 997 / 1000`

## Reference Repos

- V2 swap: https://github.com/codeesura/Arbitrage-uniswap-sushiswap
- V3 swap: https://github.com/Uniswap/v3-periphery
- Dexscreener types: https://github.com/hedgey-finance/dexscreener-api

## Plan

Полный план: `docs/init_plan.md`
