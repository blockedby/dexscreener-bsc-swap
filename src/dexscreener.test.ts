import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios, { AxiosError } from 'axios';
import { fetchPools, selectBestPool, withRetry, DexscreenerApiError, InsufficientLiquidityError } from './dexscreener';
import type { DexscreenerPair, PoolInfo } from './types';
import * as logger from './logger';

// Mock axios
vi.mock('axios', async () => {
  const actual = await vi.importActual('axios');
  return {
    ...actual,
    default: {
      get: vi.fn(),
      isAxiosError: (error: unknown) => error instanceof AxiosError || (error as { isAxiosError?: boolean })?.isAxiosError === true,
    },
  };
});

// Mock logger
vi.mock('./logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const mockedAxios = vi.mocked(axios);
const mockedLogger = vi.mocked(logger);

// Helper to create mock AxiosError
function createAxiosError(
  code?: string,
  status?: number,
  message: string = 'Test error'
): AxiosError {
  const error = new AxiosError(message, code);
  if (status) {
    error.response = {
      status,
      statusText: 'Error',
      headers: {},
      config: {} as never,
      data: {},
    };
  }
  return error;
}

describe('dexscreener', () => {
  describe('fetchPools', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
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
        'https://api.dexscreener.com/latest/dex/tokens/0xtoken',
        { timeout: 5000 }
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

    it('should include 5 second timeout in request', async () => {
      mockedAxios.get.mockResolvedValue({ data: { pairs: [] } });

      await fetchPools('0xtoken');

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        { timeout: 5000 }
      );
    });

    it('should retry on timeout error with exponential backoff', async () => {
      const timeoutError = createAxiosError('ECONNABORTED');
      mockedAxios.get
        .mockRejectedValueOnce(timeoutError)
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce({ data: { pairs: [] } });

      const promise = fetchPools('0xtoken');

      // First retry delay (1s)
      await vi.advanceTimersByTimeAsync(1000);
      // Second retry delay (2s)
      await vi.advanceTimersByTimeAsync(2000);

      const result = await promise;

      expect(result).toEqual([]);
      expect(mockedAxios.get).toHaveBeenCalledTimes(3);
      expect(mockedLogger.warn).toHaveBeenCalledTimes(2);
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Dexscreener API timeout, retrying...')
      );
    });

    it('should retry on 429 rate limit error', async () => {
      const rateLimitError = createAxiosError('ERR_BAD_REQUEST', 429);
      mockedAxios.get
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({ data: { pairs: [] } });

      const promise = fetchPools('0xtoken');

      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;

      expect(result).toEqual([]);
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Rate limited, waiting...')
      );
    });

    it('should retry on 5xx server errors', async () => {
      const serverError = createAxiosError('ERR_BAD_RESPONSE', 503);
      mockedAxios.get
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce({ data: { pairs: [] } });

      const promise = fetchPools('0xtoken');

      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;

      expect(result).toEqual([]);
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Server error, retrying...')
      );
    });

    it('should retry on network errors (ENOTFOUND)', async () => {
      const networkError = createAxiosError('ENOTFOUND');
      mockedAxios.get
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({ data: { pairs: [] } });

      const promise = fetchPools('0xtoken');

      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;

      expect(result).toEqual([]);
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Network error, check connection')
      );
    });

    it('should throw DexscreenerApiError after max retries exhausted', async () => {
      const timeoutError = createAxiosError('ECONNABORTED');
      mockedAxios.get.mockRejectedValue(timeoutError);

      let caughtError: Error | undefined;
      const promise = fetchPools('0xtoken').catch((err) => {
        caughtError = err;
      });

      // Advance through all retries (1s + 2s + 4s)
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(4000);

      await promise;

      expect(caughtError).toBeInstanceOf(DexscreenerApiError);
      expect(caughtError?.message).toContain('Dexscreener API timeout');
      expect(mockedAxios.get).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });

    it('should not retry on 4xx client errors (except 429)', async () => {
      const clientError = createAxiosError('ERR_BAD_REQUEST', 400);
      mockedAxios.get.mockRejectedValue(clientError);

      await expect(fetchPools('0xtoken')).rejects.toThrow(DexscreenerApiError);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      expect(mockedLogger.warn).not.toHaveBeenCalled();
    });

    it('should propagate non-axios errors without retry', async () => {
      const error = new Error('Unexpected error');
      mockedAxios.get.mockRejectedValue(error);

      await expect(fetchPools('0xtoken')).rejects.toThrow('Unexpected error');
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it('should use exponential backoff delays (1s, 2s, 4s)', async () => {
      const timeoutError = createAxiosError('ECONNABORTED');
      mockedAxios.get
        .mockRejectedValueOnce(timeoutError)
        .mockRejectedValueOnce(timeoutError)
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce({ data: { pairs: [] } });

      const promise = fetchPools('0xtoken');

      // First delay: 1000ms
      expect(mockedLogger.warn).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('waiting 1000ms')
      );

      // Second delay: 2000ms
      await vi.advanceTimersByTimeAsync(2000);
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('waiting 2000ms')
      );

      // Third delay: 4000ms
      await vi.advanceTimersByTimeAsync(4000);
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('waiting 4000ms')
      );

      await promise;
    });
  });

  describe('withRetry', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return result on first success', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await withRetry(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should respect custom maxRetries parameter', async () => {
      const error = createAxiosError('ECONNABORTED');
      const fn = vi.fn().mockRejectedValue(error);

      let caughtError: Error | undefined;
      const promise = withRetry(fn, 1, 100).catch((err) => {
        caughtError = err;
      });

      await vi.advanceTimersByTimeAsync(100);

      await promise;

      expect(caughtError).toBeInstanceOf(DexscreenerApiError);
      expect(fn).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
    });

    it('should respect custom baseDelayMs parameter', async () => {
      const error = createAxiosError('ECONNABORTED');
      const fn = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce('success');

      const promise = withRetry(fn, 3, 500);

      await vi.advanceTimersByTimeAsync(500);

      const result = await promise;

      expect(result).toBe('success');
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('waiting 500ms')
      );
    });
  });

  describe('DexscreenerApiError', () => {
    it('should have correct name property', () => {
      const error = new DexscreenerApiError('test message');
      expect(error.name).toBe('DexscreenerApiError');
    });

    it('should store statusCode when provided', () => {
      const error = new DexscreenerApiError('test', 429);
      expect(error.statusCode).toBe(429);
    });

    it('should store isRetryable flag', () => {
      const retryable = new DexscreenerApiError('test', 500, true);
      const notRetryable = new DexscreenerApiError('test', 400, false);

      expect(retryable.isRetryable).toBe(true);
      expect(notRetryable.isRetryable).toBe(false);
    });

    it('should default isRetryable to false', () => {
      const error = new DexscreenerApiError('test');
      expect(error.isRetryable).toBe(false);
    });
  });

  describe('selectBestPool', () => {
    it('should return no_valid_pools for empty pairs array', () => {
      const result = selectBestPool([]);
      expect(result).toEqual({ success: false, reason: 'no_valid_pools' });
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

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.pool.pairAddress).toBe('0xbsc');
      }
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

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.pool.pairAddress).toBe('0xv2pool');
        expect(result.pool.poolType).toBe('v2');
      }
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

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.pool.poolType).toBe('v3');
      }
    });

    it('should return no_valid_pools when no labels present', () => {
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

      expect(result).toEqual({ success: false, reason: 'no_valid_pools' });
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

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.pool.pairAddress).toBe('0xhighliq');
        expect(result.pool.liquidity).toBe(500000);
      }
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

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.pool.pairAddress).toBe('0xwithliq');
      }
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

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.pool).toEqual({
          pairAddress: '0xpooladdr',
          poolType: 'v2',
          dexId: 'pancakeswap',
          liquidity: 123456,
        } satisfies PoolInfo);
      }
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

      expect(result.success).toBe(true);
      if (result.success) {
        // Should pick v2 first (first valid label found)
        expect(result.pool.poolType).toBe('v2');
      }
    });

    it('should return no_valid_pools when no BSC pools exist', () => {
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

      expect(result).toEqual({ success: false, reason: 'no_valid_pools' });
    });

    it('should return no_valid_pools when no valid v2/v3 pools exist', () => {
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

      expect(result).toEqual({ success: false, reason: 'no_valid_pools' });
    });

    describe('minLiquidityUsd filter', () => {
      it('should filter out pools below minimum liquidity threshold', () => {
        const pairs: DexscreenerPair[] = [
          {
            chainId: 'bsc',
            pairAddress: '0xlowliq',
            baseToken: { address: '0x1', name: 'Token', symbol: 'TKN' },
            quoteToken: { address: '0x2', name: 'WBNB', symbol: 'WBNB' },
            labels: ['v2'],
            liquidity: { usd: 500 },
            dexId: 'pancakeswap',
            url: 'https://dexscreener.com/bsc/0xlowliq',
          },
          {
            chainId: 'bsc',
            pairAddress: '0xhighliq',
            baseToken: { address: '0x1', name: 'Token', symbol: 'TKN' },
            quoteToken: { address: '0x2', name: 'WBNB', symbol: 'WBNB' },
            labels: ['v2'],
            liquidity: { usd: 5000 },
            dexId: 'biswap',
            url: 'https://dexscreener.com/bsc/0xhighliq',
          },
        ];

        const result = selectBestPool(pairs, 1000);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.pool.pairAddress).toBe('0xhighliq');
        }
      });

      it('should return insufficient_liquidity when all pools below threshold', () => {
        const pairs: DexscreenerPair[] = [
          {
            chainId: 'bsc',
            pairAddress: '0xlowliq1',
            baseToken: { address: '0x1', name: 'Token', symbol: 'TKN' },
            quoteToken: { address: '0x2', name: 'WBNB', symbol: 'WBNB' },
            labels: ['v2'],
            liquidity: { usd: 500 },
            dexId: 'pancakeswap',
            url: 'https://dexscreener.com/bsc/0xlowliq1',
          },
          {
            chainId: 'bsc',
            pairAddress: '0xlowliq2',
            baseToken: { address: '0x1', name: 'Token', symbol: 'TKN' },
            quoteToken: { address: '0x2', name: 'WBNB', symbol: 'WBNB' },
            labels: ['v3'],
            liquidity: { usd: 800 },
            dexId: 'biswap',
            url: 'https://dexscreener.com/bsc/0xlowliq2',
          },
        ];

        const result = selectBestPool(pairs, 1000);

        expect(result).toEqual({
          success: false,
          reason: 'insufficient_liquidity',
          minLiquidityUsd: 1000,
        });
      });

      it('should include pools exactly at the threshold', () => {
        const pairs: DexscreenerPair[] = [
          {
            chainId: 'bsc',
            pairAddress: '0xexact',
            baseToken: { address: '0x1', name: 'Token', symbol: 'TKN' },
            quoteToken: { address: '0x2', name: 'WBNB', symbol: 'WBNB' },
            labels: ['v2'],
            liquidity: { usd: 1000 },
            dexId: 'pancakeswap',
            url: 'https://dexscreener.com/bsc/0xexact',
          },
        ];

        const result = selectBestPool(pairs, 1000);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.pool.pairAddress).toBe('0xexact');
        }
      });

      it('should use default minLiquidity of 0 when not specified', () => {
        const pairs: DexscreenerPair[] = [
          {
            chainId: 'bsc',
            pairAddress: '0xzeroliq',
            baseToken: { address: '0x1', name: 'Token', symbol: 'TKN' },
            quoteToken: { address: '0x2', name: 'WBNB', symbol: 'WBNB' },
            labels: ['v2'],
            liquidity: { usd: 0 },
            dexId: 'pancakeswap',
            url: 'https://dexscreener.com/bsc/0xzeroliq',
          },
        ];

        // No minLiquidity parameter passed
        const result = selectBestPool(pairs);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.pool.pairAddress).toBe('0xzeroliq');
        }
      });

      it('should treat missing liquidity.usd as 0 for threshold comparison', () => {
        const pairs: DexscreenerPair[] = [
          {
            chainId: 'bsc',
            pairAddress: '0xnoliq',
            baseToken: { address: '0x1', name: 'Token', symbol: 'TKN' },
            quoteToken: { address: '0x2', name: 'WBNB', symbol: 'WBNB' },
            labels: ['v2'],
            dexId: 'pancakeswap',
            url: 'https://dexscreener.com/bsc/0xnoliq',
          },
        ];

        const result = selectBestPool(pairs, 1000);

        expect(result).toEqual({
          success: false,
          reason: 'insufficient_liquidity',
          minLiquidityUsd: 1000,
        });
      });

      it('should return insufficient_liquidity with correct minLiquidity value', () => {
        const pairs: DexscreenerPair[] = [
          {
            chainId: 'bsc',
            pairAddress: '0xlowliq',
            baseToken: { address: '0x1', name: 'Token', symbol: 'TKN' },
            quoteToken: { address: '0x2', name: 'WBNB', symbol: 'WBNB' },
            labels: ['v2'],
            liquidity: { usd: 100 },
            dexId: 'pancakeswap',
            url: 'https://dexscreener.com/bsc/0xlowliq',
          },
        ];

        const result = selectBestPool(pairs, 5000);

        expect(result.success).toBe(false);
        if (!result.success && result.reason === 'insufficient_liquidity') {
          expect(result.minLiquidityUsd).toBe(5000);
        }
      });
    });
  });

  describe('InsufficientLiquidityError', () => {
    it('should have correct name property', () => {
      const error = new InsufficientLiquidityError(1000);
      expect(error.name).toBe('InsufficientLiquidityError');
    });

    it('should store minLiquidityUsd', () => {
      const error = new InsufficientLiquidityError(5000);
      expect(error.minLiquidityUsd).toBe(5000);
    });

    it('should format message with comma-separated minimum', () => {
      const error = new InsufficientLiquidityError(1000);
      expect(error.message).toBe('No pools with sufficient liquidity (minimum $1,000)');
    });

    it('should format large numbers correctly', () => {
      const error = new InsufficientLiquidityError(1000000);
      expect(error.message).toBe('No pools with sufficient liquidity (minimum $1,000,000)');
    });
  });
});
