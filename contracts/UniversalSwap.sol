// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

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
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

// V4 interfaces (for future use)
struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

interface ICLPoolManager {
    function swap(
        PoolKey calldata key,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata hookData
    ) external returns (int256 amount0, int256 amount1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// UniversalSwap Contract
// ═══════════════════════════════════════════════════════════════════════════════

/// @title UniversalSwap
/// @notice Swap tokens via V2/V3 pools directly without router mapping
/// @dev Works with any Uniswap V2/V3 fork (PancakeSwap, BiSwap, ApeSwap, Thena, etc.)
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

    /// @dev Min sqrt price limit for V3 swaps (zeroForOne = true)
    uint160 private constant MIN_SQRT_RATIO = 4295128739;

    /// @dev Max sqrt price limit for V3 swaps (zeroForOne = false)
    uint160 private constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    /// @dev BSC CLPoolManager address for V4 (future use)
    address public constant CL_POOL_MANAGER = 0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b;

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
    /// @param recipient The address to receive output tokens
    /// @return amountOut The actual output amount
    function swapV3(
        address pool,
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMin,
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

        // Execute swap
        _executeV3Swap(poolContract, tokenIn, amountIn, state.zeroForOne, recipient);

        // Calculate actual output
        amountOut = IERC20(state.tokenOut).balanceOf(recipient) - state.balanceBefore;

        // Slippage check
        if (amountOut < amountOutMin) {
            revert InsufficientOutputAmount(amountOut, amountOutMin);
        }

        emit SwapV3Executed(pool, tokenIn, state.tokenOut, amountIn, amountOut, recipient);
    }

    /// @dev Execute V3 swap with callback
    function _executeV3Swap(
        IUniswapV3Pool poolContract,
        address tokenIn,
        uint256 amountIn,
        bool zeroForOne,
        address recipient
    ) internal {
        // Encode callback data
        bytes memory data = abi.encode(
            V3CallbackData({
                tokenIn: tokenIn,
                payer: msg.sender
            })
        );

        // Set price limit based on direction
        uint160 sqrtPriceLimitX96 = zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1;

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
    // V4 Swap (Draft - Not Tested)
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Swap tokens via PancakeSwap V4 CLPoolManager
    /// @dev DRAFT - Not tested. V4 is not yet indexed by Dexscreener.
    /// @param poolKey The V4 pool key (currency0, currency1, fee, tickSpacing, hooks)
    /// @param amountIn The amount of input tokens
    /// @param amountOutMin Minimum output amount (slippage protection)
    /// @param recipient The address to receive output tokens
    /// @return amountOut The actual output amount
    function swapV4(
        PoolKey calldata poolKey,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient
    ) external returns (uint256 amountOut) {
        // Validation
        if (amountIn == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();

        // TODO: Implement V4 swap when Dexscreener adds V4 support
        // Reference: https://github.com/pancakeswap/infinity-universal-router
        //
        // Key differences from V3:
        // 1. Uses PoolManager singleton instead of individual pool contracts
        // 2. Requires unlock pattern: poolManager.unlock() then callback
        // 3. Uses BalanceDelta for token accounting
        // 4. Supports hooks for custom logic
        //
        // Pseudocode:
        // 1. Transfer tokenIn from msg.sender to this contract
        // 2. Approve PoolManager for tokenIn
        // 3. Call poolManager.unlock(encodedSwapParams)
        // 4. In unlockCallback:
        //    a. Call poolManager.swap(poolKey, swapParams)
        //    b. Settle tokenIn (poolManager.sync + transfer)
        //    c. Take tokenOut (poolManager.take)
        // 5. Transfer tokenOut to recipient
        // 6. Verify amountOut >= amountOutMin

        revert("V4 not implemented - awaiting Dexscreener support");
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
