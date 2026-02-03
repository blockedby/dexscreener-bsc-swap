import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { fetchPools, selectBestPool } from './dexscreener';
import { DexscreenerPair, PoolInfo } from './types';

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios);

describe('dexscreener', () => {
  describe('fetchPools', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should fetch pools for a given token address', async () => {
      const mockPairs: DexscreenerPair[] = [
        {
          chainId: 'bsc',
          pairAddress: '0x1234567890abcdef',
          baseToken: { address: '0xtoken', name: 'Test Token', symbol: 'TEST' },
          quoteToken: { address: '0xwbnb', name: 'Wrapped BNB', symbol: 'WBNB' },
          labels: ['v2'],
          liquidity: { usd: 100000 },
          dexId: 'pancakeswap',
          url: 'https://dexscreener.com/bsc/0x1234567890abcdef',
        },
      ];

      mockedAxios.get.mockResolvedValue({ data: { pairs: mockPairs } });

      const result = await fetchPools('0xtoken');

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://api.dexscreener.com/latest/dex/tokens/0xtoken'
      );
      expect(result).toEqual(mockPairs);
    });

    it('should return empty array when no pairs found', async () => {
      mockedAxios.get.mockResolvedValue({ data: { pairs: null } });

      const result = await fetchPools('0xnonexistent');

      expect(result).toEqual([]);
    });

    it('should return empty array when pairs is undefined', async () => {
      mockedAxios.get.mockResolvedValue({ data: {} });

      const result = await fetchPools('0xnonexistent');

      expect(result).toEqual([]);
    });

    it('should propagate axios errors', async () => {
      const error = new Error('Network error');
      mockedAxios.get.mockRejectedValue(error);

      await expect(fetchPools('0xtoken')).rejects.toThrow('Network error');
    });
  });

  describe('selectBestPool', () => {
    it('should return null for empty pairs array', () => {
      const result = selectBestPool([]);
      expect(result).toBeNull();
    });

    it('should filter by chainId === bsc', () => {
      const pairs: DexscreenerPair[] = [
        {
          chainId: 'ethereum',
          pairAddress: '0xeth',
          baseToken: { address: '0x1', name: 'Token', symbol: 'TKN' },
          quoteToken: { address: '0x2', name: 'WETH', symbol: 'WETH' },
          labels: ['v2'],
          liquidity: { usd: 500000 },
          dexId: 'uniswap',
          url: 'https://dexscreener.com/ethereum/0xeth',
        },
        {
          chainId: 'bsc',
          pairAddress: '0xbsc',
          baseToken: { address: '0x1', name: 'Token', symbol: 'TKN' },
          quoteToken: { address: '0x2', name: 'WBNB', symbol: 'WBNB' },
          labels: ['v2'],
          liquidity: { usd: 100000 },
          dexId: 'pancakeswap',
          url: 'https://dexscreener.com/bsc/0xbsc',
        },
      ];

      const result = selectBestPool(pairs);

      expect(result).not.toBeNull();
      expect(result!.pairAddress).toBe('0xbsc');
    });

    it('should filter by labels containing v2 or v3', () => {
      const pairs: DexscreenerPair[] = [
        {
          chainId: 'bsc',
          pairAddress: '0xv1pool',
          baseToken: { address: '0x1', name: 'Token', symbol: 'TKN' },
          quoteToken: { address: '0x2', name: 'WBNB', symbol: 'WBNB' },
          labels: ['v1'],
          liquidity: { usd: 500000 },
          dexId: 'oldswap',
          url: 'https://dexscreener.com/bsc/0xv1pool',
        },
        {
          chainId: 'bsc',
          pairAddress: '0xv2pool',
          baseToken: { address: '0x1', name: 'Token', symbol: 'TKN' },
          quoteToken: { address: '0x2', name: 'WBNB', symbol: 'WBNB' },
          labels: ['v2'],
          liquidity: { usd: 100000 },
          dexId: 'pancakeswap',
          url: 'https://dexscreener.com/bsc/0xv2pool',
        },
      ];

      const result = selectBestPool(pairs);

      expect(result).not.toBeNull();
      expect(result!.pairAddress).toBe('0xv2pool');
      expect(result!.poolType).toBe('v2');
    });

    it('should accept pools with v3 labels', () => {
      const pairs: DexscreenerPair[] = [
        {
          chainId: 'bsc',
          pairAddress: '0xv3pool',
          baseToken: { address: '0x1', name: 'Token', symbol: 'TKN' },
          quoteToken: { address: '0x2', name: 'WBNB', symbol: 'WBNB' },
          labels: ['v3'],
          liquidity: { usd: 200000 },
          dexId: 'pancakeswap',
          url: 'https://dexscreener.com/bsc/0xv3pool',
        },
      ];

      const result = selectBestPool(pairs);

      expect(result).not.toBeNull();
      expect(result!.poolType).toBe('v3');
    });

    it('should return null when no labels present', () => {
      const pairs: DexscreenerPair[] = [
        {
          chainId: 'bsc',
          pairAddress: '0xnolabel',
          baseToken: { address: '0x1', name: 'Token', symbol: 'TKN' },
          quoteToken: { address: '0x2', name: 'WBNB', symbol: 'WBNB' },
          liquidity: { usd: 500000 },
          dexId: 'someswap',
          url: 'https://dexscreener.com/bsc/0xnolabel',
        },
      ];

      const result = selectBestPool(pairs);

      expect(result).toBeNull();
    });

    it('should sort by liquidity.usd descending and return highest', () => {
      const pairs: DexscreenerPair[] = [
        {
          chainId: 'bsc',
          pairAddress: '0xlowliq',
          baseToken: { address: '0x1', name: 'Token', symbol: 'TKN' },
          quoteToken: { address: '0x2', name: 'WBNB', symbol: 'WBNB' },
          labels: ['v2'],
          liquidity: { usd: 50000 },
          dexId: 'pancakeswap',
          url: 'https://dexscreener.com/bsc/0xlowliq',
        },
        {
          chainId: 'bsc',
          pairAddress: '0xhighliq',
          baseToken: { address: '0x1', name: 'Token', symbol: 'TKN' },
          quoteToken: { address: '0x2', name: 'WBNB', symbol: 'WBNB' },
          labels: ['v2'],
          liquidity: { usd: 500000 },
          dexId: 'biswap',
          url: 'https://dexscreener.com/bsc/0xhighliq',
        },
        {
          chainId: 'bsc',
          pairAddress: '0xmedliq',
          baseToken: { address: '0x1', name: 'Token', symbol: 'TKN' },
          quoteToken: { address: '0x2', name: 'WBNB', symbol: 'WBNB' },
          labels: ['v3'],
          liquidity: { usd: 200000 },
          dexId: 'thena',
          url: 'https://dexscreener.com/bsc/0xmedliq',
        },
      ];

      const result = selectBestPool(pairs);

      expect(result).not.toBeNull();
      expect(result!.pairAddress).toBe('0xhighliq');
      expect(result!.liquidity).toBe(500000);
    });

    it('should handle missing liquidity.usd (treat as 0)', () => {
      const pairs: DexscreenerPair[] = [
        {
          chainId: 'bsc',
          pairAddress: '0xnoliq',
          baseToken: { address: '0x1', name: 'Token', symbol: 'TKN' },
          quoteToken: { address: '0x2', name: 'WBNB', symbol: 'WBNB' },
          labels: ['v2'],
          dexId: 'someswap',
          url: 'https://dexscreener.com/bsc/0xnoliq',
        },
        {
          chainId: 'bsc',
          pairAddress: '0xwithliq',
          baseToken: { address: '0x1', name: 'Token', symbol: 'TKN' },
          quoteToken: { address: '0x2', name: 'WBNB', symbol: 'WBNB' },
          labels: ['v2'],
          liquidity: { usd: 1000 },
          dexId: 'pancakeswap',
          url: 'https://dexscreener.com/bsc/0xwithliq',
        },
      ];

      const result = selectBestPool(pairs);

      expect(result).not.toBeNull();
      expect(result!.pairAddress).toBe('0xwithliq');
    });

    it('should return correct PoolInfo structure', () => {
      const pairs: DexscreenerPair[] = [
        {
          chainId: 'bsc',
          pairAddress: '0xpooladdr',
          baseToken: { address: '0x1', name: 'Token', symbol: 'TKN' },
          quoteToken: { address: '0x2', name: 'WBNB', symbol: 'WBNB' },
          labels: ['v2', 'stable'],
          liquidity: { usd: 123456 },
          dexId: 'pancakeswap',
          url: 'https://dexscreener.com/bsc/0xpooladdr',
        },
      ];

      const result = selectBestPool(pairs);

      expect(result).toEqual({
        pairAddress: '0xpooladdr',
        poolType: 'v2',
        dexId: 'pancakeswap',
        liquidity: 123456,
      } satisfies PoolInfo);
    });

    it('should prefer v2 when both v2 and v3 labels present', () => {
      const pairs: DexscreenerPair[] = [
        {
          chainId: 'bsc',
          pairAddress: '0xbothversions',
          baseToken: { address: '0x1', name: 'Token', symbol: 'TKN' },
          quoteToken: { address: '0x2', name: 'WBNB', symbol: 'WBNB' },
          labels: ['v2', 'v3'],
          liquidity: { usd: 100000 },
          dexId: 'pancakeswap',
          url: 'https://dexscreener.com/bsc/0xbothversions',
        },
      ];

      const result = selectBestPool(pairs);

      expect(result).not.toBeNull();
      // Should pick v2 first (first valid label found)
      expect(result!.poolType).toBe('v2');
    });

    it('should return null when no BSC pools exist', () => {
      const pairs: DexscreenerPair[] = [
        {
          chainId: 'ethereum',
          pairAddress: '0xeth1',
          baseToken: { address: '0x1', name: 'Token', symbol: 'TKN' },
          quoteToken: { address: '0x2', name: 'WETH', symbol: 'WETH' },
          labels: ['v2'],
          liquidity: { usd: 1000000 },
          dexId: 'uniswap',
          url: 'https://dexscreener.com/ethereum/0xeth1',
        },
      ];

      const result = selectBestPool(pairs);

      expect(result).toBeNull();
    });

    it('should return null when no valid v2/v3 pools exist', () => {
      const pairs: DexscreenerPair[] = [
        {
          chainId: 'bsc',
          pairAddress: '0xv4pool',
          baseToken: { address: '0x1', name: 'Token', symbol: 'TKN' },
          quoteToken: { address: '0x2', name: 'WBNB', symbol: 'WBNB' },
          labels: ['v4'],
          liquidity: { usd: 1000000 },
          dexId: 'futureswap',
          url: 'https://dexscreener.com/bsc/0xv4pool',
        },
      ];

      const result = selectBestPool(pairs);

      expect(result).toBeNull();
    });
  });
});
