# BSC Swap Bot - Comprehensive Code Review Report

**Date:** 2026-02-04
**Reviewers:** Claude Code AI Agents (5 parallel reviewers)
**Project:** dexscreener-bsc-swap
**Scope:** Full project review - reliability, safety, correctness, bugs

---

## Executive Summary

This report presents findings from a comprehensive code review of the BSC Swap Bot project. **The review identified 12 CRITICAL and 8 HIGH severity issues** that must be addressed before production deployment.

| Severity | Count | Description |
|----------|-------|-------------|
| **CRITICAL** | 12 | Blocking issues - security vulnerabilities, fund loss risk |
| **HIGH** | 8 | Major issues - reliability, correctness problems |
| **MEDIUM** | 6 | Important issues - edge cases, precision loss |
| **LOW** | 4 | Minor issues - code quality, documentation |

**Verdict:** The project architecture is sound, but critical implementation gaps prevent it from functioning safely. The contract has exploitable vulnerabilities that could drain user funds.

---

## Table of Contents

1. [Critical Issues](#1-critical-issues)
2. [High Severity Issues](#2-high-severity-issues)
3. [Medium Severity Issues](#3-medium-severity-issues)
4. [Low Severity Issues](#4-low-severity-issues)
5. [Best Practices Comparison](#5-best-practices-comparison)
6. [Recommendations](#6-recommendations)
7. [Files Reviewed](#7-files-reviewed)

---

## 1. Critical Issues

### 1.1 [SOLIDITY] Missing Factory Validation in V3 Callback

**File:** `contracts/UniversalSwap.sol:367-389`
**Confidence:** 95%

**Issue:** The V3 callback only checks `msg.sender == _expectedPool` but never validates that the pool was deployed by a legitimate factory. This is the fundamental security flaw in Uniswap V3 callbacks.

у нас вроде пулы легитимные, отдаётся апишкой, которой мы доверяем

**Current code:**

```solidity
function _handleV3Callback(...) internal {
    if (msg.sender != _expectedPool) revert InvalidCallbackCaller();
    // No factory validation!
    transferFrom(decoded.payer, msg.sender, amountToPay);
}
```

**Attack scenario:**

1. Attacker deploys malicious contract implementing IUniswapV3Pool
2. Calls `swapV3()` with malicious pool address
3. `_expectedPool = maliciousPoolAddress` is set
4. Malicious pool's `swap()` calls back with manipulated data
5. Callback passes validation, drains victim's approved tokens

**Impact:** Complete loss of funds for all users who approved the contract.

**Reference:** [Uniswap V3 CallbackValidation](https://github.com/Uniswap/v3-periphery/blob/main/contracts/libraries/CallbackValidation.sol)

**Fix required:**

```solidity
function _handleV3Callback(...) internal {
    // Validate pool via factory CREATE2
    address expectedPool = PoolAddress.computeAddress(
        factory, PoolAddress.getPoolKey(token0, token1, fee)
    );
    if (msg.sender != expectedPool) revert InvalidCallbackCaller();
}
```

---

### 1.2 [SOLIDITY] V2 Reserve Manipulation Vulnerability

**File:** `contracts/UniversalSwap.sol:141-192`
**Confidence:** 95%

**Issue:** The V2 swap reads reserves AFTER transferring tokens to the pair. This causes `reserveIn` to include the transferred amount, resulting in incorrect output calculation.

**Current flow:**

```solidity
// Line 164: Transfer FIRST
_safeTransferFrom(tokenIn, msg.sender, pair, amountIn);

// Line 167: Read reserves AFTER (includes amountIn!)
(uint112 reserve0, uint112 reserve1, ) = pairContract.getReserves();

// Line 173: Calculate with wrong reserves
amountOut = _getAmountOut(amountIn, state.reserveIn, state.reserveOut);
```

**Impact:** Users receive less tokens than expected due to inflated reserve calculations.

**Fix required:** Move `getReserves()` call BEFORE `_safeTransferFrom()`.
ДАВАЙ ДА
---

### 1.3 [SOLIDITY] Reentrancy via Malicious Token Callback

**File:** `contracts/UniversalSwap.sol:255-296, 367-389`
**Confidence:** 90%

**Issue:** No reentrancy protection exists. A malicious token's `transferFrom` can reenter swap functions while `_expectedPool` is still set.

**Attack flow:**

```solidity
// Malicious token
function transferFrom(address from, address to, uint256 amount) external {
    // _expectedPool is still set, can bypass validation
    universalSwap.swapV3(...);
    return true;
}
```

давай сделаем
**Fix required:**

```solidity
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract UniversalSwap is ReentrancyGuard {
    function swapV2(...) external nonReentrant { ... }
    function swapV3(...) external nonReentrant { ... }
}
```

---

### 1.4 [TYPESCRIPT] Missing Token Approval

**File:** `src/swap.ts:62-95`
**Confidence:** 100%

**Issue:** The `executeSwap` function never approves the UniversalSwap contract to spend tokens. The contract's `transferFrom` will fail.

**Impact:** Every swap transaction fails with "ERC20: insufficient allowance".

**Current code:**

```typescript
export async function executeSwap(params, config, provider) {
    const wallet = new Wallet(config.privateKey, provider);
    const contract = new Contract(config.universalSwapAddress, ABI, wallet);
    // NO APPROVAL - contract can't transfer tokens!
    const tx = await contract.swapV2(...);
}
```

**Fix required:**

```typescript
// Add before swap
const tokenContract = new Contract(params.tokenIn, ERC20_ABI, wallet);
const allowance = await tokenContract.allowance(wallet.address, config.universalSwapAddress);
if (allowance < params.amountIn) {
    const approveTx = await tokenContract.approve(config.universalSwapAddress, params.amountIn);
    await approveTx.wait();
}
```

мы только за нативку покупаем. давай сразу её оборачивать в wrappedbnb
---

### 1.5 [TYPESCRIPT] Incorrect Slippage Calculation

**File:** `src/swap.ts:45-50`
**Confidence:** 95%

**Issue:** `calculateAmountOutMin` applies slippage to **input amount** instead of expected output. This fundamentally breaks slippage protection.

**Current code:**

```typescript
export function calculateAmountOutMin(amountIn: bigint, slippage: number): bigint {
    const slippageMultiplier = BigInt(Math.floor((100 - slippage) * 10));
    return (amountIn * slippageMultiplier) / 1000n;  // WRONG!
}
```

**Why this is wrong:**

- Swapping 1 BNB for 1000 tokens with 1% slippage
- Current calculation: `1 BNB * 0.99 = 0.99 BNB` (meaningless)
- Correct calculation: `1000 tokens * 0.99 = 990 tokens`

**Impact:** Slippage protection is completely non-functional.
фиксим
**Fix required:**

```typescript
// Need expected output first, then apply slippage
export function calculateAmountOutMin(expectedOutput: bigint, slippage: number): bigint {
    const slippageMultiplier = BigInt(Math.floor((100 - slippage) * 100));
    return (expectedOutput * slippageMultiplier) / 10000n;
}
```

---

### 1.6 [TYPESCRIPT] No API Error Handling

**File:** `src/dexscreener.ts:17-22`
**Confidence:** 90%

**Issue:** `fetchPools` has zero error handling. API failures crash the bot.

**Current code:**

```typescript
export async function fetchPools(tokenAddress: string): Promise<DexscreenerPair[]> {
    const response = await axios.get(url);  // No try/catch!
    return response.data.pairs ?? [];
}
```

добавим да
**Missing:**

- No try/catch block
- No timeout configuration
- No retry logic
- No HTTP error code handling (429, 500, etc.)

**Fix required:**

```typescript
export async function fetchPools(tokenAddress: string): Promise<DexscreenerPair[]> {
    try {
        const response = await axios.get(url, { timeout: 5000 });
        if (!response.data?.pairs) return [];
        return response.data.pairs;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            throw new Error(`Dexscreener API error: ${error.message}`);
        }
        throw error;
    }
}
```

---

### 1.7 [TYPESCRIPT] NaN Slippage from Invalid Input

**File:** `src/config.ts:40-42`, `src/index.ts:41-43`
**Confidence:** 85%

**Issue:** `parseFloat()` on invalid strings produces `NaN`, which propagates through calculations and crashes.

```typescript
// config.ts
const slippage = parseFloat(process.env.SLIPPAGE);  // "abc" -> NaN

// index.ts
const slippage = parseFloat(slippageOverride);  // "not-a-number" -> NaN
```

**Impact:** `BigInt(NaN)` throws `RangeError`.
а мы можем ts builtin BigInt использовать?
**Fix required:**

```typescript
const slippage = parseFloat(value);
if (isNaN(slippage)) {
    throw new Error('Invalid slippage value: must be a number');
}
```

---

### 1.8 [TYPESCRIPT] Negative/Excessive Slippage Not Validated

**File:** `src/swap.ts:45-50`
**Confidence:** 90%

**Issue:** No bounds checking on slippage values.

```typescript
// slippage = -10: multiplier = 1100 (user expects MORE than input)
// slippage = 150: multiplier = -500 (underflow/wrong calculation)
const slippageMultiplier = BigInt(Math.floor((100 - slippage) * 10));
```

**Fix required:**

```typescript
if (slippage < 0 || slippage >= 100) {
    throw new Error(`Invalid slippage: ${slippage}. Must be between 0 and 99.99`);
}
```

да. давай слипадж сделаем с точностью до 2 знаков после запятой. в ридми обновить и везде + в тестах
---

### 1.9 [SOLIDITY] Multiple Callback Vulnerability

**File:** `contracts/UniversalSwap.sol:391-412`
**Confidence:** 80%

**Issue:** A malicious pool can call callbacks multiple times, draining funds repeatedly.

```solidity
// Both callbacks point to same handler
function uniswapV3SwapCallback(...) external { _handleV3Callback(...); }
function pancakeV3SwapCallback(...) external { _handleV3Callback(...); }

// Malicious pool:
function swap(...) external {
    target.uniswapV3SwapCallback(100, 0, data);
    target.uniswapV3SwapCallback(100, 0, data);  // Double drain!
}
```

**Fix required:** Add callback execution flag.
давай да
---

### 1.10 [TYPESCRIPT] Empty PRIVATE_KEY Passes Validation

**File:** `src/config.ts:31-33`
**Confidence:** 90%

**Issue:** Only checks existence, not validity.

```typescript
if (!process.env.PRIVATE_KEY) {  // "" passes this check!
    throw new Error('Missing PRIVATE_KEY');
}
```

**Fix required:**

```typescript
if (!process.env.PRIVATE_KEY || process.env.PRIVATE_KEY.trim() === '') {
    throw new Error('Missing PRIVATE_KEY');
}
```
фиксим
---

### 1.11 [BOTH] No Transaction Deadline Protection

**Files:** `src/swap.ts`, `contracts/UniversalSwap.sol`
**Confidence:** 85%

**Issue:** No deadline parameter in swaps. Transactions can execute hours/days later with stale prices.

**Industry standard:**

```solidity
function swapV2(..., uint256 deadline) external {
    require(block.timestamp <= deadline, "Transaction expired");
}
```
давай дэдлайн в 30 секунд, настраиваем в .env
**Impact:** Vulnerable to MEV attacks, stale transaction execution.

---

### 1.12 [SOLIDITY] Callback Data Manipulation

**File:** `contracts/UniversalSwap.sol:367-389`
**Confidence:** 80%

**Issue:** Malicious pool can modify callback data to target arbitrary victims.

```solidity
// Malicious pool modifies data before callback
V3CallbackData memory attack = V3CallbackData({
    tokenIn: original.tokenIn,
    payer: VICTIM_ADDRESS  // Changed!
});
target.uniswapV3SwapCallback(..., abi.encode(attack));
```

**Fix required:** Store data hash and validate in callback.
давай да
---

## 2. High Severity Issues

### 2.1 [TYPESCRIPT] No Gas Configuration

**File:** `src/swap.ts:62-95`
**Confidence:** 85%

**Issue:** No gas price/limit configuration, contradicts CLAUDE.md requirement for "+10-20% gas from base fee".

**Fix required:**

```typescript
const feeData = await provider.getFeeData();
const gasPrice = (feeData.gasPrice * 115n) / 100n;
const tx = await contract.swapV2(..., {
    gasLimit: 300000,
    maxFeePerGas: gasPrice,
});
```
используем EIP-1559
---

### 2.2 [SOLIDITY] V3 Price Limit Math Incorrect

**File:** `contracts/UniversalSwap.sol:303-332`
**Confidence:** 85%

**Issue:** Using `slippageBps / 2` for sqrtPrice is mathematically incorrect approximation.

```solidity
// sqrt(1 - x) ≠ 1 - x/2
// For 10% slippage: correct is 5.13% in sqrt space, code gives 5%
uint256 multiplier = BPS_DENOMINATOR - (slippageBps / 2);
```

**Recommendation:** Use pool boundaries and rely solely on `amountOutMin`:

```solidity
uint160 sqrtPriceLimitX96 = zeroForOne
    ? MIN_SQRT_RATIO + 1
    : MAX_SQRT_RATIO - 1;
```
через смарт будем считать через callstatic , вообще цену в TS считать через callstatic, TS долго отлаживать. мы считаем, что RPC у нас хороший
---

### 2.3 [SOLIDITY] Integer Division Precision Loss

**File:** `contracts/UniversalSwap.sol:315, 324`
**Confidence:** 80%

**Issue:** `slippageBps / 2` loses precision for odd values. `slippageBps = 1` results in 0 (no protection).
и какой фикс? насколько критично вообще
---

### 2.4 [TYPESCRIPT] No Pool Address Validation

**File:** `src/index.ts:75-83`
**Confidence:** 85%

**Issue:** Pool address used without format validation or contract code check.

**Fix required:**

```typescript
if (!/^0x[0-9a-fA-F]{40}$/.test(pool.pairAddress)) {
    throw new Error(`Invalid pair address: ${pool.pairAddress}`);
}
const code = await provider.getCode(pool.pairAddress);
if (code === '0x') {
    throw new Error(`No contract at: ${pool.pairAddress}`);
}
```
мы доверяем апишке
---

### 2.5 [TYPESCRIPT] Zero Amount Bypasses Validation

**File:** `src/index.ts:69`
**Confidence:** 85%

**Issue:** `parseEther("0")` proceeds to contract, wastes gas on revert.
добавляем
---

### 2.6 [TYPESCRIPT] Zero Liquidity Pool Selection

**File:** `src/dexscreener.ts:48-50`
**Confidence:** 85%

**Issue:** Pools with zero liquidity can be selected if no better option exists.

**Fix required:**

```typescript
.filter((item) => item !== null && (item.pair.liquidity?.usd ?? 0) > 0);
```
ликвидность давай брать из Dexscreener, давай минимум ликвидности в ENV ставить, фаллбэк на $1000
---

### 2.7 [TYPESCRIPT] parseEther Error Not Caught

**File:** `src/index.ts:69`
**Confidence:** 85%

**Issue:** Invalid amount strings throw generic ethers.js errors.

может сразу парсить в bigint? или обложим try catch?
---

### 2.8 [SOLIDITY] State Pollution on Revert

**File:** `contracts/UniversalSwap.sol:352-364`
**Confidence:** 75%

**Issue:** If pool's `swap()` reverts after callback, unclear state behavior (though Solidity should rollback).
не понял
---

## 3. Medium Severity Issues

### 3.1 Deflationary Token Not Handled

Tokens with transfer fees (e.g., SafeMoon) will cause incorrect output calculations.
хм. а как фиксить
### 3.2 V2 Fee Hardcoded

0.3% fee (997/1000) hardcoded. Some V2 forks use different fees.
так, вот это на смарте считаем, узнаем fee у пула
### 3.3 Dust Amount Zero Output

Extremely small swaps produce 0 output due to integer division.
защиту от 0 делаем
### 3.4 No Price Impact Warning

Large trades in low-liquidity pools can have 10-50% price impact with no warning.
проверка на сслипадж есть, поэтому не критично
### 3.5 No Retry Logic

Single failure terminates swap attempt. Industry standard: exponential backoff retry.
добавляем
### 3.6 Gas Griefing via Callback

Malicious pool can consume all gas before callback execution.
не критично
---

## 4. Low Severity Issues

### 4.1 Dual Callback Redundancy

Both `uniswapV3SwapCallback` and `pancakeV3SwapCallback` point to same handler - increased attack surface.

### 4.2 No Transaction Simulation

No `eth_call` simulation before sending transaction to catch reverts early.

### 4.3 Multiple Pools Same Liquidity

Sort stability not guaranteed when pools have identical liquidity.

### 4.4 Missing Multi-hop Routing

Single pool only. May fail when no direct pair exists.

---

## 5. Best Practices Comparison

| Feature | Industry Standard | Current Implementation | Gap |
|---------|------------------|----------------------|-----|
| Slippage protection | amountOutMin + deadline | amountOutMin only | Missing deadline |
| V3 price limit | Factory-validated sqrt | Simple approximation | Math error |
| Factory validation | CREATE2 verification | msg.sender check only | Critical gap |
| Reentrancy guard | OpenZeppelin modifier | None | Critical gap |
| Token approval | Check + approve pattern | Assumes pre-approved | Missing |
| Error handling | Classify + retry | Simple throw | Incomplete |
| Gas estimation | EIP-1559 + buffer | Default only | Missing buffer |
| Price impact | Warn at >3% | None | Missing |

### Recommended Reading

- [Uniswap V3 SwapRouter](https://github.com/Uniswap/v3-periphery/blob/main/contracts/SwapRouter.sol)
- [CallbackValidation.sol](https://github.com/Uniswap/v3-periphery/blob/main/contracts/libraries/CallbackValidation.sol)
- [Dedaub: Uniswap Reentrancy Vulnerability](https://dedaub.com/blog/uniswap-reentrancy/)
- [SlowMist: Uniswap V3 Audit Considerations](https://slowmist.medium.com/)

---

## 6. Recommendations

### Immediate Actions (Block Deployment)

1. **Add Factory Validation** - Implement `CallbackValidation.verifyCallback()` pattern
2. **Add Reentrancy Guard** - Use OpenZeppelin's `nonReentrant` modifier
3. **Fix Reserve Reading Order** - Move `getReserves()` before transfer in V2
4. **Add Token Approval** - Check allowance and approve before swap
5. **Fix Slippage Calculation** - Calculate based on expected output, not input
6. **Add Deadline Parameter** - Implement transaction expiry (default 30 min)

### Short-term Improvements

1. **Add API Error Handling** - Try/catch with timeout and retry
2. **Validate Inputs** - Slippage bounds, private key format, amounts
3. **Add Gas Configuration** - EIP-1559 support with buffer
4. **Callback Protection** - Prevent multiple callback execution

### Long-term Enhancements

1. **Price Impact Warnings** - Warn when impact > 3%
2. **Multi-hop Routing** - Support when direct pair unavailable
3. **Transaction Simulation** - eth_call before sending
4. **Retry Logic** - Exponential backoff for network errors

---

## 7. Files Reviewed

| File | Lines | Issues Found |
|------|-------|--------------|
| `contracts/UniversalSwap.sol` | 440 | 8 Critical, 3 High |
| `src/index.ts` | 125 | 2 Critical, 2 High |
| `src/swap.ts` | 96 | 3 Critical, 1 High |
| `src/dexscreener.ts` | 61 | 1 Critical, 1 High |
| `src/config.ts` | 51 | 2 Critical |
| `src/types.ts` | 85 | 0 |
| `src/logger.ts` | 24 | 0 |
| `src/*.test.ts` | ~500 | 0 (Good coverage) |

---

## Conclusion

The BSC Swap Bot has a well-designed architecture but contains **critical security vulnerabilities** in the Solidity contract and **fundamental functionality bugs** in the TypeScript code.

**The contract cannot be deployed safely** without implementing factory validation and reentrancy protection. The TypeScript code will fail all swaps due to missing token approval.

Estimated effort to fix critical issues: 2-3 days
Recommended: Professional security audit before mainnet deployment

---

*Report generated by Claude Code AI*
*Review conducted: 2026-02-04*


короче, я поласиз, давай саппортить только uniswap и pancakeswap, остальные забьём. можем через их роутеры делать, а свой смарт пока не трогать, остальные биржи чёт калл какойто. давай это в ридми напишем, что только 2 биржи поддерживаются, но роутеры ещё другие можно будет добавить позже