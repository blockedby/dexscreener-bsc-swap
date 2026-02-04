/**
 * Token information from Dexscreener API
 */
export interface Token {
  address: string;
  name: string;
  symbol: string;
}

/**
 * Liquidity information from Dexscreener API
 * All fields optional as API may omit them
 */
export interface Liquidity {
  usd?: number;
  base?: number;
  quote?: number;
}

/**
 * Pair data from Dexscreener API response
 */
export interface DexscreenerPair {
  chainId: string;
  pairAddress: string;
  baseToken: Token;
  quoteToken: Token;
  labels?: string[];
  liquidity?: Liquidity;
  dexId: string;
  url: string;
}

/**
 * Dexscreener API response wrapper
 */
export interface DexscreenerResponse {
  pairs: DexscreenerPair[];
}

/**
 * Pool label type - v2 or v3 only
 */
export type PoolLabel = 'v2' | 'v3';

/**
 * Selected pool for swap execution
 */
export interface PoolInfo {
  pairAddress: string;
  poolType: PoolLabel;
  dexId: string;
  liquidity: number;
}

/**
 * Parameters for executing a swap
 */
export interface SwapParams {
  pairAddress: string;      // Pool address from Dexscreener
  tokenIn: string;          // Token being swapped in (WBNB address for buy)
  amountIn: bigint;         // Amount in wei
  amountOutMin: bigint;     // Calculated from slippage, for contract
  slippageBps: number;      // Slippage in basis points (100 = 1%) for V3 price limit
  recipient: string;        // Address to receive tokens
  poolType: PoolLabel;      // v2 or v3 - determines which contract function
}

/**
 * Environment configuration
 */
export interface Config {
  privateKey: string;
  rpcUrl: string;
  slippage: number;
  universalSwapAddress: string;
}

/**
 * Type guard to check if a string is a valid pool label (v2 or v3)
 */
export function isValidPoolLabel(label: string): label is PoolLabel {
  return label === 'v2' || label === 'v3';
}
