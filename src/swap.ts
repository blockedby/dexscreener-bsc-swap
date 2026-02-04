import { JsonRpcProvider, Wallet, Contract, parseUnits, Interface, AbiCoder } from 'ethers';
import type { SwapParams, Config } from './types';

/**
 * Default base fee in gwei if provider doesn't return fee data
 */
export const DEFAULT_BASE_FEE_GWEI = '5';

/**
 * Priority fee for BSC transactions (3 gwei is standard)
 */
export const BSC_PRIORITY_FEE_GWEI = '3';

/**
 * Buffer percentage to add to base fee (20%)
 */
export const GAS_FEE_BUFFER_PERCENT = 20n;

/**
 * PancakeSwap V2 Router address on BSC mainnet
 */
export const PANCAKESWAP_V2_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';

/**
 * PancakeSwap V3 SwapRouter address on BSC mainnet
 */
export const PANCAKESWAP_V3_ROUTER = '0x1b81D678ffb9C0263b24A97847620C99d213eB14';

/**
 * WBNB address on BSC mainnet
 */
const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

/**
 * Default V3 pool fee (0.25% = 2500 bps, common on PancakeSwap V3)
 */
export const DEFAULT_V3_POOL_FEE = 2500;

/**
 * PancakeSwap Infinity Universal Router address on BSC mainnet
 * Supports both V2 and V3 swaps via execute() function
 */
export const PANCAKESWAP_UNIVERSAL_ROUTER = '0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB';

/**
 * Uniswap Universal Router address on BSC mainnet
 */
export const UNISWAP_UNIVERSAL_ROUTER = '0x5dc88340e1c5c6366864ee415d6034cadd1a9897';

/**
 * Universal Router command codes
 */
export const UNIVERSAL_ROUTER_COMMANDS = {
  V3_SWAP_EXACT_IN: 0x00,
  V2_SWAP_EXACT_IN: 0x08,
} as const;

/**
 * ABI for PancakeSwap V2 Router - getAmountsOut and swapExactETHForTokens
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
  {
    name: 'swapExactETHForTokens',
    type: 'function',
    inputs: [
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'payable',
  },
];

/**
 * ABI for PancakeSwap V3 SwapRouter - multicall and exactInputSingle
 */
const PANCAKESWAP_V3_ROUTER_ABI = [
  {
    name: 'multicall',
    type: 'function',
    inputs: [
      { name: 'deadline', type: 'uint256' },
      { name: 'data', type: 'bytes[]' },
    ],
    outputs: [{ name: 'results', type: 'bytes[]' }],
    stateMutability: 'payable',
  },
  {
    name: 'exactInputSingle',
    type: 'function',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
  },
];

/**
 * ABI for PancakeSwap Universal Router - execute function
 */
