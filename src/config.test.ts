import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Config } from './types';

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules cache to allow fresh import
    vi.resetModules();
    // Create a fresh copy of process.env
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original process.env
    process.env = originalEnv;
  });

  describe('WBNB_ADDRESS constant', () => {
    it('should export WBNB_ADDRESS with correct BSC WBNB address', async () => {
      const { WBNB_ADDRESS } = await import('./config');
      expect(WBNB_ADDRESS).toBe('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c');
    });
  });

  describe('loadConfig', () => {
    it('should load required PRIVATE_KEY from environment', async () => {
      process.env.PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      process.env.UNIVERSAL_SWAP_ADDRESS = '0x1234567890123456789012345678901234567890';

      const { loadConfig } = await import('./config');
      const config = loadConfig();

      expect(config.privateKey).toBe('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
    });

    it('should load required UNIVERSAL_SWAP_ADDRESS from environment', async () => {
      process.env.PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      process.env.UNIVERSAL_SWAP_ADDRESS = '0xabcdef1234567890abcdef1234567890abcdef12';

      const { loadConfig } = await import('./config');
      const config = loadConfig();

      expect(config.universalSwapAddress).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
    });

    it('should use default RPC_URL if not provided', async () => {
      process.env.PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      process.env.UNIVERSAL_SWAP_ADDRESS = '0x1234567890123456789012345678901234567890';
      delete process.env.RPC_URL;

      const { loadConfig } = await import('./config');
      const config = loadConfig();

      expect(config.rpcUrl).toBe('https://bsc-dataseed.binance.org/');
    });

    it('should use custom RPC_URL if provided', async () => {
      process.env.PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      process.env.UNIVERSAL_SWAP_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.RPC_URL = 'https://rpc.48.club';

      const { loadConfig } = await import('./config');
      const config = loadConfig();

      expect(config.rpcUrl).toBe('https://rpc.48.club');
    });

    it('should use default SLIPPAGE of 1 if not provided', async () => {
      process.env.PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      process.env.UNIVERSAL_SWAP_ADDRESS = '0x1234567890123456789012345678901234567890';
      delete process.env.SLIPPAGE;

      const { loadConfig } = await import('./config');
      const config = loadConfig();

      expect(config.slippage).toBe(1);
    });

    it('should use custom SLIPPAGE if provided', async () => {
      process.env.PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      process.env.UNIVERSAL_SWAP_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.SLIPPAGE = '2.5';

      const { loadConfig } = await import('./config');
      const config = loadConfig();

      expect(config.slippage).toBe(2.5);
    });

    it('should throw error if PRIVATE_KEY is missing', async () => {
      delete process.env.PRIVATE_KEY;
      process.env.UNIVERSAL_SWAP_ADDRESS = '0x1234567890123456789012345678901234567890';

      const { loadConfig } = await import('./config');

      expect(() => loadConfig()).toThrow('Missing required environment variable: PRIVATE_KEY');
    });

    it('should throw error if PRIVATE_KEY is empty string', async () => {
      process.env.PRIVATE_KEY = '';
      process.env.UNIVERSAL_SWAP_ADDRESS = '0x1234567890123456789012345678901234567890';

      const { loadConfig } = await import('./config');

      expect(() => loadConfig()).toThrow('Missing required environment variable: PRIVATE_KEY');
    });

    it('should throw error if PRIVATE_KEY is whitespace-only', async () => {
      process.env.PRIVATE_KEY = '   ';
      process.env.UNIVERSAL_SWAP_ADDRESS = '0x1234567890123456789012345678901234567890';

      const { loadConfig } = await import('./config');

      expect(() => loadConfig()).toThrow('PRIVATE_KEY cannot be empty or whitespace');
    });

    it('should throw error if PRIVATE_KEY is tabs and spaces only', async () => {
      process.env.PRIVATE_KEY = '\t  \t';
      process.env.UNIVERSAL_SWAP_ADDRESS = '0x1234567890123456789012345678901234567890';

      const { loadConfig } = await import('./config');

      expect(() => loadConfig()).toThrow('PRIVATE_KEY cannot be empty or whitespace');
    });

    it('should trim whitespace from valid PRIVATE_KEY', async () => {
      process.env.PRIVATE_KEY = '  0xabc123  ';
      process.env.UNIVERSAL_SWAP_ADDRESS = '0x1234567890123456789012345678901234567890';

      const { loadConfig } = await import('./config');
      const config = loadConfig();

      expect(config.privateKey).toBe('0xabc123');
    });

    it('should throw error if UNIVERSAL_SWAP_ADDRESS is missing', async () => {
      process.env.PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      delete process.env.UNIVERSAL_SWAP_ADDRESS;

      const { loadConfig } = await import('./config');

      expect(() => loadConfig()).toThrow('Missing required environment variable: UNIVERSAL_SWAP_ADDRESS');
    });

    it('should return a Config object with all fields', async () => {
      process.env.PRIVATE_KEY = '0xabc123';
      process.env.UNIVERSAL_SWAP_ADDRESS = '0xdef456';
      process.env.RPC_URL = 'https://custom-rpc.example.com';
      process.env.SLIPPAGE = '0.5';
      process.env.DEADLINE_SECONDS = '60';
      process.env.MIN_LIQUIDITY_USD = '5000';

      const { loadConfig } = await import('./config');
      const config: Config = loadConfig();

      expect(config).toEqual({
        privateKey: '0xabc123',
        rpcUrl: 'https://custom-rpc.example.com',
        slippage: 0.5,
        universalSwapAddress: '0xdef456',
        deadlineSeconds: 60,
        minLiquidityUsd: 5000,
      });
    });

    it('should use default DEADLINE_SECONDS of 30 if not provided', async () => {
      process.env.PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      process.env.UNIVERSAL_SWAP_ADDRESS = '0x1234567890123456789012345678901234567890';
      delete process.env.DEADLINE_SECONDS;

      const { loadConfig } = await import('./config');
      const config = loadConfig();

      expect(config.deadlineSeconds).toBe(30);
    });

    it('should use custom DEADLINE_SECONDS if provided', async () => {
      process.env.PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      process.env.UNIVERSAL_SWAP_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.DEADLINE_SECONDS = '120';

      const { loadConfig } = await import('./config');
      const config = loadConfig();

      expect(config.deadlineSeconds).toBe(120);
    });

    it('should parse DEADLINE_SECONDS as integer', async () => {
      process.env.PRIVATE_KEY = '0x123';
      process.env.UNIVERSAL_SWAP_ADDRESS = '0x456';
      process.env.DEADLINE_SECONDS = '45';

      const { loadConfig } = await import('./config');
      const config = loadConfig();

      expect(config.deadlineSeconds).toBe(45);
      expect(typeof config.deadlineSeconds).toBe('number');
    });

    it('should parse integer SLIPPAGE correctly', async () => {
      process.env.PRIVATE_KEY = '0x123';
      process.env.UNIVERSAL_SWAP_ADDRESS = '0x456';
      process.env.SLIPPAGE = '5';

      const { loadConfig } = await import('./config');
      const config = loadConfig();

      expect(config.slippage).toBe(5);
      expect(typeof config.slippage).toBe('number');
    });

    it('should use default MIN_LIQUIDITY_USD of 1000 if not provided', async () => {
      process.env.PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      process.env.UNIVERSAL_SWAP_ADDRESS = '0x1234567890123456789012345678901234567890';
      delete process.env.MIN_LIQUIDITY_USD;

      const { loadConfig } = await import('./config');
      const config = loadConfig();

      expect(config.minLiquidityUsd).toBe(1000);
    });

    it('should use custom MIN_LIQUIDITY_USD if provided', async () => {
      process.env.PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      process.env.UNIVERSAL_SWAP_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.MIN_LIQUIDITY_USD = '5000';

      const { loadConfig } = await import('./config');
      const config = loadConfig();

      expect(config.minLiquidityUsd).toBe(5000);
    });

    it('should parse MIN_LIQUIDITY_USD as float', async () => {
      process.env.PRIVATE_KEY = '0x123';
      process.env.UNIVERSAL_SWAP_ADDRESS = '0x456';
      process.env.MIN_LIQUIDITY_USD = '1500.50';

      const { loadConfig } = await import('./config');
      const config = loadConfig();

      expect(config.minLiquidityUsd).toBe(1500.50);
      expect(typeof config.minLiquidityUsd).toBe('number');
    });

    it('should parse integer MIN_LIQUIDITY_USD correctly', async () => {
      process.env.PRIVATE_KEY = '0x123';
      process.env.UNIVERSAL_SWAP_ADDRESS = '0x456';
      process.env.MIN_LIQUIDITY_USD = '10000';

      const { loadConfig } = await import('./config');
      const config = loadConfig();

      expect(config.minLiquidityUsd).toBe(10000);
      expect(typeof config.minLiquidityUsd).toBe('number');
    });
  });

  describe('validateSlippage', () => {
    it('should return valid slippage value', async () => {
      const { validateSlippage } = await import('./config');
      expect(validateSlippage(1)).toBe(1);
      expect(validateSlippage(0.5)).toBe(0.5);
      expect(validateSlippage(2.5)).toBe(2.5);
      expect(validateSlippage(50)).toBe(50);
    });

    it('should accept minimum valid slippage (0.01)', async () => {
      const { validateSlippage } = await import('./config');
      expect(validateSlippage(0.01)).toBe(0.01);
    });

    it('should accept maximum valid slippage (99.99)', async () => {
      const { validateSlippage } = await import('./config');
      expect(validateSlippage(99.99)).toBe(99.99);
    });

    it('should throw error for NaN', async () => {
      const { validateSlippage } = await import('./config');
      expect(() => validateSlippage(NaN)).toThrow('Invalid slippage: not a number');
    });

    it('should throw error for slippage below minimum (0.01)', async () => {
      const { validateSlippage } = await import('./config');
      expect(() => validateSlippage(0)).toThrow('Slippage must be between 0.01% and 99.99%');
      expect(() => validateSlippage(0.009)).toThrow('Slippage must be between 0.01% and 99.99%');
      expect(() => validateSlippage(-1)).toThrow('Slippage must be between 0.01% and 99.99%');
    });

    it('should throw error for slippage above maximum (99.99)', async () => {
      const { validateSlippage } = await import('./config');
      expect(() => validateSlippage(100)).toThrow('Slippage must be between 0.01% and 99.99%');
      expect(() => validateSlippage(99.991)).toThrow('Slippage must be between 0.01% and 99.99%');
      expect(() => validateSlippage(150)).toThrow('Slippage must be between 0.01% and 99.99%');
    });

    it('should throw error for more than 2 decimal places', async () => {
      const { validateSlippage } = await import('./config');
      // Use values within bounds (0.01-99.99) but with more than 2 decimals
      expect(() => validateSlippage(1.234)).toThrow('Slippage must have at most 2 decimal places');
      expect(() => validateSlippage(5.555)).toThrow('Slippage must have at most 2 decimal places');
      expect(() => validateSlippage(10.123)).toThrow('Slippage must have at most 2 decimal places');
    });

    it('should throw bounds error for values like 0.001 (below min)', async () => {
      const { validateSlippage } = await import('./config');
      // 0.001 is below the minimum 0.01, so bounds check fails first
      expect(() => validateSlippage(0.001)).toThrow('Slippage must be between 0.01% and 99.99%');
    });

    it('should accept integer values within bounds', async () => {
      const { validateSlippage } = await import('./config');
      expect(validateSlippage(1)).toBe(1);
      expect(validateSlippage(10)).toBe(10);
      expect(validateSlippage(99)).toBe(99);
    });

    it('should accept values with 1 decimal place', async () => {
      const { validateSlippage } = await import('./config');
      expect(validateSlippage(0.1)).toBe(0.1);
      expect(validateSlippage(1.5)).toBe(1.5);
      expect(validateSlippage(50.5)).toBe(50.5);
    });

    it('should accept values with exactly 2 decimal places', async () => {
      const { validateSlippage } = await import('./config');
      expect(validateSlippage(0.01)).toBe(0.01);
      expect(validateSlippage(1.25)).toBe(1.25);
      expect(validateSlippage(99.99)).toBe(99.99);
    });
  });
});
