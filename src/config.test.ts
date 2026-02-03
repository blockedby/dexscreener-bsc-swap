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

      const { loadConfig } = await import('./config');
      const config: Config = loadConfig();

      expect(config).toEqual({
        privateKey: '0xabc123',
        rpcUrl: 'https://custom-rpc.example.com',
        slippage: 0.5,
        universalSwapAddress: '0xdef456',
      });
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
  });
});
