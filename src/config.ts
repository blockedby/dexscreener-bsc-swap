import dotenv from 'dotenv';
import type { Config } from './types';

/**
 * WBNB (Wrapped BNB) contract address on BSC mainnet
 */
export const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

/**
 * Validates slippage input value.
 *
 * @param value - The slippage percentage to validate
 * @returns The validated slippage value
 * @throws Error if value is NaN, out of bounds, or has more than 2 decimal places
 */
export function validateSlippage(value: number): number {
  // Check for NaN
  if (Number.isNaN(value)) {
    throw new Error('Invalid slippage: not a number');
  }

  // Check bounds: 0.01 <= slippage <= 99.99
  if (value < 0.01 || value > 99.99) {
    throw new Error('Slippage must be between 0.01% and 99.99%');
  }

  // Check for max 2 decimal places
  // Multiply by 100 and check if it's an integer (accounting for floating point precision)
  const multiplied = value * 100;
  if (Math.abs(multiplied - Math.round(multiplied)) > 1e-9) {
    throw new Error('Slippage must have at most 2 decimal places');
  }

  return value;
}

/**
 * Default BSC RPC endpoint
 */
const DEFAULT_RPC_URL = 'https://bsc-dataseed.binance.org/';

/**
 * Default slippage percentage
 */
const DEFAULT_SLIPPAGE = 1;

/**
 * Default transaction deadline in seconds
 */
const DEFAULT_DEADLINE_SECONDS = 30;

/**
 * Default minimum liquidity in USD
 */
const DEFAULT_MIN_LIQUIDITY_USD = 1000;

/**
 * Default: use Universal Router for swaps
 */
const DEFAULT_USE_UNIVERSAL_ROUTER = false;

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

  // Check PRIVATE_KEY is not empty or whitespace-only
  const trimmedPrivateKey = process.env.PRIVATE_KEY.trim();
  if (trimmedPrivateKey === '') {
    throw new Error('PRIVATE_KEY cannot be empty or whitespace');
  }


  // Parse slippage as a number, default to 1 if not provided
  const slippage = process.env.SLIPPAGE
    ? parseFloat(process.env.SLIPPAGE)
    : DEFAULT_SLIPPAGE;

  // Parse deadline as an integer, default to 30 if not provided
  const deadlineSeconds = process.env.DEADLINE_SECONDS
    ? parseInt(process.env.DEADLINE_SECONDS, 10)
    : DEFAULT_DEADLINE_SECONDS;

  // Parse minimum liquidity as a number, default to 1000 if not provided
  const minLiquidityUsd = process.env.MIN_LIQUIDITY_USD
    ? parseFloat(process.env.MIN_LIQUIDITY_USD)
    : DEFAULT_MIN_LIQUIDITY_USD;

  // Parse USE_UNIVERSAL_ROUTER as boolean
  const useUniversalRouter = process.env.USE_UNIVERSAL_ROUTER
    ? process.env.USE_UNIVERSAL_ROUTER.toLowerCase() === 'true'
    : DEFAULT_USE_UNIVERSAL_ROUTER;

  return {
    privateKey: trimmedPrivateKey,
    rpcUrl: process.env.RPC_URL || DEFAULT_RPC_URL,
    slippage,
    deadlineSeconds,
    minLiquidityUsd,
    useUniversalRouter,
  };
}
