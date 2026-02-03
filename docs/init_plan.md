# BSC Swap Bot — Implementation Plan

## Задача

CLI-бот на TypeScript который:
1. Принимает адрес токена
2. Через Dexscreener находит пулы на BSC
3. Выбирает пул с максимальной ликвидностью (V2/V3/V4)
4. Выполняет swap (покупка токена за BNB)

## Стек

- **TypeScript** + **ethers.js v6**
- **Solidity** — универсальный swap контракт
- **commander** — CLI
- **dotenv** — конфиг

## Структура проекта

```
src/
├── index.ts              # CLI entry point
├── dexscreener.ts        # Dexscreener API client
├── swap.ts               # Вызов контракта (один файл!)
├── config.ts             # Адреса контрактов
├── logger.ts             # Логирование
└── types.ts              # Типы

contracts/
└── UniversalSwap.sol     # Единый контракт V2/V3/V4
```

## Архитектура: Swap через Pair напрямую

**Без router mapping!** Контракт принимает `pairAddress` из Dexscreener и свопает напрямую.

```
Dexscreener API → pairAddress + labels
                         ↓
              UniversalSwap.sol
                    ↓
    ┌───────────────┼───────────────┐
    v2              v3              v4
 pair.swap()    pool.swap()    poolManager.swap()
```

## Контракты BSC Mainnet

```
WBNB: 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c

# Наш контракт (после деплоя)
UniversalSwap: 0x... (TBD)

# V4 PoolManager (для V4 свопов)
CLPoolManager: 0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b
```

> Router'ы не нужны — свопаем через pair/pool напрямую

## UniversalSwap.sol

```solidity
contract UniversalSwap {
    // ═══════════════════════════════════════════
    // V2 — работает с любым Uniswap V2 форком
    // ═══════════════════════════════════════════
    function swapV2(
        address pair,        // из Dexscreener
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient
    ) external returns (uint256 amountOut);

    // ═══════════════════════════════════════════
    // V3 — работает с любым Uniswap V3 форком
    // ═══════════════════════════════════════════
    function swapV3(
        address pool,        // из Dexscreener
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient
    ) external returns (uint256 amountOut);

    // ═══════════════════════════════════════════
    // V4 — draft, не тестировался
    // ═══════════════════════════════════════════
    function swapV4(
        PoolKey calldata poolKey,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient
    ) external returns (uint256 amountOut);
}
```

## Dexscreener API

**Endpoint:** `GET https://api.dexscreener.com/latest/dex/tokens/{tokenAddress}`

**Логика выбора пула:**

```typescript
pairs
  .filter(p => p.chainId === "bsc")
  .filter(p => p.labels?.some(l => ["v2", "v3"].includes(l)))
  .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))
  [0]
```

> **Note:** V4 пока не индексируется. Когда появится — добавить `"v4"` в фильтр.

## CLI Interface

```bash
npx ts-node src/index.ts swap <TOKEN_ADDRESS> --amount <BNB> [--slippage <percent>]
```

## Slippage Priority

1. `--slippage` CLI параметр
2. `SLIPPAGE` из .env
3. Default: `1%`

## MEV Protection

**Базовый (по умолчанию):**
- Slippage tolerance
- Gas price +10-20% от base fee
- Deadline 5 минут

**Опция: 48 Club RPC**
- `RPC_URL=https://rpc.48.club`
- Бесплатный MEV-protected RPC для BSC

## Логирование

```
[INFO] Fetching pools for 0x1234...
[INFO] Found 5 pools on Dexscreener
[INFO] Pool 1: biswap (v2), liquidity: $1,234,567
[INFO] Pool 2: pancakeswap (v3), liquidity: $456,789
[INFO] Selected: biswap v2 (0xPAIR) — highest liquidity
[INFO] Executing V2 swap: 0.01 BNB → TOKEN
[INFO] TX Hash: 0xabc123...
```

## .env.example

```bash
PRIVATE_KEY=your_private_key_here
# Public RPC
RPC_URL=https://bsc-dataseed.binance.org/
# MEV-protected (recommended)
# RPC_URL=https://rpc.48.club
SLIPPAGE=1
# Адрес задеплоенного UniversalSwap
UNIVERSAL_SWAP_ADDRESS=0x...
```

## Референсы

| Компонент | Репо |
|-----------|------|
| V2 swap через pair | [codeesura/Arbitrage-uniswap-sushiswap](https://github.com/codeesura/Arbitrage-uniswap-sushiswap) |
| V3 swap через pool | [Uniswap/v4-periphery](https://github.com/Uniswap/v4-periphery) |
| V4 Infinity | [pancakeswap/infinity-universal-router](https://github.com/pancakeswap/infinity-universal-router) |
| Dexscreener types | [hedgey-finance/dexscreener-api](https://github.com/hedgey-finance/dexscreener-api) |

---

## TODO (человек)

### V4 Implementation

Адаптировать код из PancakeSwap Infinity Universal Router для swapV4:

1. Изучить [pancakeswap/infinity-universal-router](https://github.com/pancakeswap/infinity-universal-router)
2. Вырезать минимальный код для swap через PoolManager
3. Интегрировать в UniversalSwap.sol
4. **Не тестировать** — V4 пока не в Dexscreener

Ключевые файлы:
- `src/modules/Dispatcher.sol` — dispatch логика
- `src/modules/pancakeswap/v4/V4SwapRouter.sol` — V4 swap

### BSC DEXes router mapping (optional)

Если понадобится fallback на router'ы:

```typescript
const ROUTERS: Record<string, { v2?: string; v3?: string }> = {
  pancakeswap: {
    v2: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
    v3: "0x1b81D678ffb9C0263b24A97847620C99d213eB14"
  },
  biswap: { v2: "0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8" },
  apeswap: { v2: "0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7" },
  thena: { v2: "0xd4ae6eCA985340Dd434D38F470aCCce4DC78D109" },
  squadswap: { v3: "0x..." },
}
```
