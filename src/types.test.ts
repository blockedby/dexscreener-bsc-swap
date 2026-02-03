import { describe, it, expect } from 'vitest';
import {
  Token,
  DexscreenerPair,
  PoolInfo,
  SwapParams,
  Config,
  PoolLabel,
  isValidPoolLabel,
} from './types';

describe('types', () => {
  describe('Token', () => {
    it('should have address, name, and symbol properties', () => {
      const token: Token = {
        address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
        name: 'Ethereum Token',
        symbol: 'ETH',
      };

      expect(token.address).toBe('0x2170Ed0880ac9A755fd29B2688956BD959F933F8');
      expect(token.name).toBe('Ethereum Token');
      expect(token.symbol).toBe('ETH');
    });
  });

  describe('DexscreenerPair', () => {
    it('should have required properties from Dexscreener API', () => {
      const pair: DexscreenerPair = {
        chainId: 'bsc',
        pairAddress: '0x62Fcb3C1794FB95BD8B1A97f6Ad5D8a7e4943a1e',
        baseToken: {
          address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
          name: 'Ethereum Token',
          symbol: 'ETH',
        },
        quoteToken: {
          address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
          name: 'Wrapped BNB',
          symbol: 'WBNB',
        },
        dexId: 'pancakeswap',
        url: 'https://dexscreener.com/bsc/0x62fcb3c1794fb95bd8b1a97f6ad5d8a7e4943a1e',
      };

      expect(pair.chainId).toBe('bsc');
      expect(pair.pairAddress).toBe('0x62Fcb3C1794FB95BD8B1A97f6Ad5D8a7e4943a1e');
      expect(pair.baseToken.symbol).toBe('ETH');
      expect(pair.quoteToken.symbol).toBe('WBNB');
      expect(pair.dexId).toBe('pancakeswap');
      expect(pair.url).toContain('dexscreener.com');
    });

    it('should allow optional labels array', () => {
      const pairWithLabels: DexscreenerPair = {
        chainId: 'bsc',
        pairAddress: '0x62Fcb3C1794FB95BD8B1A97f6Ad5D8a7e4943a1e',
        baseToken: { address: '0x...', name: 'Token', symbol: 'TKN' },
        quoteToken: { address: '0x...', name: 'Quote', symbol: 'QTE' },
        dexId: 'pancakeswap',
        url: 'https://dexscreener.com/bsc/...',
        labels: ['v3'],
      };

      const pairWithoutLabels: DexscreenerPair = {
        chainId: 'bsc',
        pairAddress: '0x62Fcb3C1794FB95BD8B1A97f6Ad5D8a7e4943a1e',
        baseToken: { address: '0x...', name: 'Token', symbol: 'TKN' },
        quoteToken: { address: '0x...', name: 'Quote', symbol: 'QTE' },
        dexId: 'pancakeswap',
        url: 'https://dexscreener.com/bsc/...',
      };

      expect(pairWithLabels.labels).toEqual(['v3']);
      expect(pairWithoutLabels.labels).toBeUndefined();
    });

    it('should allow optional liquidity object with optional fields', () => {
      const pairWithFullLiquidity: DexscreenerPair = {
        chainId: 'bsc',
        pairAddress: '0x...',
        baseToken: { address: '0x...', name: 'Token', symbol: 'TKN' },
        quoteToken: { address: '0x...', name: 'Quote', symbol: 'QTE' },
        dexId: 'pancakeswap',
        url: 'https://dexscreener.com/bsc/...',
        liquidity: { usd: 1545086.24, base: 611.2559, quote: 256.07931 },
      };

      const pairWithPartialLiquidity: DexscreenerPair = {
        chainId: 'bsc',
        pairAddress: '0x...',
        baseToken: { address: '0x...', name: 'Token', symbol: 'TKN' },
        quoteToken: { address: '0x...', name: 'Quote', symbol: 'QTE' },
        dexId: 'pancakeswap',
        url: 'https://dexscreener.com/bsc/...',
        liquidity: { usd: 1000 },
      };

      const pairWithoutLiquidity: DexscreenerPair = {
        chainId: 'bsc',
        pairAddress: '0x...',
        baseToken: { address: '0x...', name: 'Token', symbol: 'TKN' },
        quoteToken: { address: '0x...', name: 'Quote', symbol: 'QTE' },
        dexId: 'pancakeswap',
        url: 'https://dexscreener.com/bsc/...',
      };

      expect(pairWithFullLiquidity.liquidity?.usd).toBe(1545086.24);
      expect(pairWithPartialLiquidity.liquidity?.usd).toBe(1000);
      expect(pairWithoutLiquidity.liquidity).toBeUndefined();
    });
  });

  describe('PoolInfo', () => {
    it('should have pairAddress, poolType, dexId, and liquidity', () => {
      const pool: PoolInfo = {
        pairAddress: '0x62Fcb3C1794FB95BD8B1A97f6Ad5D8a7e4943a1e',
        poolType: 'v3',
        dexId: 'pancakeswap',
        liquidity: 1545086.24,
      };

      expect(pool.pairAddress).toBe('0x62Fcb3C1794FB95BD8B1A97f6Ad5D8a7e4943a1e');
      expect(pool.poolType).toBe('v3');
      expect(pool.dexId).toBe('pancakeswap');
      expect(pool.liquidity).toBe(1545086.24);
    });

    it('should only allow v2 or v3 as poolType', () => {
      const v2Pool: PoolInfo = {
        pairAddress: '0x...',
        poolType: 'v2',
        dexId: 'biswap',
        liquidity: 100000,
      };

      const v3Pool: PoolInfo = {
        pairAddress: '0x...',
        poolType: 'v3',
        dexId: 'pancakeswap',
        liquidity: 200000,
      };

      expect(v2Pool.poolType).toBe('v2');
      expect(v3Pool.poolType).toBe('v3');
    });
  });

  describe('SwapParams', () => {
    it('should have tokenAddress, amountIn (bigint), slippage, and recipient', () => {
      const params: SwapParams = {
        tokenAddress: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
        amountIn: 1000000000000000000n, // 1 ETH in wei
        slippage: 1,
        recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f12345',
      };

      expect(params.tokenAddress).toBe('0x2170Ed0880ac9A755fd29B2688956BD959F933F8');
      expect(params.amountIn).toBe(1000000000000000000n);
      expect(typeof params.amountIn).toBe('bigint');
      expect(params.slippage).toBe(1);
      expect(params.recipient).toBe('0x742d35Cc6634C0532925a3b844Bc9e7595f12345');
    });
  });

  describe('Config', () => {
    it('should have privateKey, rpcUrl, slippage, and universalSwapAddress', () => {
      const config: Config = {
        privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        rpcUrl: 'https://bsc-dataseed.binance.org/',
        slippage: 1,
        universalSwapAddress: '0xUniversalSwapContractAddress',
      };

      expect(config.privateKey).toContain('0x');
      expect(config.rpcUrl).toContain('bsc');
      expect(config.slippage).toBe(1);
      expect(config.universalSwapAddress).toBe('0xUniversalSwapContractAddress');
    });
  });

  describe('PoolLabel', () => {
    it('should be a union type of v2 or v3', () => {
      const v2Label: PoolLabel = 'v2';
      const v3Label: PoolLabel = 'v3';

      expect(v2Label).toBe('v2');
      expect(v3Label).toBe('v3');
    });
  });

  describe('isValidPoolLabel', () => {
    it('should return true for v2', () => {
      expect(isValidPoolLabel('v2')).toBe(true);
    });

    it('should return true for v3', () => {
      expect(isValidPoolLabel('v3')).toBe(true);
    });

    it('should return false for v1', () => {
      expect(isValidPoolLabel('v1')).toBe(false);
    });

    it('should return false for v4', () => {
      expect(isValidPoolLabel('v4')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidPoolLabel('')).toBe(false);
    });

    it('should return false for arbitrary strings', () => {
      expect(isValidPoolLabel('pancakeswap')).toBe(false);
      expect(isValidPoolLabel('V2')).toBe(false); // case sensitive
      expect(isValidPoolLabel('V3')).toBe(false);
    });

    it('should act as a type guard', () => {
      const label: string = 'v2';
      if (isValidPoolLabel(label)) {
        // TypeScript should narrow label to PoolLabel here
        const poolLabel: PoolLabel = label;
        expect(poolLabel).toBe('v2');
      }
    });
  });
});
