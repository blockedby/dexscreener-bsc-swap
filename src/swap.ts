import { JsonRpcProvider, Wallet, Contract } from 'ethers';
import type { SwapParams, Config } from './types';

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
 * Calculate minimum output amount with slippage protection.
 * Formula: amountIn * (100 - slippage) / 100
 *
 * @param amountIn - Input amount in wei (bigint)
 * @param slippage - Slippage tolerance as a percentage (e.g., 1 for 1%)
 * @returns Minimum output amount as bigint
 */
export function calculateAmountOutMin(amountIn: bigint, slippage: number): bigint {
  // Handle fractional slippage by multiplying by 1000 for precision
  // (100 - slippage) * 10 gives us 3 decimal places of precision
  const slippageMultiplier = BigInt(Math.floor((100 - slippage) * 10));
  return (amountIn * slippageMultiplier) / 1000n;
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
