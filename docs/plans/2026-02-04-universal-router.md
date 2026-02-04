# Universal Router Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace separate V2/V3 router calls with a single PancakeSwap Universal Router that handles both swap types.

**Architecture:** Use PancakeSwap Infinity Universal Router (`0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB`) which accepts commands array. V2 swaps use command `0x08`, V3 swaps use command `0x00`. Both accept native BNB via `{ value }`.

**Tech Stack:** ethers.js v6, PancakeSwap Universal Router, TypeScript

---

## Task 1: Add Universal Router Constants

**Files:**
- Modify: `src/swap.ts:22-37`

**Step 1: Add constants**

Add after existing router constants:

```typescript
/**
 * PancakeSwap Infinity Universal Router address on BSC mainnet
 * Supports both V2 and V3 swaps via execute() function
 */
export const PANCAKESWAP_UNIVERSAL_ROUTER = '0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB';

/**
 * Universal Router command codes
 */
export const UNIVERSAL_ROUTER_COMMANDS = {
  V3_SWAP_EXACT_IN: 0x00,
  V2_SWAP_EXACT_IN: 0x08,
} as const;
```

**Step 2: Run tests to verify no regression**

Run: `npm test`
Expected: All 190 tests pass (no behavior change yet)

**Step 3: Commit**

```bash
git add src/swap.ts
git commit -m "feat(swap): add Universal Router constants"
```

---

## Task 2: Add Universal Router ABI

**Files:**
- Modify: `src/swap.ts` (after existing ABIs around line 102)

**Step 1: Add ABI**

```typescript
/**
 * ABI for PancakeSwap Universal Router - execute function
 */
const UNIVERSAL_ROUTER_ABI = [
  {
    name: 'execute',
    type: 'function',
    inputs: [
      { name: 'commands', type: 'bytes' },
      { name: 'inputs', type: 'bytes[]' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
];
```

