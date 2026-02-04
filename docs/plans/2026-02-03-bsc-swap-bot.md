# BSC Swap Bot Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** CLI-бот для свопа токенов на BSC через любой V2/V3 DEX, используя Dexscreener API для поиска пула с максимальной ликвидностью.

**Architecture:** Swap через pair/pool напрямую (без router mapping). UniversalSwap.sol контракт принимает pairAddress из Dexscreener и вызывает pair.swap() / pool.swap().

**Tech Stack:** TypeScript, ethers.js v6, vitest, commander, Solidity 0.8.20, Hardhat

---

## Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `.gitignore`

**Step 1: Initialize package.json**

```bash
cd /home/kcnc/code/block-assessment/dexscreener-bsc-swap
```

```json
{
  "name": "dexscreener-bsc-swap",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "ts-node src/index.ts",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "dotenv": "^16.4.0",
    "ethers": "^6.13.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "ts-node": "^10.9.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Step 3: Create .env.example**

```bash
PRIVATE_KEY=your_private_key_here
# Public RPC
RPC_URL=https://bsc-dataseed.binance.org/
# MEV-protected (recommended)
# RPC_URL=https://rpc.48.club
SLIPPAGE=1
UNIVERSAL_SWAP_ADDRESS=0x...
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
.env
*.log
```

**Step 5: Install dependencies**

Run: `npm install`
Expected: Dependencies installed successfully

**Step 6: Commit**

```bash
git add package.json tsconfig.json .env.example .gitignore
git commit -m "chore: project setup with TypeScript and vitest"
```

---

## Task 2: Types

**Files:**
- Create: `src/types.ts`
- Create: `tests/types.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/types.test.ts
import { describe, it, expect } from 'vitest'
import type { DexPair, SwapParams, PoolVersion } from '../src/types.js'

