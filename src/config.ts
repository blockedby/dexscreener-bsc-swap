import dotenv from 'dotenv';
import type { Config } from './types';

/**
 * WBNB (Wrapped BNB) contract address on BSC mainnet
 */
export const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

/**
 * Default BSC RPC endpoint
 */
const DEFAULT_RPC_URL = 'https://bsc-dataseed.binance.org/';

/**
 * Default slippage percentage
 */
const DEFAULT_SLIPPAGE = 1;

/**
 * Loads configuration from environment variables.
 * Calls dotenv.config() to load .env file, then validates required variables.
 *
 * @returns Config object with all configuration values
 * @throws Error if required environment variables are missing
 */
export function loadConfig(): Config {
  // Load .env file
  dotenv.config();

  // Validate required environment variables
  if (!process.env.PRIVATE_KEY) {
    throw new Error('Missing required environment variable: PRIVATE_KEY');
  }

  if (!process.env.UNIVERSAL_SWAP_ADDRESS) {
    throw new Error('Missing required environment variable: UNIVERSAL_SWAP_ADDRESS');
  }

  // Parse slippage as a number, default to 1 if not provided
  const slippage = process.env.SLIPPAGE
    ? parseFloat(process.env.SLIPPAGE)
    : DEFAULT_SLIPPAGE;

  return {
    privateKey: process.env.PRIVATE_KEY,
    rpcUrl: process.env.RPC_URL || DEFAULT_RPC_URL,
    slippage,
    universalSwapAddress: process.env.UNIVERSAL_SWAP_ADDRESS,
  };
}
