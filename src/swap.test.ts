import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { JsonRpcProvider, Wallet, Contract } from 'ethers';
import { calculateAmountOutMin, executeSwap } from './swap';
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
    it('should calculate minimum output with 1% slippage', () => {
      const amountIn = 1000n;
      const slippage = 1;

      const result = calculateAmountOutMin(amountIn, slippage);

      // 1000 * (100 - 1) / 100 = 990
      expect(result).toBe(990n);
    });

    it('should calculate minimum output with 0% slippage', () => {
      const amountIn = 1000n;
      const slippage = 0;

      const result = calculateAmountOutMin(amountIn, slippage);

      // 1000 * (100 - 0) / 100 = 1000
      expect(result).toBe(1000n);
    });

    it('should calculate minimum output with 5% slippage', () => {
      const amountIn = 1000n;
      const slippage = 5;

      const result = calculateAmountOutMin(amountIn, slippage);

      // 1000 * (100 - 5) / 100 = 950
      expect(result).toBe(950n);
    });

    it('should handle large amounts correctly', () => {
      // 1 ETH = 10^18 wei
      const amountIn = 1000000000000000000n;
      const slippage = 1;

      const result = calculateAmountOutMin(amountIn, slippage);

      // 10^18 * 99 / 100 = 99 * 10^16
      expect(result).toBe(990000000000000000n);
    });

    it('should handle 100% slippage (edge case)', () => {
      const amountIn = 1000n;
      const slippage = 100;

      const result = calculateAmountOutMin(amountIn, slippage);

      // 1000 * (100 - 100) / 100 = 0
      expect(result).toBe(0n);
    });

    it('should handle fractional slippage rounded down', () => {
      // Note: BigInt division truncates, so 1000 * 97.5 / 100 would need careful handling
      // But since slippage is passed as a number and we use (100 - slippage),
      // we need to handle this at the formula level
      const amountIn = 1000n;
      const slippage = 0.5;

      const result = calculateAmountOutMin(amountIn, slippage);

      // 1000 * (100 - 0.5) / 100 = 1000 * 99.5 / 100 = 995
      expect(result).toBe(995n);
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
