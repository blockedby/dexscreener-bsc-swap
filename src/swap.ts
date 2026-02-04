import { JsonRpcProvider, Wallet, Contract } from 'ethers';
import type { SwapParams, Config } from './types';

/**
 * PancakeSwap V2 Router address on BSC mainnet
 */
export const PANCAKESWAP_V2_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';

/**
 * ABI for PancakeSwap V2 Router - only getAmountsOut function
 */
const PANCAKESWAP_V2_ROUTER_ABI = [
  {
    name: 'getAmountsOut',
    type: 'function',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'view',
  },
];

/**
 * ABI for the UniversalSwap contract - only the functions we need
 */
const UNIVERSAL_SWAP_ABI = [
  {
    name: 'swapV2',
    type: 'function',
    inputs: [
      { name: 'pair', type: 'address' },
      { name: 'tokenIn', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'swapV3',
    type: 'function',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'tokenIn', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'slippageBps', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
];

/**
 * Get expected output amount from PancakeSwap V2 Router.
 * Calls router.getAmountsOut() to calculate expected output for a swap.
 *
 * @param provider - JSON RPC provider for BSC
 * @param amountIn - Input amount in wei (bigint)
 * @param tokenIn - Address of input token
 * @param tokenOut - Address of output token
 * @returns Expected output amount as bigint
 */
export async function getExpectedOutput(
  provider: JsonRpcProvider,
  amountIn: bigint,
  tokenIn: string,
  tokenOut: string
): Promise<bigint> {
  const router = new Contract(PANCAKESWAP_V2_ROUTER, PANCAKESWAP_V2_ROUTER_ABI, provider);
  const path = [tokenIn, tokenOut];
  const amounts: bigint[] = await router.getAmountsOut(amountIn, path);
  // amounts[0] is amountIn, amounts[1] is expected output
  return amounts[1];
}

/**
 * Calculate minimum output amount with slippage protection.
 * Formula: expectedOutput * (10000 - slippageBps) / 10000
 *
 * @param expectedOutput - Expected output amount from router (bigint)
 * @param slippageBps - Slippage tolerance in basis points (100 = 1%)
 * @returns Minimum output amount as bigint
 */
export function calculateAmountOutMin(expectedOutput: bigint, slippageBps: number): bigint {
  // Validate slippageBps is within reasonable bounds
  if (slippageBps < 0 || slippageBps > 10000) {
    throw new Error('Slippage must be between 0 and 10000 basis points');
  }
  // Use 10000 as base for basis points (100 bps = 1%)
  const slippageMultiplier = BigInt(10000 - Math.floor(slippageBps));
  return (expectedOutput * slippageMultiplier) / 10000n;
}

/**
 * Execute a swap on the UniversalSwap contract.
 * Creates a wallet from the config, connects to the contract,
 * and calls either swapV2() or swapV3() based on the pool type.
 *
 * @param params - Swap parameters including pair address, tokens, amounts
 * @param config - Configuration with private key and contract address
 * @param provider - JSON RPC provider for BSC
 * @returns Transaction hash of the swap transaction
 */
export async function executeSwap(
  params: SwapParams,
  config: Config,
  provider: JsonRpcProvider
): Promise<string> {
  // Create wallet from private key
  const wallet = new Wallet(config.privateKey, provider);

  // Create contract instance
  const contract = new Contract(config.universalSwapAddress, UNIVERSAL_SWAP_ABI, wallet);

  // Execute appropriate swap based on pool type
  let tx;
  if (params.poolType === 'v2') {
    tx = await contract.swapV2(
      params.pairAddress,
      params.tokenIn,
      params.amountIn,
      params.amountOutMin,
      params.recipient
    );
  } else {
    tx = await contract.swapV3(
      params.pairAddress,
      params.tokenIn,
      params.amountIn,
      params.amountOutMin,
      params.slippageBps,
      params.recipient
    );
  }

  return tx.hash;
}