**Step 2: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/swap.ts
git commit -m "feat(swap): add Universal Router ABI"
```

---

## Task 3: Create V2 Command Encoder

**Files:**
- Modify: `src/swap.ts`
- Test: `src/swap.test.ts`

**Step 1: Write failing test**

Add to `src/swap.test.ts`:

```typescript
describe('encodeV2SwapCommand', () => {
  it('should encode V2 swap command with correct parameters', () => {
    const { encodeV2SwapCommand } = require('./swap');

    const encoded = encodeV2SwapCommand(
      '0xRecipient',
      1000000000000000000n, // 1 BNB
      900000000000000000n,  // 0.9 token min
      ['0xWBNB', '0xToken'],
      true // payerIsUser
    );

    expect(encoded).toMatch(/^0x/);
    expect(encoded.length).toBeGreaterThan(10);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --grep "encodeV2SwapCommand"`
Expected: FAIL - function not defined

**Step 3: Implement encoder**

Add to `src/swap.ts`:

```typescript
import { AbiCoder } from 'ethers';

/**
 * Encode V2 swap input for Universal Router.
 * Command 0x08: V2_SWAP_EXACT_IN
 *
 * @param recipient - Address to receive tokens
 * @param amountIn - Input amount in wei
 * @param amountOutMin - Minimum output amount
 * @param path - Token path array [tokenIn, tokenOut]
 * @param payerIsUser - true if router should pull tokens from caller
 * @returns ABI-encoded input bytes
 */
export function encodeV2SwapCommand(
  recipient: string,
  amountIn: bigint,
  amountOutMin: bigint,
  path: string[],
  payerIsUser: boolean
): string {
  const abiCoder = AbiCoder.defaultAbiCoder();
  return abiCoder.encode(
    ['address', 'uint256', 'uint256', 'address[]', 'bool'],
    [recipient, amountIn, amountOutMin, path, payerIsUser]
  );
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --grep "encodeV2SwapCommand"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/swap.ts src/swap.test.ts
git commit -m "feat(swap): add V2 command encoder for Universal Router"
```

---

## Task 4: Create V3 Command Encoder

**Files:**
- Modify: `src/swap.ts`
- Test: `src/swap.test.ts`

**Step 1: Write failing test**

Add to `src/swap.test.ts`:

```typescript
describe('encodeV3SwapCommand', () => {
  it('should encode V3 swap command with packed path', () => {
    const { encodeV3SwapCommand } = require('./swap');

    const encoded = encodeV3SwapCommand(
      '0xRecipient',
      1000000000000000000n,
      900000000000000000n,
      '0xWBNB',
      '0xToken',
      2500, // 0.25% fee
      true
    );

    expect(encoded).toMatch(/^0x/);
    expect(encoded.length).toBeGreaterThan(10);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --grep "encodeV3SwapCommand"`
Expected: FAIL

**Step 3: Implement encoder**

Add to `src/swap.ts`:

```typescript
import { solidityPacked } from 'ethers';

/**
 * Encode V3 swap input for Universal Router.
 * Command 0x00: V3_SWAP_EXACT_IN
 * Path is encoded as: abi.encodePacked(tokenIn, fee, tokenOut)
 *
 * @param recipient - Address to receive tokens
 * @param amountIn - Input amount in wei
 * @param amountOutMin - Minimum output amount
 * @param tokenIn - Input token address
 * @param tokenOut - Output token address
 * @param fee - Pool fee tier (e.g., 2500 for 0.25%)
 * @param payerIsUser - true if router should pull tokens from caller
 * @returns ABI-encoded input bytes
 */
export function encodeV3SwapCommand(
  recipient: string,
  amountIn: bigint,
  amountOutMin: bigint,
  tokenIn: string,
  tokenOut: string,
  fee: number,
  payerIsUser: boolean
): string {
  const abiCoder = AbiCoder.defaultAbiCoder();

  // V3 path is packed: tokenIn + fee + tokenOut
  const path = solidityPacked(
    ['address', 'uint24', 'address'],
    [tokenIn, fee, tokenOut]
  );

  return abiCoder.encode(
    ['address', 'uint256', 'uint256', 'bytes', 'bool'],
    [recipient, amountIn, amountOutMin, path, payerIsUser]
  );
}
```

**Step 4: Run test**

Run: `npm test -- --grep "encodeV3SwapCommand"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/swap.ts src/swap.test.ts
git commit -m "feat(swap): add V3 command encoder for Universal Router"
```

---

## Task 5: Create executeUniversalSwap Function

**Files:**
- Modify: `src/swap.ts`
- Test: `src/swap.test.ts`

**Step 1: Write failing test**

Add to `src/swap.test.ts`:

```typescript
describe('executeUniversalSwap', () => {
  it('should call Universal Router execute with V2 command', async () => {
    const mockExecute = vi.fn().mockResolvedValue({ hash: '0xTxHash' });
    const mockContract = { execute: mockExecute };

    (Contract as unknown as Mock).mockReturnValue(mockContract);

    const { executeUniversalSwap } = await import('./swap');

    const result = await executeUniversalSwap(
      {
        ...mockSwapParams,
        poolType: 'v2',
      },
      mockConfig,
      mockProvider
    );

    expect(mockExecute).toHaveBeenCalled();
    expect(result).toBe('0xTxHash');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --grep "executeUniversalSwap"`
Expected: FAIL

**Step 3: Implement function**

Add to `src/swap.ts`:

```typescript
/**
 * Execute swap via PancakeSwap Universal Router.
 * Uses execute() with command bytes and encoded inputs.
 * Handles both V2 (0x08) and V3 (0x00) swaps.
 *
 * @param params - Swap parameters
 * @param config - Configuration
 * @param provider - JSON RPC provider
 * @returns Transaction hash
 */
export async function executeUniversalSwap(
  params: SwapParams,
  config: Config,
  provider: JsonRpcProvider
): Promise<string> {
  const wallet = new Wallet(config.privateKey, provider);
  const gasParams = await getGasParams(provider);

  const router = new Contract(PANCAKESWAP_UNIVERSAL_ROUTER, UNIVERSAL_ROUTER_ABI, wallet);

  let command: number;
  let input: string;

  if (params.poolType === 'v2') {
    command = UNIVERSAL_ROUTER_COMMANDS.V2_SWAP_EXACT_IN;
    input = encodeV2SwapCommand(
      params.recipient,
      params.amountIn,
      params.amountOutMin,
      [WBNB_ADDRESS, params.tokenOut],
      false // payerIsUser = false since we're sending value
    );
  } else {
    command = UNIVERSAL_ROUTER_COMMANDS.V3_SWAP_EXACT_IN;
    input = encodeV3SwapCommand(
      params.recipient,
      params.amountIn,
      params.amountOutMin,
      WBNB_ADDRESS,
      params.tokenOut,
      DEFAULT_V3_POOL_FEE,
      false
    );
  }

  // Commands is a bytes string where each byte is a command
  const commands = '0x' + command.toString(16).padStart(2, '0');

  const tx = await router.execute(
    commands,
    [input],
    params.deadline,
    {
      value: params.amountIn,
      ...gasParams,
    }
  );

  return tx.hash;
}
```

**Step 4: Run test**

Run: `npm test -- --grep "executeUniversalSwap"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/swap.ts src/swap.test.ts
git commit -m "feat(swap): add executeUniversalSwap function"
```

---

## Task 6: Add USE_UNIVERSAL_ROUTER Config Flag

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Test: `src/config.test.ts`

**Step 1: Write failing test**

Add to `src/config.test.ts`:

```typescript
it('should use default USE_UNIVERSAL_ROUTER of true', async () => {
  process.env.PRIVATE_KEY = '0x123';
  process.env.UNIVERSAL_SWAP_ADDRESS = '0x456';

  const { loadConfig } = await import('./config');
  const config = loadConfig();

  expect(config.useUniversalRouter).toBe(true);
});

it('should allow disabling Universal Router via env', async () => {
  process.env.PRIVATE_KEY = '0x123';
  process.env.UNIVERSAL_SWAP_ADDRESS = '0x456';
  process.env.USE_UNIVERSAL_ROUTER = 'false';

  const { loadConfig } = await import('./config');
  const config = loadConfig();

  expect(config.useUniversalRouter).toBe(false);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --grep "USE_UNIVERSAL_ROUTER"`
Expected: FAIL

**Step 3: Update types.ts**

Add to `Config` interface:

```typescript
useUniversalRouter: boolean;
```

**Step 4: Update config.ts**

Add to `loadConfig()`:

```typescript
const useUniversalRouter = process.env.USE_UNIVERSAL_ROUTER !== 'false';

return {
  // ... existing fields
  useUniversalRouter,
};
```

**Step 5: Run test**

Run: `npm test -- --grep "USE_UNIVERSAL_ROUTER"`
Expected: PASS

**Step 6: Commit**

```bash
git add src/types.ts src/config.ts src/config.test.ts
git commit -m "feat(config): add USE_UNIVERSAL_ROUTER flag (default true)"
```

---

## Task 7: Update executeSwap to Use Universal Router

**Files:**
- Modify: `src/swap.ts`
- Test: `src/swap.test.ts`

**Step 1: Modify executeSwap**

Update `executeSwap` function to check config flag:

```typescript
export async function executeSwap(
  params: SwapParams,
  config: Config,
  provider: JsonRpcProvider
): Promise<string> {
  // Use Universal Router by default
  if (config.useUniversalRouter) {
    return executeUniversalSwap(params, config, provider);
  }

  // Legacy: separate routers (kept for backwards compatibility)
  // ... existing V2/V3 router code
}
```

**Step 2: Update tests**

Update mock config in `src/swap.test.ts` and `src/index.test.ts`:

```typescript
const mockConfig: Config = {
  // ... existing fields
  useUniversalRouter: true,
};
```

**Step 3: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/swap.ts src/swap.test.ts src/index.test.ts
git commit -m "feat(swap): use Universal Router by default"
```

---

## Task 8: Update Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `.env.example`

**Step 1: Update CLAUDE.md**

Add to MEV Protection section:

```markdown
- Universal Router: PancakeSwap Infinity `0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB`
- `USE_UNIVERSAL_ROUTER=false` to use legacy separate routers
```

**Step 2: Update README.md**

Update Supported DEXes section:

```markdown
## Supported DEXes

Uses **PancakeSwap Universal Router** which supports:
- **V2 pools** (Uniswap V2 forks)
- **V3 pools** (Concentrated liquidity)

Set `USE_UNIVERSAL_ROUTER=false` in .env to use legacy separate routers.
```

**Step 3: Update .env.example**

Add:

```bash
# Use PancakeSwap Universal Router (default: true)
# Set to false to use legacy separate V2/V3 routers
USE_UNIVERSAL_ROUTER=true
```

**Step 4: Commit**

```bash
git add CLAUDE.md README.md .env.example
git commit -m "docs: document Universal Router usage"
```

---

## Task 9: Clean Up Legacy Code (Optional)

**Files:**
- Modify: `src/swap.ts`

**Step 1: Remove encodeExactInputSingle**

Delete the old `encodeExactInputSingle` function (replaced by `encodeV3SwapCommand`).

**Step 2: Update tests**

Remove tests for `encodeExactInputSingle`.

**Step 3: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/swap.ts src/swap.test.ts
git commit -m "refactor(swap): remove legacy encodeExactInputSingle"
```

---

## Summary

After completing all tasks:

1. ✅ Universal Router constants and ABI added
2. ✅ V2 command encoder (`encodeV2SwapCommand`)
3. ✅ V3 command encoder (`encodeV3SwapCommand`)
4. ✅ `executeUniversalSwap` function
5. ✅ Config flag `USE_UNIVERSAL_ROUTER` (default true)
6. ✅ `executeSwap` uses Universal Router by default
7. ✅ Documentation updated
8. ✅ Legacy code cleaned up

**Testing:**

```bash
# Run all tests
npm test

# Manual test (testnet recommended)
npx ts-node src/index.ts swap 0xTokenAddress --amount 0.001 --slippage 5
```
