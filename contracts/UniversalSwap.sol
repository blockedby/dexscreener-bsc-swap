// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║  ⚠️  SMART CONTRACT IS DEPRECATED - SHOULD BE FIXED IF YOU WANT TO USE IT    ║
// ╠═══════════════════════════════════════════════════════════════════════════════╣
// ║  Decision: Use official Uniswap/PancakeSwap routers instead.                  ║
// ║  This contract has security issues that must be fixed before production use.  ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝
//
// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ CRITICAL ISSUES TO FIX:                                                      │
// ├─────────────────────────────────────────────────────────────────────────────┤
// │                                                                              │
// │ 1. [CRITICAL] V2 Reserve Manipulation (lines 164-173)                        │
// │    Problem: getReserves() called AFTER transfer, reserves include amountIn   │
// │    Fix: Move getReserves() BEFORE _safeTransferFrom()                        │
// │                                                                              │
// │ 2. [CRITICAL] No Reentrancy Protection                                       │
// │    Problem: Malicious token can reenter via transferFrom callback            │
// │    Fix: Add OpenZeppelin ReentrancyGuard, use nonReentrant modifier          │
// │         import "@openzeppelin/contracts/security/ReentrancyGuard.sol";       │
// │                                                                              │
// │ 3. [CRITICAL] Multiple Callback Vulnerability (lines 391-412)                │
// │    Problem: Malicious pool can call callback multiple times                  │
// │    Fix: Add _callbackExecuted flag, check and set in _handleV3Callback       │
// │                                                                              │
// │ 4. [CRITICAL] Callback Data Manipulation (lines 367-389)                     │
// │    Problem: Pool can modify callback data (change payer to victim)           │
// │    Fix: Store keccak256(data) hash before swap, validate in callback         │
// │                                                                              │
// │ 5. [HIGH] No Transaction Deadline                                            │
// │    Problem: Stale transactions execute at bad prices                         │
// │    Fix: Add deadline parameter: require(block.timestamp <= deadline)         │
// │                                                                              │
// │ 6. [HIGH] V3 sqrtPrice Math Approximation (lines 315, 324)                   │
// │    Problem: slippageBps / 2 is approximation, loses precision for odd values │
// │    Example: slippageBps=1 (0.01%) → 1/2=0 → NO slippage protection!          │
// │    TODO: VERIFY THIS MATH - consider using MIN/MAX_SQRT_RATIO instead        │
// │    Fix: Use pool boundaries (MIN/MAX_SQRT_RATIO) + rely on amountOutMin      │
// │         OR calculate expected output via callstatic first                    │
// │                                                                              │
// │ 7. [HIGH] V2 Fee Hardcoded as 0.3% (line 237)                                │
// │    Problem: Some V2 forks use different fees                                 │
// │    Fix: Query fee from pool or accept as parameter                           │
// │                                                                              │
// │ 8. [MEDIUM] Factory Validation Not Implemented                               │
// │    Problem: No CREATE2 verification of pool address                          │
// │    Note: Mitigated if using trusted API (Dexscreener) for pool addresses     │
// │    Fix (optional): Implement CallbackValidation.verifyCallback() pattern     │
// │                                                                              │
// │ 9. [MEDIUM] Deflationary Tokens Not Supported (DOCUMENTED LIMITATION)        │
// │    Problem: Tokens with transfer fees cause incorrect output calculations    │
// │    Decision: Document as limitation in README. V3 pools don't support them   │
// │    anyway (industry standard). Not fixing for MVP.                           │
// │                                                                              │
// │ 10. [LOW] Dual Callback Entry Points                                         │
// │    Problem: Both uniswapV3SwapCallback and pancakeV3SwapCallback exist       │
// │    Note: Acceptable if only supporting Uniswap + PancakeSwap                 │
// │                                                                              │
// └─────────────────────────────────────────────────────────────────────────────┘

// ═══════════════════════════════════════════════════════════════════════════════
// Interfaces
// ═══════════════════════════════════════════════════════════════════════════════

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IUniswapV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function slot0() external view returns (
        uint160 sqrtPriceX96,
        int24 tick,
        uint16 observationIndex,
        uint16 observationCardinality,
        uint16 observationCardinalityNext,
        uint8 feeProtocol,
        bool unlocked
    );
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// UniversalSwap Contract
// ═══════════════════════════════════════════════════════════════════════════════

