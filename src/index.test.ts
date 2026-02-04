import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Config, DexscreenerPair, PoolInfo } from './types';

// Mock all dependencies before importing
vi.mock('./config', () => ({
  loadConfig: vi.fn(),
  WBNB_ADDRESS: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
}));

vi.mock('./dexscreener', () => ({
  fetchPools: vi.fn(),
  selectBestPool: vi.fn(),
}));

vi.mock('./swap', () => ({
  executeSwap: vi.fn(),
  calculateAmountOutMin: vi.fn(),
  getExpectedOutput: vi.fn(),
}));

vi.mock('./logger', () => ({
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('ethers', () => ({
  parseEther: vi.fn((value: string) => BigInt(Math.floor(parseFloat(value) * 1e18))),
  JsonRpcProvider: vi.fn().mockImplementation(() => ({})),
  Wallet: vi.fn().mockImplementation(() => ({
    address: '0xWalletAddress',
  })),
}));

// Import after mocks are set up
import { runSwap } from './index';
import { loadConfig, WBNB_ADDRESS } from './config';
import { fetchPools, selectBestPool } from './dexscreener';
import { executeSwap, calculateAmountOutMin, getExpectedOutput } from './swap';
import { info, error } from './logger';
import { parseEther, JsonRpcProvider, Wallet } from 'ethers';

describe('CLI index.ts', () => {
  const mockConfig: Config = {
    privateKey: '0xTestPrivateKey',
    rpcUrl: 'https://test-rpc.example.com',
    slippage: 1,
    universalSwapAddress: '0xUniversalSwapAddress',
  };

  const mockPairs: DexscreenerPair[] = [
    {
      chainId: 'bsc',
      pairAddress: '0xPairAddress1',
      baseToken: { address: '0xTokenAddress', name: 'Test Token', symbol: 'TEST' },
      quoteToken: { address: WBNB_ADDRESS, name: 'Wrapped BNB', symbol: 'WBNB' },
      labels: ['v2'],
      liquidity: { usd: 1234567 },
      dexId: 'biswap',
      url: 'https://dexscreener.com/bsc/0xPairAddress1',
    },
    {
      chainId: 'bsc',
      pairAddress: '0xPairAddress2',
      baseToken: { address: '0xTokenAddress', name: 'Test Token', symbol: 'TEST' },
      quoteToken: { address: WBNB_ADDRESS, name: 'Wrapped BNB', symbol: 'WBNB' },
      labels: ['v3'],
      liquidity: { usd: 500000 },
      dexId: 'pancakeswap',
      url: 'https://dexscreener.com/bsc/0xPairAddress2',
    },
  ];

  const mockPool: PoolInfo = {
    pairAddress: '0xPairAddress1',
    poolType: 'v2',
    dexId: 'biswap',
    liquidity: 1234567,
  };

  // Expected output from router (e.g., 100 tokens for 0.01 BNB)
  const mockExpectedOutput = BigInt(100000000000000000000); // 100 tokens

  beforeEach(() => {
    vi.clearAllMocks();
    (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue(mockConfig);
    (fetchPools as ReturnType<typeof vi.fn>).mockResolvedValue(mockPairs);
    (selectBestPool as ReturnType<typeof vi.fn>).mockReturnValue(mockPool);
    (executeSwap as ReturnType<typeof vi.fn>).mockResolvedValue('0xTransactionHash');
    (getExpectedOutput as ReturnType<typeof vi.fn>).mockResolvedValue(mockExpectedOutput);
    (calculateAmountOutMin as ReturnType<typeof vi.fn>).mockReturnValue(BigInt(99000000000000000000)); // 99 tokens (1% slippage)
  });

  describe('runSwap function', () => {
    it('should load config on execution', async () => {
      await runSwap('0xTokenAddress', '0.01');
      expect(loadConfig).toHaveBeenCalledTimes(1);
    });

    it('should fetch pools for the given token address', async () => {
      const tokenAddress = '0xTokenAddress';
      await runSwap(tokenAddress, '0.01');
      expect(fetchPools).toHaveBeenCalledWith(tokenAddress);
    });

    it('should select best pool from fetched pairs', async () => {
      await runSwap('0xTokenAddress', '0.01');
      expect(selectBestPool).toHaveBeenCalledWith(mockPairs);
    });

    it('should get expected output from router before calculating amountOutMin', async () => {
      await runSwap('0xTokenAddress', '0.01');

      // getExpectedOutput should be called with provider, amountIn, WBNB, tokenOut
      expect(getExpectedOutput).toHaveBeenCalledWith(
        expect.any(Object), // provider
        expect.any(BigInt), // amountIn
        WBNB_ADDRESS,       // tokenIn (WBNB)
        '0xTokenAddress'    // tokenOut
      );
    });

    it('should calculate amountOutMin from expected output, not input amount', async () => {
      await runSwap('0xTokenAddress', '0.01');

      // calculateAmountOutMin should be called with expected output and slippageBps
      expect(calculateAmountOutMin).toHaveBeenCalledWith(
        mockExpectedOutput, // expectedOutput from router
        100                 // slippageBps (1% = 100 bps)
      );
    });

    it('should execute swap with correct parameters', async () => {
      await runSwap('0xTokenAddress', '0.01');

      expect(executeSwap).toHaveBeenCalledTimes(1);
      const swapCall = (executeSwap as ReturnType<typeof vi.fn>).mock.calls[0];

      // Check swap params
      expect(swapCall[0]).toMatchObject({
        pairAddress: '0xPairAddress1',
        tokenIn: WBNB_ADDRESS,
        poolType: 'v2',
        slippageBps: 100, // 1% slippage = 100 basis points
      });

      // Check config is passed
      expect(swapCall[1]).toBe(mockConfig);
    });

    it('should return transaction hash on successful swap', async () => {
      const result = await runSwap('0xTokenAddress', '0.01');
      expect(result).toBe('0xTransactionHash');
    });

    it('should throw error when no pools are found', async () => {
      (fetchPools as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (selectBestPool as ReturnType<typeof vi.fn>).mockReturnValue(null);

      await expect(runSwap('0xTokenAddress', '0.01')).rejects.toThrow(
        'No suitable pools found'
      );
    });

    it('should throw error when selectBestPool returns null', async () => {
      (selectBestPool as ReturnType<typeof vi.fn>).mockReturnValue(null);

      await expect(runSwap('0xTokenAddress', '0.01')).rejects.toThrow(
        'No suitable pools found'
      );
    });

    it('should log info messages during execution', async () => {
      await runSwap('0xTokenAddress', '0.01');

      expect(info).toHaveBeenCalledWith(expect.stringContaining('Fetching pools'));
      expect(info).toHaveBeenCalledWith(expect.stringContaining('Found'));
      expect(info).toHaveBeenCalledWith(expect.stringContaining('Selected'));
      expect(info).toHaveBeenCalledWith(expect.stringContaining('expected output'));
      expect(info).toHaveBeenCalledWith(expect.stringContaining('Executing'));
      expect(info).toHaveBeenCalledWith(expect.stringContaining('TX Hash'));
    });

    it('should log error and throw when swap fails', async () => {
      const swapError = new Error('Swap failed');
      (executeSwap as ReturnType<typeof vi.fn>).mockRejectedValue(swapError);

      await expect(runSwap('0xTokenAddress', '0.01')).rejects.toThrow('Swap failed');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Swap failed'));
    });

    it('should propagate error when getExpectedOutput fails', async () => {
      (getExpectedOutput as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Insufficient liquidity')
      );

      await expect(runSwap('0xTokenAddress', '0.01')).rejects.toThrow('Insufficient liquidity');
    });
  });

  describe('slippage handling with expected output', () => {
    it('should use CLI slippage (in bps) when provided', async () => {
      await runSwap('0xTokenAddress', '0.01', '2');

      // calculateAmountOutMin should be called with slippageBps = 200 (2%)
      expect(calculateAmountOutMin).toHaveBeenCalledWith(
        mockExpectedOutput,
        200 // 2% = 200 bps
      );
    });

    it('should use config slippage (in bps) when CLI slippage is not provided', async () => {
      const configWithSlippage = { ...mockConfig, slippage: 0.5 };
      (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue(configWithSlippage);

      await runSwap('0xTokenAddress', '0.01');

      // calculateAmountOutMin should be called with slippageBps = 50 (0.5%)
      expect(calculateAmountOutMin).toHaveBeenCalledWith(
        mockExpectedOutput,
        50 // 0.5% = 50 bps
      );
    });

    it('should use config slippage when CLI slippage not provided', async () => {
      await runSwap('0xTokenAddress', '0.01');

      // calculateAmountOutMin should be called with config slippage = 100 bps
      expect(calculateAmountOutMin).toHaveBeenCalledWith(
        mockExpectedOutput,
        100 // 1% = 100 bps
      );
    });
  });

  describe('logging output format', () => {
    it('should log pool information for each found pool', async () => {
      await runSwap('0xTokenAddress', '0.01');

      // Should log "Pool N:" for each pool
      expect(info).toHaveBeenCalledWith(
        expect.stringMatching(/Pool \d+:.*biswap.*v2.*liquidity.*\$?[\d,]+/)
      );
    });

    it('should log selected pool with dex and pair address', async () => {
      await runSwap('0xTokenAddress', '0.01');

      expect(info).toHaveBeenCalledWith(
        expect.stringMatching(/Selected:.*biswap.*v2.*0xPairAddress1/)
      );
    });

    it('should log swap execution details', async () => {
      await runSwap('0xTokenAddress', '0.01');

      expect(info).toHaveBeenCalledWith(
        expect.stringMatching(/Executing V2 swap:.*0\.01 BNB/)
      );
    });
  });

  describe('input validation', () => {
    it('should parse amount correctly', async () => {
      await runSwap('0xTokenAddress', '0.5');

      expect(parseEther).toHaveBeenCalledWith('0.5');
    });

    it('should handle integer amounts', async () => {
      await runSwap('0xTokenAddress', '1');

      expect(parseEther).toHaveBeenCalledWith('1');
    });
  });

  describe('wallet recipient', () => {
    it('should use wallet address as recipient', async () => {
      await runSwap('0xTokenAddress', '0.01');

      const swapCall = (executeSwap as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(swapCall[0].recipient).toBeDefined();
    });
  });

  describe('slippageBps conversion', () => {
    it('should convert 1% slippage to 100 bps', async () => {
      await runSwap('0xTokenAddress', '0.01');

      const swapCall = (executeSwap as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(swapCall[0].slippageBps).toBe(100);
    });

    it('should convert 2% slippage (CLI override) to 200 bps', async () => {
      await runSwap('0xTokenAddress', '0.01', '2');

      const swapCall = (executeSwap as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(swapCall[0].slippageBps).toBe(200);
    });

    it('should convert 0.5% slippage to 50 bps', async () => {
      const configWithFractionalSlippage = { ...mockConfig, slippage: 0.5 };
      (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue(configWithFractionalSlippage);

      await runSwap('0xTokenAddress', '0.01');

      const swapCall = (executeSwap as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(swapCall[0].slippageBps).toBe(50);
    });

    it('should floor fractional bps (0.25% -> 25 bps)', async () => {
      const configWithSmallSlippage = { ...mockConfig, slippage: 0.25 };
      (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue(configWithSmallSlippage);

      await runSwap('0xTokenAddress', '0.01');

      const swapCall = (executeSwap as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(swapCall[0].slippageBps).toBe(25);
    });

    it('should handle 5% slippage (500 bps)', async () => {
      await runSwap('0xTokenAddress', '0.01', '5');

      const swapCall = (executeSwap as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(swapCall[0].slippageBps).toBe(500);
    });
  });

  describe('expected output integration', () => {
    it('should call getExpectedOutput before calculateAmountOutMin', async () => {
      const callOrder: string[] = [];

      (getExpectedOutput as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callOrder.push('getExpectedOutput');
        return mockExpectedOutput;
      });

      (calculateAmountOutMin as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callOrder.push('calculateAmountOutMin');
        return BigInt(99000000000000000000);
      });

      await runSwap('0xTokenAddress', '0.01');

      expect(callOrder).toEqual(['getExpectedOutput', 'calculateAmountOutMin']);
    });

    it('should pass the expected output from router to calculateAmountOutMin', async () => {
      const specificExpectedOutput = BigInt(500000000000000000000); // 500 tokens
      (getExpectedOutput as ReturnType<typeof vi.fn>).mockResolvedValue(specificExpectedOutput);

      await runSwap('0xTokenAddress', '0.01');

      expect(calculateAmountOutMin).toHaveBeenCalledWith(
        specificExpectedOutput,
        expect.any(Number)
      );
    });
  });
});
