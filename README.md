# BSC Swap Bot

A command-line tool for swapping tokens on BSC (Binance Smart Chain) using Dexscreener API for pair discovery.

## Features

- Token swaps on BSC mainnet via official routers
- Automatic pair discovery via Dexscreener API
- **Automatic selection of the pool with highest liquidity**
- Support for Uniswap V2 and PancakeSwap V3 pools
- Configurable slippage protection (calculated from expected output)
- Transaction deadline protection
- Minimum liquidity filtering
- EIP-1559 gas pricing with automatic buffer

## How It Works

1. Fetches all pools for a token from Dexscreener API
2. Filters by BSC chain and V2/V3 labels
3. Filters out pools below minimum liquidity threshold
4. **Selects the pool with the highest USD liquidity**
5. Gets expected output via router's `getAmountsOut()`
6. Calculates `amountOutMin` with slippage protection
7. Executes swap via official router (wraps BNB automatically)

## Supported DEXes

- **Uniswap V2** forks (via PancakeSwap V2 Router)
- **PancakeSwap V3** (via SwapRouter)

Note: Only pools with `v2` or `v3` labels from Dexscreener are supported. The tool automatically picks the pool with highest liquidity regardless of DEX.

## Installation

```bash
npm install
```

## Quick Start

```bash
# Swap 0.01 BNB for a token
npx ts-node src/index.ts swap <TOKEN_ADDRESS> --amount 0.01

# With custom slippage
npx ts-node src/index.ts swap <TOKEN_ADDRESS> --amount 0.01 --slippage 2.5
```

## Configuration

Create a `.env` file in the project root:

```env
# Required
PRIVATE_KEY=your_private_key_here

# Optional
RPC_URL=https://bsc-dataseed.binance.org/    # BSC RPC endpoint
SLIPPAGE=1                                    # Default slippage % (0.01-99.99)
DEADLINE_SECONDS=30                           # Transaction deadline in seconds
MIN_LIQUIDITY_USD=1000                        # Minimum pool liquidity in USD
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PRIVATE_KEY` | Yes | - | Wallet private key for signing transactions |
| `RPC_URL` | No | `https://bsc-dataseed.binance.org/` | BSC RPC endpoint |
| `SLIPPAGE` | No | `1` | Default slippage tolerance (0.01-99.99%) |
| `DEADLINE_SECONDS` | No | `30` | Transaction deadline in seconds |
| `MIN_LIQUIDITY_USD` | No | `1000` | Minimum pool liquidity filter in USD |

## Limitations

- **Deflationary tokens not supported**: Tokens with fee-on-transfer (tax tokens) are not supported and may result in failed transactions
- **BSC mainnet only**: This tool only works on Binance Smart Chain mainnet
- **Official routers only**: Only Uniswap V2 Router and PancakeSwap V3 SwapRouter are supported
- **BNB input only**: Currently only supports swapping BNB for tokens (not token-to-token)

## MEV Protection

For MEV protection, consider using an MEV-protected RPC:

```env
RPC_URL=https://rpc.48.club
```

## Future Improvements

- [ ] Token-to-token swaps
- [ ] Support for additional DEXes
- [ ] Fee-on-transfer token support
- [ ] Multi-hop routing
- [ ] Price impact warnings
- [ ] Gas estimation improvements

## License

MIT
