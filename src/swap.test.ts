import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { JsonRpcProvider, Wallet, Contract } from 'ethers';
import { calculateAmountOutMin, executeSwap, getExpectedOutput, PANCAKESWAP_V2_ROUTER } from './swap';
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

  describe('executeSwap', () => {
    let mockProvider: JsonRpcProvider;
    let mockWallet: Wallet;
    let mockContract: Contract;
    let mockSwapV2: Mock;
    let mockSwapV3: Mock;

    const mockConfig: Config = {
      privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      rpcUrl: 'https://bsc-dataseed.binance.org/',
      slippage: 1,
      universalSwapAddress: '0xUniversalSwapAddress',
    };

    const mockSwapParams: SwapParams = {
      pairAddress: '0xPairAddress',
      tokenIn: '0xTokenIn',
      amountIn: 1000000000000000000n, // 1 token
      amountOutMin: 990000000000000000n, // 0.99 token (1% slippage)
      slippageBps: 100, // 1% slippage in basis points
      recipient: '0xRecipient',
      poolType: 'v2' as PoolLabel,
    };

    beforeEach(() => {
      vi.clearAllMocks();

      // Mock provider
      mockProvider = {} as JsonRpcProvider;

      // Mock swap functions
      mockSwapV2 = vi.fn().mockResolvedValue({
        hash: '0xTransactionHashV2',
        wait: vi.fn().mockResolvedValue({}),
      });
      mockSwapV3 = vi.fn().mockResolvedValue({
        hash: '0xTransactionHashV3',
        wait: vi.fn().mockResolvedValue({}),
      });

      // Mock contract
      mockContract = {
        swapV2: mockSwapV2,
        swapV3: mockSwapV3,
      } as unknown as Contract;

      // Mock wallet
      mockWallet = {} as Wallet;

      // Setup mocked constructors
      (Wallet as unknown as Mock).mockReturnValue(mockWallet);
      (Contract as unknown as Mock).mockReturnValue(mockContract);
    });

    it('should create wallet from config.privateKey', async () => {
      await executeSwap(mockSwapParams, mockConfig, mockProvider);

      expect(Wallet).toHaveBeenCalledWith(mockConfig.privateKey, mockProvider);
    });

    it('should create contract with universalSwapAddress', async () => {
      await executeSwap(mockSwapParams, mockConfig, mockProvider);

      expect(Contract).toHaveBeenCalledWith(
        mockConfig.universalSwapAddress,
        expect.any(Array), // ABI
        mockWallet
      );
    });

    it('should call swapV2 for v2 pool type', async () => {
      const v2Params: SwapParams = { ...mockSwapParams, poolType: 'v2' };

      const result = await executeSwap(v2Params, mockConfig, mockProvider);

      expect(mockSwapV2).toHaveBeenCalledWith(
        v2Params.pairAddress,
        v2Params.tokenIn,
        v2Params.amountIn,
        v2Params.amountOutMin,
        v2Params.recipient
      );
      expect(mockSwapV3).not.toHaveBeenCalled();
      expect(result).toBe('0xTransactionHashV2');
    });

    it('should call swapV3 for v3 pool type', async () => {
      const v3Params: SwapParams = { ...mockSwapParams, poolType: 'v3' };

      const result = await executeSwap(v3Params, mockConfig, mockProvider);

      expect(mockSwapV3).toHaveBeenCalledWith(
        v3Params.pairAddress,
        v3Params.tokenIn,
        v3Params.amountIn,
        v3Params.amountOutMin,
        v3Params.slippageBps,
        v3Params.recipient
      );
      expect(mockSwapV2).not.toHaveBeenCalled();
      expect(result).toBe('0xTransactionHashV3');
    });

    it('should pass slippageBps to V3 contract as 5th argument', async () => {
      const v3Params: SwapParams = { ...mockSwapParams, poolType: 'v3', slippageBps: 250 }; // 2.5%

      await executeSwap(v3Params, mockConfig, mockProvider);

      // Verify slippageBps is passed as the 5th argument (index 4)
      const callArgs = mockSwapV3.mock.calls[0];
      expect(callArgs).toHaveLength(6); // V3 has 6 arguments
      expect(callArgs[4]).toBe(250); // slippageBps is the 5th argument
    });

    it('should NOT pass slippageBps to V2 contract (different signature)', async () => {
      const v2Params: SwapParams = { ...mockSwapParams, poolType: 'v2', slippageBps: 100 };

      await executeSwap(v2Params, mockConfig, mockProvider);

      // Verify V2 is called with only 5 arguments (no slippageBps)
      const callArgs = mockSwapV2.mock.calls[0];
      expect(callArgs).toHaveLength(5); // V2 has only 5 arguments
      // Verify none of the arguments is slippageBps (100)
      expect(callArgs).toEqual([
        v2Params.pairAddress,
        v2Params.tokenIn,
        v2Params.amountIn,
        v2Params.amountOutMin,
        v2Params.recipient,
      ]);
      // Explicitly verify slippageBps is NOT in the call
      expect(callArgs).not.toContain(v2Params.slippageBps);
    });

    it('should return transaction hash', async () => {
      const result = await executeSwap(mockSwapParams, mockConfig, mockProvider);

      expect(result).toBe('0xTransactionHashV2');
    });

    it('should propagate errors from contract call', async () => {
      const error = new Error('Transaction failed');
      mockSwapV2.mockRejectedValue(error);

      await expect(executeSwap(mockSwapParams, mockConfig, mockProvider)).rejects.toThrow(
        'Transaction failed'
      );
    });

    it('should pass correct ABI to Contract constructor', async () => {
      await executeSwap(mockSwapParams, mockConfig, mockProvider);

      // Verify ABI contains swapV2 and swapV3 function definitions
      const contractCall = (Contract as unknown as Mock).mock.calls[0];
      const abi = contractCall[1];

      expect(abi).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'swapV2',
            type: 'function',
          }),
          expect.objectContaining({
            name: 'swapV3',
            type: 'function',
          }),
        ])
      );
    });
  });
});
