import axios from 'axios';
import {
  DexscreenerPair,
  DexscreenerResponse,
  PoolInfo,
  PoolLabel,
  isValidPoolLabel,
} from './types';

const DEXSCREENER_API_BASE = 'https://api.dexscreener.com/latest/dex/tokens';

/**
 * Fetches pool data from Dexscreener API for a given token address
 * @param tokenAddress - The token contract address to look up
 * @returns Array of DexscreenerPair objects, or empty array if none found
 */
export async function fetchPools(tokenAddress: string): Promise<DexscreenerPair[]> {
  const response = await axios.get<DexscreenerResponse>(
    `${DEXSCREENER_API_BASE}/${tokenAddress}`
  );
  return response.data.pairs ?? [];
}

/**
 * Selects the best pool from a list of Dexscreener pairs
 * Filters by: chainId === 'bsc' AND labels containing 'v2' or 'v3'
 * Sorts by: liquidity.usd descending
 * @param pairs - Array of DexscreenerPair objects to filter and sort
 * @returns PoolInfo for the best pool, or null if no valid pools found
 */
export function selectBestPool(pairs: DexscreenerPair[]): PoolInfo | null {
  // Filter by BSC chain
  const bscPairs = pairs.filter((p) => p.chainId === 'bsc');

  // Filter by v2/v3 labels and map to pairs with their valid label
  const validPairs = bscPairs
    .map((pair) => {
      const validLabel = pair.labels?.find((l) => isValidPoolLabel(l));
      return validLabel ? { pair, poolType: validLabel as PoolLabel } : null;
    })
    .filter((item): item is { pair: DexscreenerPair; poolType: PoolLabel } => item !== null);

  if (validPairs.length === 0) {
    return null;
  }

  // Sort by liquidity.usd descending
  validPairs.sort(
    (a, b) => (b.pair.liquidity?.usd ?? 0) - (a.pair.liquidity?.usd ?? 0)
  );

  // Return the best pool as PoolInfo
  const best = validPairs[0];
  return {
    pairAddress: best.pair.pairAddress,
    poolType: best.poolType,
    dexId: best.pair.dexId,
    liquidity: best.pair.liquidity?.usd ?? 0,
  };
}
