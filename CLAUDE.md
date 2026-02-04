# BSC Swap Bot

## Quick Start

```bash
npm install
npx ts-node src/index.ts swap <TOKEN_ADDRESS> --amount 0.01
```

## Architecture

**Swap через official routers** — поддержка Legacy (V2 Router + V3 SwapRouter) и Universal Router.

### Universal Router (рекомендуется)

Enable via `USE_UNIVERSAL_ROUTER=true` in .env.

```
PancakeSwap Universal Router: 0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB
Uniswap Universal Router:     0x5dc88340e1c5c6366864ee415d6034cadd1a9897
```

Router selection by `dexId`:
- `uniswap*` → Uniswap Universal Router
- `pancakeswap*` (default) → PancakeSwap Universal Router

### Legacy Routers

When `USE_UNIVERSAL_ROUTER=false` (default):
- V2: PancakeSwap V2 Router (0x10ED43C718714eb63d5aA57B78B54704E256024E)
- V3: PancakeSwap V3 SwapRouter (0x1b81D678ffb9C0263b24A97847620C99d213eB14)

```
src/
├── index.ts          # CLI (commander)
├── dexscreener.ts    # API client
├── swap.ts           # Вызов контракта
├── config.ts
├── logger.ts
└── types.ts

contracts/
└── UniversalSwap.sol # V2 + V3 (legacy, not used)
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
  - Precision: 2 decimal places (0.01-99.99%)
- Deadline: `DEADLINE_SECONDS` in .env, default 30 seconds
- Min liquidity: `MIN_LIQUIDITY_USD` in .env, default $1000
- Gas: +10-20% от base fee
- Universal Router: `USE_UNIVERSAL_ROUTER=true` in .env, default false
- Опция: `RPC_URL=https://rpc.48.club` (MEV-protected)

## Gotchas

1. **dexId используется для router selection** — `uniswap*` → Uniswap router, остальные → PancakeSwap
2. **Фильтруем по labels** — разные DEX'ы используют одинаковые V2/V3 интерфейсы
3. **Fee в V2 = 0.3%** — захардкожен в `getAmountOut`: `amountIn * 997 / 1000`
4. **Universal Router** — рекомендуется, поддерживает V2+V3 через один контракт

## Reference Repos

- V2 swap: https://github.com/codeesura/Arbitrage-uniswap-sushiswap
- V3 swap: https://github.com/Uniswap/v3-periphery
- Dexscreener types: https://github.com/hedgey-finance/dexscreener-api

## Plan

Полный план: `docs/init_plan.md`
