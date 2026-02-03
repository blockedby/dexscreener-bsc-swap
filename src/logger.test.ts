import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { info, error, warn } from './logger';

describe('logger', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('info', () => {
    it('should log message with [INFO] prefix', () => {
      info('Fetching pools for 0x1234...');
      expect(consoleSpy).toHaveBeenCalledWith('[INFO] Fetching pools for 0x1234...');
    });

    it('should handle pool discovery messages', () => {
      info('Found 5 pools on Dexscreener');
      expect(consoleSpy).toHaveBeenCalledWith('[INFO] Found 5 pools on Dexscreener');
    });

    it('should handle pool selection messages', () => {
      info('Pool 1: biswap (v2), liquidity: $1,234,567');
      expect(consoleSpy).toHaveBeenCalledWith('[INFO] Pool 1: biswap (v2), liquidity: $1,234,567');
    });

    it('should handle swap execution messages', () => {
      info('Executing V2 swap: 0.01 BNB → TOKEN');
      expect(consoleSpy).toHaveBeenCalledWith('[INFO] Executing V2 swap: 0.01 BNB → TOKEN');
    });

    it('should handle transaction hash messages', () => {
      info('TX Hash: 0xabc123...');
      expect(consoleSpy).toHaveBeenCalledWith('[INFO] TX Hash: 0xabc123...');
    });

    it('should handle empty string message', () => {
      info('');
      expect(consoleSpy).toHaveBeenCalledWith('[INFO] ');
    });
  });

  describe('error', () => {
    it('should log message with [ERROR] prefix', () => {
      error('Swap failed: insufficient liquidity');
      expect(consoleSpy).toHaveBeenCalledWith('[ERROR] Swap failed: insufficient liquidity');
    });

    it('should handle network errors', () => {
      error('Network error: request timeout');
      expect(consoleSpy).toHaveBeenCalledWith('[ERROR] Network error: request timeout');
    });

    it('should handle contract errors', () => {
      error('Contract execution reverted: INSUFFICIENT_OUTPUT_AMOUNT');
      expect(consoleSpy).toHaveBeenCalledWith('[ERROR] Contract execution reverted: INSUFFICIENT_OUTPUT_AMOUNT');
    });

    it('should handle empty string message', () => {
      error('');
      expect(consoleSpy).toHaveBeenCalledWith('[ERROR] ');
    });
  });

  describe('warn', () => {
    it('should log message with [WARN] prefix', () => {
      warn('Low liquidity pool detected');
      expect(consoleSpy).toHaveBeenCalledWith('[WARN] Low liquidity pool detected');
    });

    it('should handle slippage warnings', () => {
      warn('High slippage detected: 5%');
      expect(consoleSpy).toHaveBeenCalledWith('[WARN] High slippage detected: 5%');
    });

    it('should handle gas price warnings', () => {
      warn('Gas price is higher than usual');
      expect(consoleSpy).toHaveBeenCalledWith('[WARN] Gas price is higher than usual');
    });

    it('should handle empty string message', () => {
      warn('');
      expect(consoleSpy).toHaveBeenCalledWith('[WARN] ');
    });
  });
});
