import { Command } from 'commander';
import { parseEther, JsonRpcProvider, Wallet } from 'ethers';
import { loadConfig, WBNB_ADDRESS } from './config';
import { fetchPools, selectBestPool } from './dexscreener';
import { executeSwap, calculateAmountOutMin } from './swap';
import { info, error } from './logger';
import type { SwapParams, DexscreenerPair } from './types';

/**
 * Format liquidity as USD string with commas
 */
function formatLiquidity(liquidity: number): string {
  return `$${liquidity.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/**
 * Log information about a pool
 */
function logPoolInfo(pair: DexscreenerPair, index: number): void {
  const label = pair.labels?.find((l) => l === 'v2' || l === 'v3') ?? 'unknown';
  const liquidity = pair.liquidity?.usd ?? 0;
  info(`Pool ${index + 1}: ${pair.dexId} (${label}), liquidity: ${formatLiquidity(liquidity)}`);
}

/**
 * Main swap execution function - exported for testing
 * @param tokenAddress - The token contract address to swap to
 * @param amount - Amount of BNB to swap (as string, e.g., "0.01")
 * @param slippageOverride - Optional slippage override (as string, e.g., "2")
 * @returns Transaction hash of the swap
 */
export async function runSwap(
  tokenAddress: string,
  amount: string,
  slippageOverride?: string
): Promise<string> {
  // Load configuration
  const config = loadConfig();

  // Determine slippage: CLI override > config
  const slippage = slippageOverride
    ? parseFloat(slippageOverride)
    : config.slippage;

  // Fetch pools from Dexscreener
  info(`Fetching pools for ${tokenAddress}...`);
  const pairs = await fetchPools(tokenAddress);

  info(`Found ${pairs.length} pools on Dexscreener`);

  // Log each pool's info
  pairs.forEach((pair, index) => logPoolInfo(pair, index));

  // Select the best pool
  const pool = selectBestPool(pairs);

  if (!pool) {
    error('No suitable pools found for this token');
    throw new Error('No suitable pools found');
  }

  info(`Selected: ${pool.dexId} ${pool.poolType} (${pool.pairAddress}) — highest liquidity`);

  // Create provider and wallet
  const provider = new JsonRpcProvider(config.rpcUrl);
  const wallet = new Wallet(config.privateKey, provider);

  // Parse amount to wei
  const amountIn = parseEther(amount);

  // Calculate minimum output with slippage
  const amountOutMin = calculateAmountOutMin(amountIn, slippage);

  // Prepare swap parameters
  const swapParams: SwapParams = {
    pairAddress: pool.pairAddress,
    tokenIn: WBNB_ADDRESS,
    amountIn,
    amountOutMin,
    slippageBps: Math.floor(slippage * 100), // 1% -> 100 bps
    recipient: wallet.address,
    poolType: pool.poolType,
  };

  // Log swap execution
  info(`Executing V${pool.poolType === 'v2' ? '2' : '3'} swap: ${amount} BNB → TOKEN`);

  try {
    // Execute the swap
    const txHash = await executeSwap(swapParams, config, provider);
    info(`TX Hash: ${txHash}`);
    return txHash;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error(`Swap failed: ${errorMessage}`);
    throw err;
  }
}

// CLI setup
const program = new Command();

program
  .name('bsc-swap')
  .description('BSC Swap Bot - swap tokens via Dexscreener pools')
  .version('1.0.0');

program
  .command('swap <tokenAddress>')
  .description('Swap BNB for a token')
  .requiredOption('--amount <bnb>', 'Amount of BNB to swap')
  .option('--slippage <percent>', 'Slippage tolerance (default: from config or 1%)')
  .action(async (tokenAddress: string, options: { amount: string; slippage?: string }) => {
    try {
      await runSwap(tokenAddress, options.amount, options.slippage);
    } catch (err) {
      process.exit(1);
    }
  });

// Only parse CLI arguments when run directly
if (require.main === module) {
  program.parse();
}
