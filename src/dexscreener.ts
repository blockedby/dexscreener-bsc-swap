import axios, { AxiosError } from 'axios';
import {
  DexscreenerPair,
  DexscreenerResponse,
  PoolInfo,
  PoolLabel,
  isValidPoolLabel,
} from './types';
import * as logger from './logger';

const DEXSCREENER_API_BASE = 'https://api.dexscreener.com/latest/dex/tokens';
const REQUEST_TIMEOUT_MS = 5000;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Custom error class for Dexscreener API errors
 */
export class DexscreenerApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly isRetryable: boolean = false
  ) {
    super(message);
    this.name = 'DexscreenerApiError';
  }
}

/**
 * Custom error class for insufficient liquidity
 */
export class InsufficientLiquidityError extends Error {
  constructor(public readonly minLiquidityUsd: number) {
    super(`No pools with sufficient liquidity (minimum $${minLiquidityUsd.toLocaleString('en-US')})`);
    this.name = 'InsufficientLiquidityError';
  }
}

/**
 * Sleep utility for delays between retries
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determines if an error is retryable and returns appropriate message
 */
function categorizeError(error: AxiosError): { message: string; isRetryable: boolean; statusCode?: number } {
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return { message: 'Dexscreener API timeout, retrying...', isRetryable: true };
  }

  if (error.response) {
    const status = error.response.status;
    if (status === 429) {
      return { message: 'Rate limited, waiting...', isRetryable: true, statusCode: status };
    }
    if (status >= 500 && status < 600) {
      return { message: 'Server error, retrying...', isRetryable: true, statusCode: status };
    }
    return { message: `API error: ${status}`, isRetryable: false, statusCode: status };
  }

  if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ENETUNREACH') {
    return { message: 'Network error, check connection', isRetryable: true };
  }

  return { message: 'Network error, check connection', isRetryable: true };
}

/**
 * Executes a function with exponential backoff retry logic
 * @param fn - The async function to execute
 * @param maxRetries - Maximum number of retry attempts
 * @param baseDelayMs - Base delay in milliseconds (doubles each retry)
 * @returns The result of the function
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  baseDelayMs: number = BASE_DELAY_MS
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (!axios.isAxiosError(error)) {
        throw error;
      }

      const { message, isRetryable, statusCode } = categorizeError(error);

      if (!isRetryable || attempt === maxRetries) {
        throw new DexscreenerApiError(message, statusCode, isRetryable);
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt);
      logger.warn(`${message} (attempt ${attempt + 1}/${maxRetries + 1}, waiting ${delayMs}ms)`);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Fetches pool data from Dexscreener API for a given token address
 * Includes 5s timeout, retry logic with exponential backoff (3 retries: 1s, 2s, 4s)
 * @param tokenAddress - The token contract address to look up
 * @returns Array of DexscreenerPair objects, or empty array if none found
 * @throws DexscreenerApiError on unrecoverable API errors
 */
export async function fetchPools(tokenAddress: string): Promise<DexscreenerPair[]> {
  return withRetry(async () => {
    const response = await axios.get<DexscreenerResponse>(
      `${DEXSCREENER_API_BASE}/${tokenAddress}`,
      { timeout: REQUEST_TIMEOUT_MS }
    );
    return response.data.pairs ?? [];
  });
}

/**
 * Result of selectBestPool - either a pool or a specific error condition
 */
export type SelectBestPoolResult =
  | { success: true; pool: PoolInfo }
  | { success: false; reason: 'no_valid_pools' }
  | { success: false; reason: 'insufficient_liquidity'; minLiquidityUsd: number };

/**
 * Selects the best pool from a list of Dexscreener pairs
 * Filters by: chainId === 'bsc' AND labels containing 'v2' or 'v3' AND liquidity >= minLiquidityUsd
 * Sorts by: liquidity.usd descending
 * @param pairs - Array of DexscreenerPair objects to filter and sort
 * @param minLiquidityUsd - Minimum liquidity threshold in USD (default: 0)
 * @returns SelectBestPoolResult indicating success with pool or failure reason
 */
export function selectBestPool(pairs: DexscreenerPair[], minLiquidityUsd: number = 0): SelectBestPoolResult {
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
    return { success: false, reason: 'no_valid_pools' };
  }

  // Filter by minimum liquidity
  const liquidPairs = validPairs.filter(
    (item) => (item.pair.liquidity?.usd ?? 0) >= minLiquidityUsd
  );

  if (liquidPairs.length === 0) {
    return { success: false, reason: 'insufficient_liquidity', minLiquidityUsd };
  }

  // Sort by liquidity.usd descending
  liquidPairs.sort(
    (a, b) => (b.pair.liquidity?.usd ?? 0) - (a.pair.liquidity?.usd ?? 0)
  );

  // Return the best pool as PoolInfo
  const best = liquidPairs[0];
  return {
    success: true,
    pool: {
      pairAddress: best.pair.pairAddress,
      poolType: best.poolType,
      dexId: best.pair.dexId,
      liquidity: best.pair.liquidity?.usd ?? 0,
    },
  };
}
