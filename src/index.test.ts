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
import { executeSwap, calculateAmountOutMin } from './swap';
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

  beforeEach(() => {
    vi.clearAllMocks();
    (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue(mockConfig);
    (fetchPools as ReturnType<typeof vi.fn>).mockResolvedValue(mockPairs);
    (selectBestPool as ReturnType<typeof vi.fn>).mockReturnValue(mockPool);
    (executeSwap as ReturnType<typeof vi.fn>).mockResolvedValue('0xTransactionHash');
    (calculateAmountOutMin as ReturnType<typeof vi.fn>).mockReturnValue(BigInt(9900000000000000));
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
      expect(info).toHaveBeenCalledWith(expect.stringContaining('Executing'));
      expect(info).toHaveBeenCalledWith(expect.stringContaining('TX Hash'));
    });

    it('should log error and throw when swap fails', async () => {
      const swapError = new Error('Swap failed');
      (executeSwap as ReturnType<typeof vi.fn>).mockRejectedValue(swapError);

      await expect(runSwap('0xTokenAddress', '0.01')).rejects.toThrow('Swap failed');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Swap failed'));
    });
  });

  describe('slippage priority', () => {
    it('should use CLI slippage when provided (highest priority)', async () => {
      await runSwap('0xTokenAddress', '0.01', '2');

      // calculateAmountOutMin should be called with slippage = 2
      expect(calculateAmountOutMin).toHaveBeenCalledWith(
        expect.any(BigInt),
        2
      );
    });

    it('should use config slippage when CLI slippage is not provided', async () => {
      const configWithSlippage = { ...mockConfig, slippage: 0.5 };
      (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue(configWithSlippage);

      await runSwap('0xTokenAddress', '0.01');

      // calculateAmountOutMin should be called with slippage = 0.5
      expect(calculateAmountOutMin).toHaveBeenCalledWith(
        expect.any(BigInt),
        0.5
      );
    });

    it('should use config slippage when CLI slippage not provided', async () => {
      await runSwap('0xTokenAddress', '0.01');

      // calculateAmountOutMin should be called with config slippage = 1
      expect(calculateAmountOutMin).toHaveBeenCalledWith(
        expect.any(BigInt),
        1
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
});
