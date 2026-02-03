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
  tokenAddress: string;
  amountIn: bigint;
  slippage: number;
  recipient: string;
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