/// @title UniversalSwap
/// @notice Swap tokens via V2/V3 pools directly without router mapping
/// @dev Works with any Uniswap V2/V3 fork on BSC (PancakeSwap, BiSwap, ApeSwap, Thena, etc.)
contract UniversalSwap {
    // ═══════════════════════════════════════════════════════════════════════════
    // Errors
    // ═══════════════════════════════════════════════════════════════════════════

    error InsufficientOutputAmount(uint256 amountOut, uint256 amountOutMin);
    error InvalidTokenIn(address tokenIn, address token0, address token1);
    error ZeroAmount();
    error ZeroAddress();
    error TransferFailed();
    error InvalidCallbackCaller();
    error InsufficientInputAmount();
    error InsufficientLiquidity();

    // ═══════════════════════════════════════════════════════════════════════════
    // Events
    // ═══════════════════════════════════════════════════════════════════════════

    event SwapV2Executed(
        address indexed pair,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address recipient
    );

    event SwapV3Executed(
        address indexed pool,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address recipient
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // Constants
    // ═══════════════════════════════════════════════════════════════════════════

    /// @dev Min sqrt price limit for V3 swaps (absolute minimum, tick -887272)
    uint160 private constant MIN_SQRT_RATIO = 4295128739;

    /// @dev Max sqrt price limit for V3 swaps (absolute maximum, tick 887272)
    uint160 private constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    /// @dev Basis points denominator (100% = 10000)
    uint256 private constant BPS_DENOMINATOR = 10000;

    // ═══════════════════════════════════════════════════════════════════════════
    // State (for V3 callback)
    // ═══════════════════════════════════════════════════════════════════════════

    /// @dev Expected pool address for V3 callback validation (security)
    address private _expectedPool;

    /// @dev Temporary storage for V3 callback data
    struct V3CallbackData {
        address tokenIn;
        address payer;
    }

    /// @dev Struct to reduce stack depth in swapV2
    struct V2SwapState {
        address token0;
        address token1;
        bool isToken0;
        uint256 reserveIn;
        uint256 reserveOut;
    }

    /// @dev Struct to reduce stack depth in swapV3
    struct V3SwapState {
        address token0;
        address token1;
        address tokenOut;
        bool zeroForOne;
        uint256 balanceBefore;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // V2 Swap
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Swap tokens via Uniswap V2 pair directly
    /// @param pair The V2 pair address (from Dexscreener)
    /// @param tokenIn The input token address
    /// @param amountIn The amount of input tokens
    /// @param amountOutMin Minimum output amount (slippage protection)
    /// @param recipient The address to receive output tokens
    /// @return amountOut The actual output amount
    function swapV2(
        address pair,
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient
    ) external returns (uint256 amountOut) {
        // Validation
        if (amountIn == 0) revert ZeroAmount();
        if (pair == address(0) || recipient == address(0)) revert ZeroAddress();

        V2SwapState memory state;
        IUniswapV2Pair pairContract = IUniswapV2Pair(pair);
        state.token0 = pairContract.token0();
        state.token1 = pairContract.token1();

        // Determine swap direction
        state.isToken0 = tokenIn == state.token0;
        if (!state.isToken0 && tokenIn != state.token1) {
            revert InvalidTokenIn(tokenIn, state.token0, state.token1);
        }

        // Transfer tokenIn from sender to pair
        _safeTransferFrom(tokenIn, msg.sender, pair, amountIn);

        // Get reserves and calculate output
        (uint112 reserve0, uint112 reserve1, ) = pairContract.getReserves();
        (state.reserveIn, state.reserveOut) = state.isToken0
            ? (uint256(reserve0), uint256(reserve1))
            : (uint256(reserve1), uint256(reserve0));

        // Calculate amountOut using V2 formula
        amountOut = _getAmountOut(amountIn, state.reserveIn, state.reserveOut);

        // Slippage check
        if (amountOut < amountOutMin) {
            revert InsufficientOutputAmount(amountOut, amountOutMin);
        }

        // Execute swap
        _executeV2Swap(pairContract, state.isToken0, amountOut, recipient);

        // Emit event
        emit SwapV2Executed(
            pair,
            tokenIn,
            state.isToken0 ? state.token1 : state.token0,
            amountIn,
            amountOut,
            recipient
        );
    }

    /// @dev Execute V2 swap on the pair
    function _executeV2Swap(
        IUniswapV2Pair pairContract,
        bool isToken0,
        uint256 amountOut,
        address recipient
    ) internal {
        (uint256 amount0Out, uint256 amount1Out) = isToken0
            ? (uint256(0), amountOut)
            : (amountOut, uint256(0));

        pairContract.swap(amount0Out, amount1Out, recipient, new bytes(0));
    }

    /// @dev Safe transferFrom with error handling for non-standard ERC20s
    function _safeTransferFrom(
        address token,
        address from,
        address to,
        uint256 amount
    ) internal {
        (bool success, bytes memory returndata) = token.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount)
        );
        if (!success || (returndata.length > 0 && !abi.decode(returndata, (bool)))) {
            revert TransferFailed();
        }
    }

    /// @dev Calculate output amount for V2 swap using constant product formula
    /// @param amountIn Input amount
    /// @param reserveIn Reserve of input token
    /// @param reserveOut Reserve of output token
    /// @return amountOut Output amount after 0.3% fee
    function _getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256 amountOut) {
        if (amountIn == 0) revert InsufficientInputAmount();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();

        // Fee: 0.3% -> amountIn * 997 / 1000
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * 1000 + amountInWithFee;
        amountOut = numerator / denominator;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // V3 Swap
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Swap tokens via Uniswap V3 pool directly
    /// @param pool The V3 pool address (from Dexscreener)
    /// @param tokenIn The input token address
    /// @param amountIn The amount of input tokens
    /// @param amountOutMin Minimum output amount (slippage protection)
    /// @param slippageBps Price slippage tolerance in basis points (e.g., 100 = 1%)
    /// @param recipient The address to receive output tokens
    /// @return amountOut The actual output amount
    function swapV3(
        address pool,
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMin,
        uint256 slippageBps,
        address recipient
    ) external returns (uint256 amountOut) {
        // Validation
        if (amountIn == 0) revert ZeroAmount();
        if (pool == address(0) || recipient == address(0)) revert ZeroAddress();

        V3SwapState memory state;
        IUniswapV3Pool poolContract = IUniswapV3Pool(pool);
        state.token0 = poolContract.token0();
        state.token1 = poolContract.token1();

        // Determine swap direction
        state.zeroForOne = tokenIn == state.token0;
        if (!state.zeroForOne && tokenIn != state.token1) {
            revert InvalidTokenIn(tokenIn, state.token0, state.token1);
        }

        state.tokenOut = state.zeroForOne ? state.token1 : state.token0;
        state.balanceBefore = IERC20(state.tokenOut).balanceOf(recipient);

        // Get current price and calculate limit with slippage
        uint160 sqrtPriceLimitX96 = _calculateV3PriceLimit(poolContract, state.zeroForOne, slippageBps);

        // Execute swap
        _executeV3Swap(poolContract, tokenIn, amountIn, state.zeroForOne, sqrtPriceLimitX96, recipient);

        // Calculate actual output
        amountOut = IERC20(state.tokenOut).balanceOf(recipient) - state.balanceBefore;

        // Slippage check
        if (amountOut < amountOutMin) {
            revert InsufficientOutputAmount(amountOut, amountOutMin);
        }

        emit SwapV3Executed(pool, tokenIn, state.tokenOut, amountIn, amountOut, recipient);
    }

    /// @dev Calculate V3 price limit from current price + slippage
    /// @param poolContract The V3 pool
    /// @param zeroForOne Swap direction
    /// @param slippageBps Slippage in basis points
    /// @return sqrtPriceLimitX96 The calculated price limit
    function _calculateV3PriceLimit(
        IUniswapV3Pool poolContract,
        bool zeroForOne,
        uint256 slippageBps
    ) internal view returns (uint160 sqrtPriceLimitX96) {
        // Get current sqrt price from pool
        (uint160 currentSqrtPriceX96, , , , , , ) = poolContract.slot0();

        if (zeroForOne) {
            // Selling token0 for token1: price goes DOWN, limit is LOWER
            // sqrtPriceLimit = currentPrice * (1 - slippage/2)
            // We use slippage/2 because sqrtPrice, not price
            uint256 multiplier = BPS_DENOMINATOR - (slippageBps / 2);
            sqrtPriceLimitX96 = uint160((uint256(currentSqrtPriceX96) * multiplier) / BPS_DENOMINATOR);

            // Ensure we don't go below absolute minimum
            if (sqrtPriceLimitX96 < MIN_SQRT_RATIO) {
                sqrtPriceLimitX96 = MIN_SQRT_RATIO + 1;
            }
        } else {
            // Selling token1 for token0: price goes UP, limit is HIGHER
            uint256 multiplier = BPS_DENOMINATOR + (slippageBps / 2);
            sqrtPriceLimitX96 = uint160((uint256(currentSqrtPriceX96) * multiplier) / BPS_DENOMINATOR);

            // Ensure we don't go above absolute maximum
            if (sqrtPriceLimitX96 > MAX_SQRT_RATIO) {
                sqrtPriceLimitX96 = MAX_SQRT_RATIO - 1;
            }
        }
    }

    /// @dev Execute V3 swap with callback
    function _executeV3Swap(
        IUniswapV3Pool poolContract,
        address tokenIn,
        uint256 amountIn,
        bool zeroForOne,
        uint160 sqrtPriceLimitX96,
        address recipient
    ) internal {
        // Encode callback data
        bytes memory data = abi.encode(
            V3CallbackData({
                tokenIn: tokenIn,
                payer: msg.sender
            })
        );

        // Set expected pool for callback validation (security)
        _expectedPool = address(poolContract);

        // Execute swap (positive amountSpecified = exact input)
        poolContract.swap(
            recipient,
            zeroForOne,
            int256(amountIn),
            sqrtPriceLimitX96,
            data
        );

        // Clear expected pool after swap completes
        _expectedPool = address(0);
    }

    /// @dev Internal callback handler for V3 swaps
    function _handleV3Callback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) internal {
        // Validate caller is the expected pool (security)
        if (msg.sender != _expectedPool) revert InvalidCallbackCaller();

        // Decode callback data
        V3CallbackData memory decoded = abi.decode(data, (V3CallbackData));

        // Determine amount to pay (positive delta = amount owed to pool)
        uint256 amountToPay = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);

        // Transfer tokens from original payer to pool (using safe transfer for non-standard ERC20s)
        (bool success, bytes memory returndata) = decoded.tokenIn.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, decoded.payer, msg.sender, amountToPay)
        );
        if (!success || (returndata.length > 0 && !abi.decode(returndata, (bool)))) {
            revert TransferFailed();
        }
    }

    /// @notice Uniswap V3 swap callback
    /// @dev Called by the pool after swap to collect input tokens
    /// @param amount0Delta Amount of token0 owed (positive = owed to pool)
    /// @param amount1Delta Amount of token1 owed (positive = owed to pool)
    /// @param data Encoded callback data containing tokenIn and payer
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external {
        _handleV3Callback(amount0Delta, amount1Delta, data);
    }

    /// @notice PancakeSwap V3 swap callback (same as Uniswap V3)
    /// @dev PancakeSwap V3 uses a different callback name
    function pancakeV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external {
        _handleV3Callback(amount0Delta, amount1Delta, data);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // View Functions
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Calculate expected output for V2 swap (view function)
    /// @param pair The V2 pair address
    /// @param tokenIn The input token address
    /// @param amountIn The input amount
    /// @return amountOut Expected output amount
    function getAmountOutV2(
        address pair,
        address tokenIn,
        uint256 amountIn
    ) external view returns (uint256 amountOut) {
        IUniswapV2Pair pairContract = IUniswapV2Pair(pair);
        address token0 = pairContract.token0();

        (uint112 reserve0, uint112 reserve1, ) = pairContract.getReserves();

        bool isToken0 = tokenIn == token0;
        (uint256 reserveIn, uint256 reserveOut) = isToken0
            ? (uint256(reserve0), uint256(reserve1))
            : (uint256(reserve1), uint256(reserve0));

        amountOut = _getAmountOut(amountIn, reserveIn, reserveOut);
    }
}