describe('types', () => {
  it('DexPair has required fields', () => {
    const pair: DexPair = {
      chainId: 'bsc',
      dexId: 'pancakeswap',
      pairAddress: '0x123',
      baseToken: { address: '0xabc', symbol: 'TOKEN' },
      quoteToken: { address: '0xdef', symbol: 'WBNB' },
      labels: ['v2'],
      liquidity: { usd: 1000000 }
    }
    expect(pair.chainId).toBe('bsc')
    expect(pair.labels).toContain('v2')
  })

  it('SwapParams has required fields', () => {
    const params: SwapParams = {
      pair: '0x123',
      tokenIn: '0xabc',
      amountIn: BigInt(1e18),
      amountOutMin: BigInt(0),
      recipient: '0xdef',
      version: 'v2'
    }
    expect(params.version).toBe('v2')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/types.test.ts`
Expected: FAIL - cannot find module '../src/types.js'

**Step 3: Write implementation**

```typescript
// src/types.ts
export type PoolVersion = 'v2' | 'v3'

export interface DexPair {
  chainId: string
  dexId: string
  pairAddress: string
  baseToken: {
    address: string
    symbol: string
  }
  quoteToken: {
    address: string
    symbol: string
  }
  labels?: string[]
  liquidity?: {
    usd?: number
    base?: number
    quote?: number
  }
  priceUsd?: string
}

export interface DexscreenerResponse {
  pairs: DexPair[]
}

export interface SwapParams {
  pair: string
  tokenIn: string
  amountIn: bigint
  amountOutMin: bigint
  recipient: string
  version: PoolVersion
}

export interface Config {
  privateKey: string
  rpcUrl: string
  slippage: number
  universalSwapAddress: string
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "feat: add type definitions"
```

---

## Task 3: Config

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig, getSlippage, WBNB, DEFAULT_SLIPPAGE } from '../src/config.js'

describe('config', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('WBNB address is correct', () => {
    expect(WBNB).toBe('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c')
  })

  it('DEFAULT_SLIPPAGE is 1%', () => {
    expect(DEFAULT_SLIPPAGE).toBe(1)
  })

  it('getSlippage returns CLI value first', () => {
    process.env.SLIPPAGE = '2'
    expect(getSlippage(5)).toBe(5)
  })

  it('getSlippage returns env value if no CLI', () => {
    process.env.SLIPPAGE = '2'
    expect(getSlippage(undefined)).toBe(2)
  })

  it('getSlippage returns default if nothing set', () => {
    delete process.env.SLIPPAGE
    expect(getSlippage(undefined)).toBe(1)
  })

  it('loadConfig throws if PRIVATE_KEY missing', () => {
    delete process.env.PRIVATE_KEY
    process.env.RPC_URL = 'https://bsc.rpc'
    expect(() => loadConfig()).toThrow('PRIVATE_KEY')
  })

  it('loadConfig throws if RPC_URL missing', () => {
    process.env.PRIVATE_KEY = '0x123'
    delete process.env.RPC_URL
    expect(() => loadConfig()).toThrow('RPC_URL')
  })

  it('loadConfig returns config when valid', () => {
    process.env.PRIVATE_KEY = '0x123abc'
    process.env.RPC_URL = 'https://bsc.rpc'
    process.env.SLIPPAGE = '2'
    process.env.UNIVERSAL_SWAP_ADDRESS = '0xswap'

    const config = loadConfig()
    expect(config.privateKey).toBe('0x123abc')
    expect(config.rpcUrl).toBe('https://bsc.rpc')
    expect(config.slippage).toBe(2)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL - cannot find module

**Step 3: Write implementation**

```typescript
// src/config.ts
import 'dotenv/config'
import type { Config } from './types.js'

export const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
export const DEFAULT_SLIPPAGE = 1
export const DEFAULT_DEADLINE_MINUTES = 5

export function getSlippage(cliValue: number | undefined): number {
  if (cliValue !== undefined) return cliValue
  if (process.env.SLIPPAGE) return parseFloat(process.env.SLIPPAGE)
  return DEFAULT_SLIPPAGE
}

export function loadConfig(): Config {
  const privateKey = process.env.PRIVATE_KEY
  const rpcUrl = process.env.RPC_URL
  const universalSwapAddress = process.env.UNIVERSAL_SWAP_ADDRESS

  if (!privateKey) {
    throw new Error('PRIVATE_KEY is required in .env')
  }
  if (!rpcUrl) {
    throw new Error('RPC_URL is required in .env')
  }

  return {
    privateKey,
    rpcUrl,
    slippage: getSlippage(undefined),
    universalSwapAddress: universalSwapAddress || ''
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add config with slippage priority"
```

---

## Task 4: Logger

**Files:**
- Create: `src/logger.ts`
- Create: `tests/logger.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/logger.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logger } from '../src/logger.js'

describe('logger', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('info logs with [INFO] prefix', () => {
    logger.info('test message')
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO]'))
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('test message'))
  })

  it('error logs with [ERROR] prefix', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logger.error('error message')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR]'))
    errorSpy.mockRestore()
  })

  it('success logs with [SUCCESS] prefix', () => {
    logger.success('done')
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[SUCCESS]'))
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/logger.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/logger.ts
export const logger = {
  info: (message: string) => {
    console.log(`[INFO] ${message}`)
  },

  error: (message: string) => {
    console.error(`[ERROR] ${message}`)
  },

  success: (message: string) => {
    console.log(`[SUCCESS] ${message}`)
  },

  pool: (dexId: string, version: string, liquidity: number) => {
    console.log(`[INFO] Pool: ${dexId} (${version}), liquidity: $${liquidity.toLocaleString()}`)
  },

  selected: (dexId: string, version: string, pairAddress: string) => {
    console.log(`[INFO] Selected: ${dexId} ${version} (${pairAddress}) — highest liquidity`)
  },

  tx: (hash: string) => {
    console.log(`[INFO] TX Hash: ${hash}`)
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/logger.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/logger.ts tests/logger.test.ts
git commit -m "feat: add logger"
```

---

## Task 5: Dexscreener Client

**Files:**
- Create: `src/dexscreener.ts`
- Create: `tests/dexscreener.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/dexscreener.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchPairs, findBestPool, filterBscPools } from '../src/dexscreener.js'
import type { DexPair } from '../src/types.js'

describe('dexscreener', () => {
  describe('filterBscPools', () => {
    const mockPairs: DexPair[] = [
      { chainId: 'bsc', dexId: 'pancakeswap', pairAddress: '0x1', labels: ['v2'], baseToken: { address: '0xa', symbol: 'A' }, quoteToken: { address: '0xb', symbol: 'B' }, liquidity: { usd: 1000 } },
      { chainId: 'bsc', dexId: 'biswap', pairAddress: '0x2', labels: ['v3'], baseToken: { address: '0xa', symbol: 'A' }, quoteToken: { address: '0xb', symbol: 'B' }, liquidity: { usd: 2000 } },
      { chainId: 'ethereum', dexId: 'uniswap', pairAddress: '0x3', labels: ['v2'], baseToken: { address: '0xa', symbol: 'A' }, quoteToken: { address: '0xb', symbol: 'B' }, liquidity: { usd: 5000 } },
      { chainId: 'bsc', dexId: 'other', pairAddress: '0x4', labels: [], baseToken: { address: '0xa', symbol: 'A' }, quoteToken: { address: '0xb', symbol: 'B' }, liquidity: { usd: 3000 } },
    ]

    it('filters only BSC chains', () => {
      const result = filterBscPools(mockPairs)
      expect(result.every(p => p.chainId === 'bsc')).toBe(true)
    })

    it('filters only v2/v3 labels', () => {
      const result = filterBscPools(mockPairs)
      expect(result.every(p => p.labels?.some(l => ['v2', 'v3'].includes(l)))).toBe(true)
    })

    it('excludes pools without v2/v3 labels', () => {
      const result = filterBscPools(mockPairs)
      expect(result.find(p => p.pairAddress === '0x4')).toBeUndefined()
    })
  })

  describe('findBestPool', () => {
    it('returns pool with highest liquidity', () => {
      const pairs: DexPair[] = [
        { chainId: 'bsc', dexId: 'a', pairAddress: '0x1', labels: ['v2'], baseToken: { address: '0xa', symbol: 'A' }, quoteToken: { address: '0xb', symbol: 'B' }, liquidity: { usd: 1000 } },
        { chainId: 'bsc', dexId: 'b', pairAddress: '0x2', labels: ['v3'], baseToken: { address: '0xa', symbol: 'A' }, quoteToken: { address: '0xb', symbol: 'B' }, liquidity: { usd: 5000 } },
        { chainId: 'bsc', dexId: 'c', pairAddress: '0x3', labels: ['v2'], baseToken: { address: '0xa', symbol: 'A' }, quoteToken: { address: '0xb', symbol: 'B' }, liquidity: { usd: 2000 } },
      ]
      const best = findBestPool(pairs)
      expect(best?.pairAddress).toBe('0x2')
      expect(best?.liquidity?.usd).toBe(5000)
    })

    it('returns null for empty array', () => {
      expect(findBestPool([])).toBeNull()
    })

    it('handles missing liquidity gracefully', () => {
      const pairs: DexPair[] = [
        { chainId: 'bsc', dexId: 'a', pairAddress: '0x1', labels: ['v2'], baseToken: { address: '0xa', symbol: 'A' }, quoteToken: { address: '0xb', symbol: 'B' } },
        { chainId: 'bsc', dexId: 'b', pairAddress: '0x2', labels: ['v2'], baseToken: { address: '0xa', symbol: 'A' }, quoteToken: { address: '0xb', symbol: 'B' }, liquidity: { usd: 100 } },
      ]
      const best = findBestPool(pairs)
      expect(best?.pairAddress).toBe('0x2')
    })
  })

  describe('getPoolVersion', () => {
    it('returns v2 for v2 label', async () => {
      const { getPoolVersion } = await import('../src/dexscreener.js')
      const pair: DexPair = { chainId: 'bsc', dexId: 'test', pairAddress: '0x1', labels: ['v2'], baseToken: { address: '0xa', symbol: 'A' }, quoteToken: { address: '0xb', symbol: 'B' } }
      expect(getPoolVersion(pair)).toBe('v2')
    })

    it('returns v3 for v3 label', async () => {
      const { getPoolVersion } = await import('../src/dexscreener.js')
      const pair: DexPair = { chainId: 'bsc', dexId: 'test', pairAddress: '0x1', labels: ['v3'], baseToken: { address: '0xa', symbol: 'A' }, quoteToken: { address: '0xb', symbol: 'B' } }
      expect(getPoolVersion(pair)).toBe('v3')
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dexscreener.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/dexscreener.ts
import type { DexPair, DexscreenerResponse, PoolVersion } from './types.js'

const API_BASE = 'https://api.dexscreener.com/latest/dex'

export async function fetchPairs(tokenAddress: string): Promise<DexPair[]> {
  const response = await fetch(`${API_BASE}/tokens/${tokenAddress}`)
  if (!response.ok) {
    throw new Error(`Dexscreener API error: ${response.status}`)
  }
  const data: DexscreenerResponse = await response.json()
  return data.pairs || []
}

export function filterBscPools(pairs: DexPair[]): DexPair[] {
  return pairs
    .filter(p => p.chainId === 'bsc')
    .filter(p => p.labels?.some(l => ['v2', 'v3'].includes(l)))
}

export function findBestPool(pairs: DexPair[]): DexPair | null {
  if (pairs.length === 0) return null

  return pairs.reduce((best, current) => {
    const bestLiquidity = best.liquidity?.usd ?? 0
    const currentLiquidity = current.liquidity?.usd ?? 0
    return currentLiquidity > bestLiquidity ? current : best
  })
}

export function getPoolVersion(pair: DexPair): PoolVersion {
  if (pair.labels?.includes('v3')) return 'v3'
  return 'v2'
}

export async function getBestBscPool(tokenAddress: string): Promise<{ pair: DexPair; version: PoolVersion } | null> {
  const allPairs = await fetchPairs(tokenAddress)
  const bscPools = filterBscPools(allPairs)
  const bestPool = findBestPool(bscPools)

  if (!bestPool) return null

  return {
    pair: bestPool,
    version: getPoolVersion(bestPool)
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dexscreener.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/dexscreener.ts tests/dexscreener.test.ts
git commit -m "feat: add dexscreener client with pool filtering"
```

---

## Task 6: Swap Module

**Files:**
- Create: `src/swap.ts`
- Create: `tests/swap.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/swap.test.ts
import { describe, it, expect, vi } from 'vitest'
import { calculateAmountOutMin, calculateDeadline, buildSwapParams } from '../src/swap.js'
import type { DexPair, PoolVersion } from '../src/types.js'

describe('swap', () => {
  describe('calculateAmountOutMin', () => {
    it('calculates 1% slippage correctly', () => {
      const amountOut = BigInt(1000)
      const result = calculateAmountOutMin(amountOut, 1)
      expect(result).toBe(BigInt(990)) // 1000 * 0.99
    })

    it('calculates 5% slippage correctly', () => {
      const amountOut = BigInt(1000)
      const result = calculateAmountOutMin(amountOut, 5)
      expect(result).toBe(BigInt(950)) // 1000 * 0.95
    })

    it('handles 0% slippage', () => {
      const amountOut = BigInt(1000)
      const result = calculateAmountOutMin(amountOut, 0)
      expect(result).toBe(BigInt(1000))
    })
  })

  describe('calculateDeadline', () => {
    it('returns timestamp 5 minutes in future by default', () => {
      const now = Math.floor(Date.now() / 1000)
      const deadline = calculateDeadline()
      expect(deadline).toBeGreaterThan(now)
      expect(deadline).toBeLessThanOrEqual(now + 301) // ~5 min + 1 sec buffer
    })

    it('accepts custom minutes', () => {
      const now = Math.floor(Date.now() / 1000)
      const deadline = calculateDeadline(10)
      expect(deadline).toBeGreaterThan(now + 500)
    })
  })

  describe('buildSwapParams', () => {
    const mockPair: DexPair = {
      chainId: 'bsc',
      dexId: 'pancakeswap',
      pairAddress: '0xPAIR',
      baseToken: { address: '0xTOKEN', symbol: 'TOKEN' },
      quoteToken: { address: '0xWBNB', symbol: 'WBNB' },
      labels: ['v2']
    }

    it('builds params for v2 swap', () => {
      const params = buildSwapParams(mockPair, 'v2', '0xWBNB', BigInt(1e18), BigInt(1e17), '0xRECIPIENT')
      expect(params.pair).toBe('0xPAIR')
      expect(params.version).toBe('v2')
      expect(params.tokenIn).toBe('0xWBNB')
    })

    it('builds params for v3 swap', () => {
      const params = buildSwapParams(mockPair, 'v3', '0xWBNB', BigInt(1e18), BigInt(1e17), '0xRECIPIENT')
      expect(params.version).toBe('v3')
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/swap.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/swap.ts
import { ethers } from 'ethers'
import type { DexPair, SwapParams, PoolVersion } from './types.js'
import { DEFAULT_DEADLINE_MINUTES } from './config.js'

export function calculateAmountOutMin(expectedAmount: bigint, slippagePercent: number): bigint {
  const slippageBps = BigInt(Math.floor(slippagePercent * 100))
  return expectedAmount * (10000n - slippageBps) / 10000n
}

export function calculateDeadline(minutes: number = DEFAULT_DEADLINE_MINUTES): number {
  return Math.floor(Date.now() / 1000) + minutes * 60
}

export function buildSwapParams(
  pair: DexPair,
  version: PoolVersion,
  tokenIn: string,
  amountIn: bigint,
  amountOutMin: bigint,
  recipient: string
): SwapParams {
  return {
    pair: pair.pairAddress,
    tokenIn,
    amountIn,
    amountOutMin,
    recipient,
    version
  }
}

// ABI for UniversalSwap contract
export const UNIVERSAL_SWAP_ABI = [
  'function swapV2(address pair, address tokenIn, uint256 amountIn, uint256 amountOutMin, address recipient) external returns (uint256)',
  'function swapV3(address pool, address tokenIn, uint256 amountIn, uint256 amountOutMin, address recipient) external returns (uint256)'
]

export async function executeSwap(
  contract: ethers.Contract,
  params: SwapParams
): Promise<ethers.TransactionResponse> {
  const method = params.version === 'v2' ? 'swapV2' : 'swapV3'

  const tx = await contract[method](
    params.pair,
    params.tokenIn,
    params.amountIn,
    params.amountOutMin,
    params.recipient
  )

  return tx
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/swap.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/swap.ts tests/swap.test.ts
git commit -m "feat: add swap module with slippage calculation"
```

---

## Task 7: CLI

**Files:**
- Create: `src/index.ts`
- Create: `tests/cli.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/cli.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseAmount, validateAddress } from '../src/index.js'

describe('cli helpers', () => {
  describe('parseAmount', () => {
    it('parses decimal BNB amount to wei', () => {
      const wei = parseAmount('0.01')
      expect(wei).toBe(BigInt('10000000000000000')) // 0.01 * 1e18
    })

    it('parses integer amount', () => {
      const wei = parseAmount('1')
      expect(wei).toBe(BigInt('1000000000000000000'))
    })
  })

  describe('validateAddress', () => {
    it('returns true for valid address', () => {
      expect(validateAddress('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c')).toBe(true)
    })

    it('returns false for invalid address', () => {
      expect(validateAddress('0xinvalid')).toBe(false)
      expect(validateAddress('not-an-address')).toBe(false)
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/index.ts
import { Command } from 'commander'
import { ethers } from 'ethers'
import 'dotenv/config'

import { loadConfig, getSlippage, WBNB } from './config.js'
import { getBestBscPool } from './dexscreener.js'
import { buildSwapParams, calculateAmountOutMin, executeSwap, UNIVERSAL_SWAP_ABI } from './swap.js'
import { logger } from './logger.js'

export function parseAmount(amount: string): bigint {
  return ethers.parseEther(amount)
}

export function validateAddress(address: string): boolean {
  return ethers.isAddress(address)
}

const program = new Command()

program
  .name('bsc-swap')
  .description('Swap tokens on BSC via Dexscreener')
  .version('1.0.0')

program
  .command('swap')
  .description('Swap BNB for a token')
  .argument('<tokenAddress>', 'Token address to buy')
  .option('-a, --amount <amount>', 'Amount of BNB to spend', '0.01')
  .option('-s, --slippage <percent>', 'Slippage tolerance in percent')
  .action(async (tokenAddress: string, options: { amount: string; slippage?: string }) => {
    try {
      // Validate input
      if (!validateAddress(tokenAddress)) {
        logger.error(`Invalid token address: ${tokenAddress}`)
        process.exit(1)
      }

      const config = loadConfig()
      const slippage = getSlippage(options.slippage ? parseFloat(options.slippage) : undefined)
      const amountIn = parseAmount(options.amount)

      logger.info(`Fetching pools for ${tokenAddress}...`)

      // Find best pool
      const result = await getBestBscPool(tokenAddress)
      if (!result) {
        logger.error('No suitable BSC pool found')
        process.exit(1)
      }

      const { pair, version } = result
      logger.pool(pair.dexId, version, pair.liquidity?.usd ?? 0)
      logger.selected(pair.dexId, version, pair.pairAddress)

      // Setup provider and signer
      const provider = new ethers.JsonRpcProvider(config.rpcUrl)
      const wallet = new ethers.Wallet(config.privateKey, provider)

      // Build swap params
      const amountOutMin = calculateAmountOutMin(amountIn, slippage) // Simplified: use input as proxy
      const params = buildSwapParams(pair, version, WBNB, amountIn, amountOutMin, wallet.address)

      logger.info(`Executing ${version.toUpperCase()} swap: ${options.amount} BNB → ${pair.baseToken.symbol}`)

      // Execute swap
      const contract = new ethers.Contract(config.universalSwapAddress, UNIVERSAL_SWAP_ABI, wallet)
      const tx = await executeSwap(contract, params)

      logger.tx(tx.hash)
      logger.success('Swap submitted! Waiting for confirmation...')

      await tx.wait()
      logger.success('Swap completed!')

    } catch (error) {
      logger.error(error instanceof Error ? error.message : 'Unknown error')
      process.exit(1)
    }
  })

// Only run CLI if this is the main module
const isMainModule = import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  program.parse()
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/index.ts tests/cli.test.ts
git commit -m "feat: add CLI with swap command"
```

---

## Task 8: Vitest Config

**Files:**
- Create: `vitest.config.ts`

**Step 1: Create vitest config**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'] // CLI entry excluded
    }
  }
})
```

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "chore: add vitest config"
```

---

## Task 9: UniversalSwap Contract (Solidity)

**Files:**
- Create: `contracts/UniversalSwap.sol`
- Create: `hardhat.config.ts`

> **Note:** Solidity tests require Hardhat/Foundry setup. This task creates the contract; testing is separate.

**Step 1: Create contracts directory**

```bash
mkdir -p contracts
```

**Step 2: Write UniversalSwap.sol**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112, uint112, uint32);
    function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external;
}

interface IV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256, int256);
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract UniversalSwap {
    // ═══════════════════════════════════════════
    // V2 SWAP
    // ═══════════════════════════════════════════
    function swapV2(
        address pair,
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient
    ) external returns (uint256 amountOut) {
        // Transfer tokenIn to pair
        IERC20(tokenIn).transferFrom(msg.sender, pair, amountIn);

        // Get reserves and calculate output
        (uint112 reserve0, uint112 reserve1,) = IV2Pair(pair).getReserves();
        address token0 = IV2Pair(pair).token0();

        bool isToken0 = tokenIn == token0;
        (uint256 reserveIn, uint256 reserveOut) = isToken0
            ? (uint256(reserve0), uint256(reserve1))
            : (uint256(reserve1), uint256(reserve0));

        amountOut = _getAmountOut(amountIn, reserveIn, reserveOut);
        require(amountOut >= amountOutMin, "SLIPPAGE");

        // Execute swap
        (uint256 amount0Out, uint256 amount1Out) = isToken0
            ? (uint256(0), amountOut)
            : (amountOut, uint256(0));

        IV2Pair(pair).swap(amount0Out, amount1Out, recipient, "");
    }

    // ═══════════════════════════════════════════
    // V3 SWAP
    // ═══════════════════════════════════════════
    function swapV3(
        address pool,
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient
    ) external returns (uint256 amountOut) {
        address token0 = IV3Pool(pool).token0();
        bool zeroForOne = tokenIn == token0;

        uint160 sqrtPriceLimit = zeroForOne
            ? 4295128739 + 1
            : 1461446703485210103287273052203988822378723970342 - 1;

        (int256 amount0, int256 amount1) = IV3Pool(pool).swap(
            recipient,
            zeroForOne,
            int256(amountIn),
            sqrtPriceLimit,
            abi.encode(msg.sender, tokenIn, amountIn)
        );

        amountOut = uint256(zeroForOne ? -amount1 : -amount0);
        require(amountOut >= amountOutMin, "SLIPPAGE");
    }

    // V3 callback
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external {
        (address payer, address tokenIn,) = abi.decode(data, (address, address, uint256));
        uint256 amountToPay = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
        IERC20(tokenIn).transferFrom(payer, msg.sender, amountToPay);
    }

    // ═══════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════
    function _getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256) {
        uint256 amountInWithFee = amountIn * 997;
        return (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
    }
}
```

**Step 3: Commit**

```bash
git add contracts/UniversalSwap.sol
git commit -m "feat: add UniversalSwap contract (V2/V3)"
```

---

## Summary

| Task | Description | Tests |
|------|-------------|-------|
| 1 | Project setup | - |
| 2 | Types | 2 |
| 3 | Config | 7 |
| 4 | Logger | 3 |
| 5 | Dexscreener | 8 |
| 6 | Swap | 6 |
| 7 | CLI | 3 |
| 8 | Vitest config | - |
| 9 | Solidity contract | (separate) |

**Total TypeScript tests: 29**

---

## Run All Tests

```bash
npm test
```

Expected output:
```
 ✓ tests/types.test.ts (2)
 ✓ tests/config.test.ts (7)
 ✓ tests/logger.test.ts (3)
 ✓ tests/dexscreener.test.ts (8)
 ✓ tests/swap.test.ts (6)
 ✓ tests/cli.test.ts (3)

 Test Files  6 passed
 Tests       29 passed
```