const UNIVERSAL_ROUTER_ABI = [
  {
    name: 'execute',
    type: 'function',
    inputs: [
      { name: 'commands', type: 'bytes' },
      { name: 'inputs', type: 'bytes[]' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
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
 * EIP-1559 gas parameters for transaction
 */
export interface GasParams {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/**
 * Get EIP-1559 gas parameters with buffer for BSC transactions.
 * Fetches current fee data from provider, adds 20% buffer to maxFeePerGas,
 * and sets maxPriorityFeePerGas to 3 gwei (BSC standard).
 *
 * @param provider - JSON RPC provider for BSC
 * @returns Gas parameters with maxFeePerGas and maxPriorityFeePerGas
 */
export async function getGasParams(provider: JsonRpcProvider): Promise<GasParams> {
  const feeData = await provider.getFeeData();
  const baseFee = feeData.maxFeePerGas ?? parseUnits(DEFAULT_BASE_FEE_GWEI, 'gwei');

  // Add 20% buffer to base fee
  const maxFeePerGas = baseFee * (100n + GAS_FEE_BUFFER_PERCENT) / 100n;

  // BSC standard priority fee is 3 gwei
  const maxPriorityFeePerGas = parseUnits(BSC_PRIORITY_FEE_GWEI, 'gwei');

  return {
    maxFeePerGas,
    maxPriorityFeePerGas,
  };
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
 * Encode exactInputSingle call data for V3 multicall.
 * @deprecated Use encodeV3SwapCommand with Universal Router instead.
 *
 * @param tokenOut - Address of output token
 * @param recipient - Address to receive tokens
 * @param amountIn - Input amount in wei
 * @param amountOutMin - Minimum output amount
 * @param fee - Pool fee tier (default: 2500 = 0.25%)
 * @returns Encoded call data as hex string
 */
export function encodeExactInputSingle(
  tokenOut: string,
  recipient: string,
  amountIn: bigint,
  amountOutMin: bigint,
  fee: number = DEFAULT_V3_POOL_FEE
): string {
  const iface = new Interface(PANCAKESWAP_V3_ROUTER_ABI);
  return iface.encodeFunctionData('exactInputSingle', [{
    tokenIn: WBNB_ADDRESS,
    tokenOut,
    fee,
    recipient,
    amountIn,
    amountOutMinimum: amountOutMin,
    sqrtPriceLimitX96: 0n, // No price limit
  }]);
}

/**
 * Map dexId to Universal Router address.
 * Falls back to PancakeSwap for unknown dexId.
 *
 * @param dexId - DEX identifier from Dexscreener (e.g., 'pancakeswap_v2', 'uniswap_v3')
 * @returns Universal Router address
 */
export function getUniversalRouterAddress(dexId?: string): string {
  if (!dexId) return PANCAKESWAP_UNIVERSAL_ROUTER;

  const normalized = dexId.toLowerCase();
  if (normalized.startsWith('uniswap')) {
    return UNISWAP_UNIVERSAL_ROUTER;
  }
  // PancakeSwap and all other DEXs use PancakeSwap router as fallback
  return PANCAKESWAP_UNIVERSAL_ROUTER;
}

/**
 * Encode V3 path as bytes: tokenIn (20 bytes) + fee (3 bytes) + tokenOut (20 bytes)
 */
function encodeV3Path(tokenIn: string, tokenOut: string, fee: number): string {
  // Remove 0x prefix and pad addresses to 20 bytes (40 hex chars)
  const tokenInHex = tokenIn.slice(2).toLowerCase().padStart(40, '0');
  const tokenOutHex = tokenOut.slice(2).toLowerCase().padStart(40, '0');
  // Fee is 3 bytes (6 hex chars)
  const feeHex = fee.toString(16).padStart(6, '0');
  return '0x' + tokenInHex + feeHex + tokenOutHex;
}

/**
 * Encode V3 swap command input for Universal Router.
 * Format: ABI-encoded (recipient, amountIn, amountOutMin, path, payerIsUser)
 * Path is encoded as bytes: tokenIn (20) + fee (3) + tokenOut (20)
 *
 * @param recipient - Address to receive output tokens
 * @param amountIn - Input amount in wei
 * @param amountOutMin - Minimum output amount
 * @param tokenIn - Input token address
 * @param tokenOut - Output token address
 * @param fee - Pool fee tier (default: 2500 = 0.25%)
 * @returns ABI-encoded input bytes
 */
export function encodeV3SwapCommand(
  recipient: string,
  amountIn: bigint,
  amountOutMin: bigint,
  tokenIn: string,
  tokenOut: string,
  fee: number = DEFAULT_V3_POOL_FEE
): string {
  const abiCoder = AbiCoder.defaultAbiCoder();
  const path = encodeV3Path(tokenIn, tokenOut, fee);
  return abiCoder.encode(
    ['address', 'uint256', 'uint256', 'bytes', 'bool'],
    [recipient, amountIn, amountOutMin, path, true]
  );
}

/**
 * Encode V2 swap command input for Universal Router.
 * Format: ABI-encoded (recipient, amountIn, amountOutMin, path, payerIsUser)
 *
 * @param recipient - Address to receive output tokens
 * @param amountIn - Input amount in wei
 * @param amountOutMin - Minimum output amount
 * @param path - Token path array [tokenIn, tokenOut]
 * @returns ABI-encoded input bytes
 */
export function encodeV2SwapCommand(
  recipient: string,
  amountIn: bigint,
  amountOutMin: bigint,
  path: string[]
): string {
  const abiCoder = AbiCoder.defaultAbiCoder();
  return abiCoder.encode(
    ['address', 'uint256', 'uint256', 'address[]', 'bool'],
    [recipient, amountIn, amountOutMin, path, true]
  );
}

/**
 * Execute a swap using PancakeSwap routers.
 * If config.useUniversalRouter is true, uses Universal Router.
 * Otherwise, uses legacy V2/V3 routers.
 *
 * For V2: Uses swapExactETHForTokens which accepts native BNB and wraps internally.
 * For V3: Uses multicall with exactInputSingle, sending native BNB which the router wraps.
 * Both methods handle BNB wrapping automatically in one transaction.
 *
 * @param params - Swap parameters including token addresses, amounts, deadline
 * @param config - Configuration with private key
 * @param provider - JSON RPC provider for BSC
 * @returns Transaction hash of the swap transaction
 */
export async function executeSwap(
  params: SwapParams,
  config: Config,
  provider: JsonRpcProvider
): Promise<string> {
  // Use Universal Router if enabled
  if (config.useUniversalRouter) {
    return executeUniversalSwap(params, config, provider);
  }

  // Create wallet from private key
  const wallet = new Wallet(config.privateKey, provider);

  // Get EIP-1559 gas parameters with buffer
  const gasParams = await getGasParams(provider);

  let tx;
  if (params.poolType === 'v2') {
    // V2: Use PancakeSwap V2 Router with swapExactETHForTokens
    // This function accepts native BNB and wraps it internally
    const v2Router = new Contract(PANCAKESWAP_V2_ROUTER, PANCAKESWAP_V2_ROUTER_ABI, wallet);

    // Path: WBNB -> tokenOut (router expects WBNB in path but accepts native BNB)
    tx = await v2Router.swapExactETHForTokens(
      params.amountOutMin,
      [WBNB_ADDRESS, params.tokenOut],
      params.recipient,
      params.deadline,
      {
        value: params.amountIn,
        ...gasParams,
      }
    );
  } else {
    // V3: Use PancakeSwap V3 SwapRouter with multicall
    // This allows wrapping BNB and swapping in one transaction
    const v3Router = new Contract(PANCAKESWAP_V3_ROUTER, PANCAKESWAP_V3_ROUTER_ABI, wallet);

    // Encode the exactInputSingle call
    const swapCallData = encodeExactInputSingle(
      params.tokenOut,
      params.recipient,
      params.amountIn,
      params.amountOutMin,
      DEFAULT_V3_POOL_FEE
    );

    // Use multicall with deadline
    tx = await v3Router.multicall(
      params.deadline,
      [swapCallData],
      {
        value: params.amountIn,
        ...gasParams,
      }
    );
  }

  return tx.hash;
}

/**
 * Execute a swap using Universal Router.
 * Supports both V2 and V3 pools via execute() function.
 * Router is selected based on dexId (uniswap → Uniswap, else → PancakeSwap).
 *
 * @param params - Swap parameters including token addresses, amounts, deadline, dexId
 * @param config - Configuration with private key
 * @param provider - JSON RPC provider for BSC
 * @returns Transaction hash of the swap transaction
 */
export async function executeUniversalSwap(
  params: SwapParams,
  config: Config,
  provider: JsonRpcProvider
): Promise<string> {
  const wallet = new Wallet(config.privateKey, provider);
  const gasParams = await getGasParams(provider);

  // Select router based on dexId
  const routerAddress = getUniversalRouterAddress(params.dexId);
  const router = new Contract(routerAddress, UNIVERSAL_ROUTER_ABI, wallet);

  // Build command and input based on pool type
  let commands: string;
  let inputs: string[];

  if (params.poolType === 'v2') {
    commands = '0x' + UNIVERSAL_ROUTER_COMMANDS.V2_SWAP_EXACT_IN.toString(16).padStart(2, '0');
    inputs = [encodeV2SwapCommand(
      params.recipient,
      params.amountIn,
      params.amountOutMin,
      [WBNB_ADDRESS, params.tokenOut]
    )];
  } else {
    commands = '0x' + UNIVERSAL_ROUTER_COMMANDS.V3_SWAP_EXACT_IN.toString(16).padStart(2, '0');
    inputs = [encodeV3SwapCommand(
      params.recipient,
      params.amountIn,
      params.amountOutMin,
      WBNB_ADDRESS,
      params.tokenOut,
      DEFAULT_V3_POOL_FEE
    )];
  }

  const tx = await router.execute(
    commands,
    inputs,
    params.deadline,
    {
      value: params.amountIn,
      ...gasParams,
    }
  );

  return tx.hash;
}
