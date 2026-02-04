import { Command } from 'commander';
import { parseEther, formatUnits, JsonRpcProvider, Wallet } from 'ethers';
import { loadConfig, WBNB_ADDRESS, validateSlippage } from './config';
import { fetchPools, selectBestPool } from './dexscreener';
import { executeSwap, calculateAmountOutMin, getExpectedOutput } from './swap';
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

  // Determine slippage: CLI override > config, then validate
  const rawSlippage = slippageOverride
    ? parseFloat(slippageOverride)
    : config.slippage;
  const slippage = validateSlippage(rawSlippage);

  // Log configuration
  info('=== BSC Swap Bot ===');
  info(`Token: ${tokenAddress}`);
  info(`Amount: ${amount} BNB`);
  info(`Slippage: ${slippage}%${slippageOverride ? ' (CLI override)' : ''}`);
  info(`Deadline: ${config.deadlineSeconds}s`);
  info(`Min liquidity: ${formatLiquidity(config.minLiquidityUsd)}`);
  info('');

  // Fetch pools from Dexscreener
  info(`Fetching pools from Dexscreener...`);
  const pairs = await fetchPools(tokenAddress);

  // Filter and count BSC pools
  const bscPairs = pairs.filter(p => p.chainId === 'bsc');
  const v2v3Pairs = bscPairs.filter(p => p.labels?.some(l => l === 'v2' || l === 'v3'));

  info(`Found: ${pairs.length} total, ${bscPairs.length} BSC, ${v2v3Pairs.length} V2/V3`);
  info('');

  // Log BSC V2/V3 pools sorted by liquidity
  if (v2v3Pairs.length > 0) {
    info('Available pools (sorted by liquidity):');
    const sortedPairs = [...v2v3Pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    sortedPairs.forEach((pair, index) => logPoolInfo(pair, index));
    info('');
  }

  // Select the best pool with minimum liquidity filter
  const result = selectBestPool(pairs, config.minLiquidityUsd);

  if (!result.success) {
    if (result.reason === 'insufficient_liquidity') {
      const message = `No pools with sufficient liquidity (minimum ${formatLiquidity(result.minLiquidityUsd)})`;
      error(message);
      throw new Error(message);
    }
    error('No suitable V2/V3 pools found on BSC');
    throw new Error('No suitable pools found');
  }

  const pool = result.pool;
  info(`Selected pool: ${pool.dexId.toUpperCase()} ${pool.poolType.toUpperCase()}`);
  info(`  Address: ${pool.pairAddress}`);
  info(`  Liquidity: ${formatLiquidity(pool.liquidity)}`);
  info('');

  // Create provider and wallet
  const provider = new JsonRpcProvider(config.rpcUrl);
  const wallet = new Wallet(config.privateKey, provider);
  info(`Wallet: ${wallet.address}`);

  // Parse amount to wei
  let amountIn: bigint;
  try {
    amountIn = parseEther(amount);
  } catch {
    throw new Error(`Invalid amount format: '${amount}'. Use decimal notation like '0.01'`);
  }

  // Validate amount is greater than 0
  if (amountIn <= 0n) {
    throw new Error('Amount must be greater than 0');
  }

  // Convert slippage to basis points (1% = 100 bps)
  const slippageBps = Math.floor(slippage * 100);

  // Get expected output from router
  info('');
  info('Querying PancakeSwap router for expected output...');
  const expectedOutput = await getExpectedOutput(provider, amountIn, WBNB_ADDRESS, tokenAddress);

  // Calculate minimum output with slippage applied to expected output
  const amountOutMin = calculateAmountOutMin(expectedOutput, slippageBps);

  // Log swap details
  info(`Expected output: ${formatUnits(expectedOutput, 18)} tokens`);
  info(`Min output (${slippage}% slippage): ${formatUnits(amountOutMin, 18)} tokens`);

  // Calculate deadline as current timestamp + deadlineSeconds
  const deadline = BigInt(Math.floor(Date.now() / 1000) + config.deadlineSeconds);

  // Prepare swap parameters
  const swapParams: SwapParams = {
    pairAddress: pool.pairAddress,
    tokenIn: WBNB_ADDRESS,
    tokenOut: tokenAddress,
    amountIn,
    amountOutMin,
    slippageBps,
    recipient: wallet.address,
    poolType: pool.poolType,
    deadline,
  };

  // Log swap execution
  info('');
  info(`Executing swap via PancakeSwap ${pool.poolType.toUpperCase()} Router...`);
  info(`  ${amount} BNB → TOKEN`);
  info(`  Deadline: ${new Date(Number(deadline) * 1000).toLocaleTimeString()}`);

  try {
    // Execute the swap
    const txHash = await executeSwap(swapParams, config, provider);
    info('');
    info('=== Swap Submitted ===');
    info(`TX Hash: ${txHash}`);
    info(`BSCScan: https://bscscan.com/tx/${txHash}`);
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
      info(`Starting swap: ${tokenAddress} amount=${options.amount} slippage=${options.slippage ?? 'default'}`);
      await runSwap(tokenAddress, options.amount, options.slippage);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      error(`Fatal: ${msg}`);
      if (err instanceof Error && err.stack) {
        console.error(err.stack);
      }
      process.exit(1);
    }
  });

// Only parse CLI arguments when run directly
if (require.main === module) {
  program.parse();
}
