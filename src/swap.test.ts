import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { JsonRpcProvider, Wallet, Contract, parseUnits } from 'ethers';
import {
  calculateAmountOutMin,
  executeSwap,
  getExpectedOutput,
  getGasParams,
  encodeExactInputSingle,
  encodeV2SwapCommand,
  PANCAKESWAP_V2_ROUTER,
  PANCAKESWAP_V3_ROUTER,
  DEFAULT_BASE_FEE_GWEI,
  BSC_PRIORITY_FEE_GWEI,
  GAS_FEE_BUFFER_PERCENT,
  DEFAULT_V3_POOL_FEE,
  UNIVERSAL_ROUTER_COMMANDS,
} from './swap';
import { SwapParams, Config, PoolLabel } from './types';

// Mock ethers
vi.mock('ethers', async () => {
  const actual = await vi.importActual('ethers');
  return {
    ...actual,
    Wallet: vi.fn(),
    Contract: vi.fn(),
  };
});

describe('swap', () => {
  describe('calculateAmountOutMin', () => {
    it('should calculate minimum output with 100 bps (1%) slippage', () => {
      const expectedOutput = 1000n;
      const slippageBps = 100; // 1%

      const result = calculateAmountOutMin(expectedOutput, slippageBps);

      // 1000 * (10000 - 100) / 10000 = 1000 * 9900 / 10000 = 990
      expect(result).toBe(990n);
    });

    it('should calculate minimum output with 0 bps (0%) slippage', () => {
      const expectedOutput = 1000n;
      const slippageBps = 0;

      const result = calculateAmountOutMin(expectedOutput, slippageBps);

      // 1000 * (10000 - 0) / 10000 = 1000
      expect(result).toBe(1000n);
    });

    it('should calculate minimum output with 500 bps (5%) slippage', () => {
      const expectedOutput = 1000n;
      const slippageBps = 500; // 5%

      const result = calculateAmountOutMin(expectedOutput, slippageBps);

      // 1000 * (10000 - 500) / 10000 = 1000 * 9500 / 10000 = 950
      expect(result).toBe(950n);
    });

    it('should handle large amounts correctly', () => {
      // 1 ETH = 10^18 wei
      const expectedOutput = 1000000000000000000n;
      const slippageBps = 100; // 1%

      const result = calculateAmountOutMin(expectedOutput, slippageBps);

      // 10^18 * 9900 / 10000 = 99 * 10^16
      expect(result).toBe(990000000000000000n);
    });

    it('should handle 10000 bps (100%) slippage (edge case)', () => {
      const expectedOutput = 1000n;
      const slippageBps = 10000; // 100%

      const result = calculateAmountOutMin(expectedOutput, slippageBps);

      // 1000 * (10000 - 10000) / 10000 = 0
      expect(result).toBe(0n);
    });

    it('should handle 50 bps (0.5%) slippage', () => {
      const expectedOutput = 1000n;
      const slippageBps = 50; // 0.5%

      const result = calculateAmountOutMin(expectedOutput, slippageBps);

      // 1000 * (10000 - 50) / 10000 = 1000 * 9950 / 10000 = 995
      expect(result).toBe(995n);
    });

    it('should handle 25 bps (0.25%) slippage', () => {
      const expectedOutput = 10000n;
      const slippageBps = 25; // 0.25%

      const result = calculateAmountOutMin(expectedOutput, slippageBps);

      // 10000 * (10000 - 25) / 10000 = 10000 * 9975 / 10000 = 9975
      expect(result).toBe(9975n);
    });

    it('should throw error for negative slippage', () => {
      const expectedOutput = 1000n;
      const slippageBps = -1;

      expect(() => calculateAmountOutMin(expectedOutput, slippageBps)).toThrow(
        'Slippage must be between 0 and 10000 basis points'
      );
    });

    it('should throw error for slippage over 10000 bps', () => {
      const expectedOutput = 1000n;
      const slippageBps = 10001;

      expect(() => calculateAmountOutMin(expectedOutput, slippageBps)).toThrow(
        'Slippage must be between 0 and 10000 basis points'
      );
    });
  });

  describe('getExpectedOutput', () => {
    let mockProvider: JsonRpcProvider;
    let mockGetAmountsOut: Mock;

    beforeEach(() => {
      vi.clearAllMocks();

      mockProvider = {} as JsonRpcProvider;
      mockGetAmountsOut = vi.fn();

      // Mock Contract constructor to return an object with getAmountsOut
      (Contract as unknown as Mock).mockReturnValue({
        getAmountsOut: mockGetAmountsOut,
      });
    });

    it('should call router.getAmountsOut with correct parameters', async () => {
      const amountIn = 1000000000000000000n; // 1 BNB
      const tokenIn = '0xTokenIn';
      const tokenOut = '0xTokenOut';
      const expectedAmounts = [amountIn, 5000000000000000000n]; // 5 tokens out

      mockGetAmountsOut.mockResolvedValue(expectedAmounts);

      await getExpectedOutput(mockProvider, amountIn, tokenIn, tokenOut);

      expect(mockGetAmountsOut).toHaveBeenCalledWith(amountIn, [tokenIn, tokenOut]);
    });

    it('should create Contract with PancakeSwap V2 Router address', async () => {
      const amountIn = 1000000000000000000n;
      const expectedAmounts = [amountIn, 5000000000000000000n];

      mockGetAmountsOut.mockResolvedValue(expectedAmounts);

      await getExpectedOutput(mockProvider, amountIn, '0xTokenIn', '0xTokenOut');

      expect(Contract).toHaveBeenCalledWith(
        PANCAKESWAP_V2_ROUTER,
        expect.any(Array),
        mockProvider
      );
    });

    it('should return the second element (output amount) from amounts array', async () => {
      const amountIn = 1000000000000000000n;
      const expectedOutput = 5000000000000000000n;
      const expectedAmounts = [amountIn, expectedOutput];

      mockGetAmountsOut.mockResolvedValue(expectedAmounts);

      const result = await getExpectedOutput(mockProvider, amountIn, '0xTokenIn', '0xTokenOut');

      expect(result).toBe(expectedOutput);
    });

    it('should propagate errors from router call', async () => {
      mockGetAmountsOut.mockRejectedValue(new Error('Insufficient liquidity'));

      await expect(
        getExpectedOutput(mockProvider, 1000n, '0xTokenIn', '0xTokenOut')
      ).rejects.toThrow('Insufficient liquidity');
    });

    it('should pass correct ABI to Contract constructor', async () => {
      const expectedAmounts = [1000n, 5000n];
      mockGetAmountsOut.mockResolvedValue(expectedAmounts);

      await getExpectedOutput(mockProvider, 1000n, '0xTokenIn', '0xTokenOut');

      const contractCall = (Contract as unknown as Mock).mock.calls[0];
      const abi = contractCall[1];

      expect(abi).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'getAmountsOut',
            type: 'function',
          }),
        ])
      );
    });
  });

  describe('getGasParams', () => {
    let mockProvider: JsonRpcProvider;
    let mockGetFeeData: Mock;

    beforeEach(() => {
      vi.clearAllMocks();

      mockGetFeeData = vi.fn();
      mockProvider = {
        getFeeData: mockGetFeeData,
      } as unknown as JsonRpcProvider;
    });

    it('should return gas params with 20% buffer on maxFeePerGas', async () => {
      const baseFee = parseUnits('5', 'gwei'); // 5 gwei
      mockGetFeeData.mockResolvedValue({
        maxFeePerGas: baseFee,
        maxPriorityFeePerGas: parseUnits('1', 'gwei'),
      });

      const result = await getGasParams(mockProvider);

      // 5 gwei * 120% = 6 gwei
      const expectedMaxFee = baseFee * 120n / 100n;
      expect(result.maxFeePerGas).toBe(expectedMaxFee);
    });

    it('should set maxPriorityFeePerGas to 3 gwei (BSC standard)', async () => {
      mockGetFeeData.mockResolvedValue({
        maxFeePerGas: parseUnits('5', 'gwei'),
        maxPriorityFeePerGas: parseUnits('1', 'gwei'),
      });

      const result = await getGasParams(mockProvider);

      const expected3Gwei = parseUnits(BSC_PRIORITY_FEE_GWEI, 'gwei');
      expect(result.maxPriorityFeePerGas).toBe(expected3Gwei);
    });

    it('should use default base fee of 5 gwei when provider returns null', async () => {
      mockGetFeeData.mockResolvedValue({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
      });

      const result = await getGasParams(mockProvider);

      // Default 5 gwei * 120% = 6 gwei
      const defaultBaseFee = parseUnits(DEFAULT_BASE_FEE_GWEI, 'gwei');
      const expectedMaxFee = defaultBaseFee * 120n / 100n;
      expect(result.maxFeePerGas).toBe(expectedMaxFee);
    });

    it('should call provider.getFeeData()', async () => {
      mockGetFeeData.mockResolvedValue({
        maxFeePerGas: parseUnits('5', 'gwei'),
        maxPriorityFeePerGas: parseUnits('1', 'gwei'),
      });

      await getGasParams(mockProvider);

      expect(mockGetFeeData).toHaveBeenCalledTimes(1);
    });

    it('should correctly apply 20% buffer to various base fees', async () => {
      // Test with 10 gwei - should become 12 gwei
      const baseFee = parseUnits('10', 'gwei');
      mockGetFeeData.mockResolvedValue({
        maxFeePerGas: baseFee,
        maxPriorityFeePerGas: parseUnits('1', 'gwei'),
      });

      const result = await getGasParams(mockProvider);

      const expectedMaxFee = baseFee * (100n + GAS_FEE_BUFFER_PERCENT) / 100n;
      expect(result.maxFeePerGas).toBe(expectedMaxFee);
      // 10 gwei * 1.2 = 12 gwei
      expect(result.maxFeePerGas).toBe(parseUnits('12', 'gwei'));
    });

    it('should propagate errors from provider.getFeeData()', async () => {
      mockGetFeeData.mockRejectedValue(new Error('Network error'));

      await expect(getGasParams(mockProvider)).rejects.toThrow('Network error');
    });
  });

  describe('encodeExactInputSingle', () => {
    // Valid Ethereum addresses for testing
    const validTokenOut = '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'; // CAKE on BSC
    const validRecipient = '0x1234567890123456789012345678901234567890';

    it('should return a hex string starting with 0x', () => {
      const result = encodeExactInputSingle(
        validTokenOut,
        validRecipient,
        1000000000000000000n,
        990000000000000000n
      );

      expect(result).toMatch(/^0x/);
    });

    it('should use default pool fee when not specified', () => {
      const result = encodeExactInputSingle(
        validTokenOut,
        validRecipient,
        1000000000000000000n,
        990000000000000000n
      );

      // The encoded data should contain the fee, we just verify it doesn't throw
      expect(result.length).toBeGreaterThan(10);
    });

    it('should accept custom pool fee', () => {
      const result = encodeExactInputSingle(
        validTokenOut,
        validRecipient,
        1000000000000000000n,
        990000000000000000n,
        3000 // 0.3% fee
      );

      expect(result).toMatch(/^0x/);
    });
  });

  describe('encodeV2SwapCommand', () => {
    const validRecipient = '0x1234567890123456789012345678901234567890';
    const validTokenOut = '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82';
    const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

    it('should return a hex string starting with 0x', () => {
      const result = encodeV2SwapCommand(
        validRecipient,
        1000000000000000000n,
        990000000000000000n,
        [WBNB_ADDRESS, validTokenOut]
      );

      expect(result).toMatch(/^0x/);
    });

    it('should encode V2 swap input with correct ABI structure', () => {
      const result = encodeV2SwapCommand(
        validRecipient,
        1000000000000000000n,
        990000000000000000n,
        [WBNB_ADDRESS, validTokenOut]
      );

      // Should be ABI-encoded: (address, uint256, uint256, address[], bool)
      // Minimum length: 4 bytes selector + 5 * 32 bytes params + dynamic array
      expect(result.length).toBeGreaterThan(200);
    });

    it('should set payerIsUser to true', () => {
      const result = encodeV2SwapCommand(
        validRecipient,
        1000000000000000000n,
        990000000000000000n,
        [WBNB_ADDRESS, validTokenOut]
      );

      // payerIsUser (bool=true) is encoded as 0x01 at fixed position (5th param = offset 128)
      // After 0x prefix: recipient(32) + amountIn(32) + amountOutMin(32) + arrayOffset(32) + payerIsUser(32)
      // = 2 + 64*4 + 64 = 322, so payerIsUser at chars 258-322
      const payerIsUserSlot = result.slice(2 + 64*4, 2 + 64*5);
      expect(payerIsUserSlot).toBe('0000000000000000000000000000000000000000000000000000000000000001');
    });
  });

  describe('executeSwap', () => {
    let mockProvider: JsonRpcProvider;
    let mockWallet: Wallet;
    let mockSwapExactETHForTokens: Mock;
    let mockMulticall: Mock;
    let mockGetFeeData: Mock;

    const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
    // Valid Ethereum addresses for testing
    const validTokenOut = '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'; // CAKE on BSC
    const validRecipient = '0x1234567890123456789012345678901234567890';
    const validPairAddress = '0xA527a61703D82139F8a06Bc30097cC9CAA2df5A6';

    const mockConfig: Config = {
      privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      rpcUrl: 'https://bsc-dataseed.binance.org/',
      slippage: 1,
      universalSwapAddress: '0x2222222222222222222222222222222222222222',
      deadlineSeconds: 300,
      minLiquidityUsd: 10000,
    };

    const mockSwapParams: SwapParams = {
      pairAddress: validPairAddress,
      tokenIn: WBNB_ADDRESS,
      tokenOut: validTokenOut,
      amountIn: 1000000000000000000n, // 1 BNB
      amountOutMin: 990000000000000000n, // 0.99 token (1% slippage)
      slippageBps: 100, // 1% slippage in basis points
      recipient: validRecipient,
      poolType: 'v2' as PoolLabel,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
    };

    // Expected gas params based on mock fee data (5 gwei * 1.2 = 6 gwei)
    const expectedGasParams = {
      maxFeePerGas: parseUnits('6', 'gwei'),
      maxPriorityFeePerGas: parseUnits('3', 'gwei'),
    };

    beforeEach(() => {
      vi.clearAllMocks();

      // Mock getFeeData
      mockGetFeeData = vi.fn().mockResolvedValue({
        maxFeePerGas: parseUnits('5', 'gwei'),
        maxPriorityFeePerGas: parseUnits('1', 'gwei'),
      });

      // Mock provider with getFeeData
      mockProvider = {
        getFeeData: mockGetFeeData,
      } as unknown as JsonRpcProvider;

      // Mock router functions
      mockSwapExactETHForTokens = vi.fn().mockResolvedValue({
        hash: '0xTransactionHashV2',
        wait: vi.fn().mockResolvedValue({}),
      });
      mockMulticall = vi.fn().mockResolvedValue({
        hash: '0xTransactionHashV3',
        wait: vi.fn().mockResolvedValue({}),
      });

      // Mock wallet
      mockWallet = {} as Wallet;

      // Setup mocked constructors
      (Wallet as unknown as Mock).mockReturnValue(mockWallet);
      (Contract as unknown as Mock).mockImplementation((address: string) => {
        if (address === PANCAKESWAP_V2_ROUTER) {
          return { swapExactETHForTokens: mockSwapExactETHForTokens };
        }
        if (address === PANCAKESWAP_V3_ROUTER) {
          return { multicall: mockMulticall };
        }
        return {};
      });
    });

    it('should create wallet from config.privateKey', async () => {
      await executeSwap(mockSwapParams, mockConfig, mockProvider);

      expect(Wallet).toHaveBeenCalledWith(mockConfig.privateKey, mockProvider);
    });

    it('should call getFeeData for EIP-1559 gas pricing', async () => {
      await executeSwap(mockSwapParams, mockConfig, mockProvider);

      expect(mockGetFeeData).toHaveBeenCalledTimes(1);
    });

    it('should use V2 Router for v2 pool type', async () => {
      const v2Params: SwapParams = { ...mockSwapParams, poolType: 'v2' };

      await executeSwap(v2Params, mockConfig, mockProvider);

      expect(Contract).toHaveBeenCalledWith(
        PANCAKESWAP_V2_ROUTER,
        expect.any(Array),
        mockWallet
      );
    });

    it('should use V3 Router for v3 pool type', async () => {
      const v3Params: SwapParams = { ...mockSwapParams, poolType: 'v3' };

      await executeSwap(v3Params, mockConfig, mockProvider);

      expect(Contract).toHaveBeenCalledWith(
        PANCAKESWAP_V3_ROUTER,
        expect.any(Array),
        mockWallet
      );
    });

    it('should call swapExactETHForTokens for V2 with correct params', async () => {
      const v2Params: SwapParams = { ...mockSwapParams, poolType: 'v2' };

      const result = await executeSwap(v2Params, mockConfig, mockProvider);

      expect(mockSwapExactETHForTokens).toHaveBeenCalledWith(
        v2Params.amountOutMin,
        [WBNB_ADDRESS, v2Params.tokenOut],
        v2Params.recipient,
        v2Params.deadline,
        expect.objectContaining({
          value: v2Params.amountIn,
          maxFeePerGas: expectedGasParams.maxFeePerGas,
          maxPriorityFeePerGas: expectedGasParams.maxPriorityFeePerGas,
        })
      );
      expect(result).toBe('0xTransactionHashV2');
    });

    it('should call multicall for V3 with correct params', async () => {
      const v3Params: SwapParams = { ...mockSwapParams, poolType: 'v3' };

      const result = await executeSwap(v3Params, mockConfig, mockProvider);

      expect(mockMulticall).toHaveBeenCalledWith(
        v3Params.deadline,
        expect.any(Array), // encoded call data
        expect.objectContaining({
          value: v3Params.amountIn,
          maxFeePerGas: expectedGasParams.maxFeePerGas,
          maxPriorityFeePerGas: expectedGasParams.maxPriorityFeePerGas,
        })
      );
      expect(result).toBe('0xTransactionHashV3');
    });

    it('should include gas params with 20% buffer in V2 transaction', async () => {
      await executeSwap(mockSwapParams, mockConfig, mockProvider);

      const callArgs = mockSwapExactETHForTokens.mock.calls[0];
      const txOptions = callArgs[4]; // Last argument is tx options

      expect(txOptions.maxFeePerGas).toBe(expectedGasParams.maxFeePerGas);
      expect(txOptions.maxPriorityFeePerGas).toBe(expectedGasParams.maxPriorityFeePerGas);
    });

    it('should include gas params with 20% buffer in V3 transaction', async () => {
      const v3Params: SwapParams = { ...mockSwapParams, poolType: 'v3' };

      await executeSwap(v3Params, mockConfig, mockProvider);

      const callArgs = mockMulticall.mock.calls[0];
      const txOptions = callArgs[2]; // Last argument is tx options

      expect(txOptions.maxFeePerGas).toBe(expectedGasParams.maxFeePerGas);
      expect(txOptions.maxPriorityFeePerGas).toBe(expectedGasParams.maxPriorityFeePerGas);
    });

    it('should send native BNB as value in V2 transaction', async () => {
      await executeSwap(mockSwapParams, mockConfig, mockProvider);

      const callArgs = mockSwapExactETHForTokens.mock.calls[0];
      const txOptions = callArgs[4];

      expect(txOptions.value).toBe(mockSwapParams.amountIn);
    });

    it('should send native BNB as value in V3 transaction', async () => {
      const v3Params: SwapParams = { ...mockSwapParams, poolType: 'v3' };

      await executeSwap(v3Params, mockConfig, mockProvider);

      const callArgs = mockMulticall.mock.calls[0];
      const txOptions = callArgs[2];

      expect(txOptions.value).toBe(v3Params.amountIn);
    });

    it('should return transaction hash for V2', async () => {
      const result = await executeSwap(mockSwapParams, mockConfig, mockProvider);

      expect(result).toBe('0xTransactionHashV2');
    });

    it('should return transaction hash for V3', async () => {
      const v3Params: SwapParams = { ...mockSwapParams, poolType: 'v3' };

      const result = await executeSwap(v3Params, mockConfig, mockProvider);

      expect(result).toBe('0xTransactionHashV3');
    });

    it('should propagate errors from V2 router call', async () => {
      const error = new Error('Transaction failed');
      mockSwapExactETHForTokens.mockRejectedValue(error);

      await expect(executeSwap(mockSwapParams, mockConfig, mockProvider)).rejects.toThrow(
        'Transaction failed'
      );
    });

    it('should propagate errors from V3 router call', async () => {
      const v3Params: SwapParams = { ...mockSwapParams, poolType: 'v3' };
      const error = new Error('V3 Transaction failed');
      mockMulticall.mockRejectedValue(error);

      await expect(executeSwap(v3Params, mockConfig, mockProvider)).rejects.toThrow(
        'V3 Transaction failed'
      );
    });

    it('should pass correct path to V2 router: WBNB -> tokenOut', async () => {
      await executeSwap(mockSwapParams, mockConfig, mockProvider);

      const callArgs = mockSwapExactETHForTokens.mock.calls[0];
      const path = callArgs[1];

      expect(path).toEqual([WBNB_ADDRESS, mockSwapParams.tokenOut]);
    });
  });
});
