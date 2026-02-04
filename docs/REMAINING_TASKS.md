# Remaining Tasks - BSC Swap Bot

**Date:** 2026-02-04
**Status:** Based on code review comments

---

## Architecture Decision

**Use official routers instead of custom smart contract:**
- Support only **Uniswap** and **PancakeSwap**
- Use their official router contracts
- Custom `UniversalSwap.sol` is **DEPRECATED** (issues documented in contract header)
- Other DEXes can be added later via their routers

---

## TypeScript Tasks

### CRITICAL (Must Fix)

| # | Task | File | Notes |
|---|------|------|-------|
| 1 | **Fix slippage calculation** | `src/swap.ts:45-50` | Calculate based on expected output, not input. Get expected output via router's `getAmountsOut()` or callstatic |
| 2 | **Wrap BNB to WBNB via multicall** | `src/swap.ts` | Use router's multicall to wrap BNB + swap in one tx |
| 3 | **Add API error handling** | `src/dexscreener.ts:17-22` | try/catch, timeout 5s, retry logic |
| 4 | **Validate slippage input** | `src/config.ts`, `src/index.ts` | Check for NaN, bounds 0-99.99, 2 decimal precision |
| 5 | **Validate PRIVATE_KEY** | `src/config.ts:31-33` | Check not empty/whitespace |
| 6 | **Add transaction deadline** | `src/swap.ts`, `.env` | Default 30 seconds, configurable via `DEADLINE_SECONDS` |

### HIGH (Should Fix)

| # | Task | File | Notes |
|---|------|------|-------|
| 7 | **Use EIP-1559 gas** | `src/swap.ts` | `maxFeePerGas`, `maxPriorityFeePerGas` with buffer |
| 8 | **Validate zero amount** | `src/index.ts:69` | Check `amountIn > 0` before calling contract |
| 9 | **Min liquidity filter** | `src/dexscreener.ts` | Add `MIN_LIQUIDITY_USD` in .env, fallback $1000 |
| 10 | **Wrap parseEther in try/catch** | `src/index.ts:69` | User-friendly error message |
| 11 | **Add retry logic** | `src/swap.ts` or new `src/utils.ts` | Exponential backoff for network errors |

### MEDIUM (Nice to Have)

| # | Task | File | Notes |
|---|------|------|-------|
| 12 | **Update to use official routers** | `src/swap.ts` | Uniswap V2/V3 Router, PancakeSwap Router |
| 13 | **Calculate price via callstatic** | `src/swap.ts` | Get expected output before swap |

---

## Config Changes (.env)

```bash
# Existing
PRIVATE_KEY=
RPC_URL=https://bsc-dataseed.binance.org/
SLIPPAGE=1

# New
DEADLINE_SECONDS=30
MIN_LIQUIDITY_USD=1000

# Router addresses (for official routers approach)
PANCAKESWAP_V2_ROUTER=0x10ED43C718714eb63d5aA57B78B54704E256024E
PANCAKESWAP_V3_ROUTER=0x1b81D678ffb9C0263b24A97847620C99d213eB14
UNISWAP_V3_ROUTER=0x...  # if available on BSC
```

---

## Documentation Updates

| File | Change |
|------|--------|
| `CLAUDE.md` | Update slippage to 2 decimal precision, add deadline, add min liquidity |
| `README.md` | Document only Uniswap + PancakeSwap supported, other routers can be added later |
| `README.md` | Add "Limitations" section: deflationary tokens (fee-on-transfer) not supported |
| `README.md` | Add "Future Improvements" section for potential enhancements |

---

## Test Updates

| Task | Notes |
|------|-------|
| Update slippage tests | 2 decimal precision (0.01 - 99.99) |
| Add deadline tests | Default 30s, configurable |
| Add min liquidity tests | Filter pools < MIN_LIQUIDITY_USD |
| Add error handling tests | API failures, invalid inputs |

---

## Resolved Questions

1. **Integer division precision (2.3)** - Marked in contract as TODO to verify. Contract will be deprecated anyway.

2. **Deflationary tokens (3.1)** - **Document as limitation in README.** V3 doesn't support them (industry standard), V2 won't fix for MVP. Add to "Future Improvements" section.

3. **State pollution on revert (2.8)** - Solidity auto-rollbacks storage on revert, so not an issue.

4. **BigInt in TypeScript (1.7)** - Yes, use native `BigInt`. Built-in since ES2020/Node 10.4+.

5. **WBNB wrapping** - Use multicall on router (PancakeSwap/Uniswap pattern).

---

## Priority Order

1. Fix slippage calculation (CRITICAL - currently broken)
2. Add WBNB wrapping (CRITICAL - swaps won't work)
3. Validate inputs (slippage, amount, private key)
4. Add API error handling + retry
5. Add deadline support
6. Add min liquidity filter
7. Use EIP-1559 gas
8. Update tests
9. Update docs (CLAUDE.md, README.md)
10. (Optional) Migrate to official routers

---

## Smart Contract Status

**DEPRECATED** - All issues documented in `contracts/UniversalSwap.sol` header comment.

If you want to use the custom contract instead of official routers:
1. Fix all 10 issues listed in the contract header
2. Get professional security audit
3. Deploy to testnet first

---

*Generated from code review: 2026-02-04*
