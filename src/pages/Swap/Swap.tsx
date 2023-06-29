import React, { useState, useCallback, useEffect, useMemo } from 'react';
import BigNumber from 'bignumber.js';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBolt,
  faFlag,
  faArrowRightArrowLeft,
  faSliders,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';

import TokenInputGroup from '../../components/TokenInputGroup';
import { useTokens } from '../../components/TokenPicker/hooks';
import RadioButtonGroupInput from '../../components/RadioButtonGroupInput/RadioButtonGroupInput';
import NumberInput, {
  useNumericInputState,
} from '../../components/inputs/NumberInput';
import PriceDataDisclaimer from '../../components/PriceDataDisclaimer';

import { useWeb3 } from '../../lib/web3/useWeb3';
import { useBankBalance } from '../../lib/web3/indexerProvider';
import { useOrderedTokenPair } from '../../lib/web3/hooks/useTokenPairs';
import { useTokenPairTickLiquidity } from '../../lib/web3/hooks/useTickLiquidity';

import { getRouterEstimates, useRouterResult } from './hooks/useRouter';
import { useSwap } from './hooks/useSwap';

import { formatAmount } from '../../lib/utils/number';
import { Token, getAmountInDenom } from '../../lib/web3/utils/tokens';
import { formatLongPrice } from '../../lib/utils/number';

import './Swap.scss';

type CardType = 'trade' | 'settings';
type OrderType = 'market' | 'limit';

const defaultSlippage = '0.5';

export default function SwapPage() {
  return (
    <div className="container row">
      <div className="page col m-auto">
        <Swap />
      </div>
    </div>
  );
}

function Swap() {
  const { address, connectWallet } = useWeb3();
  const tokenList = useTokens();
  const [tokenA, setTokenA] = useState(
    tokenList.find((token) => token.symbol === 'TKN') as Token | undefined
  );
  const [tokenB, setTokenB] = useState(undefined as Token | undefined);
  const [inputValueA, setInputValueA, valueA = '0'] = useNumericInputState();
  const [inputValueB, setInputValueB, valueB = '0'] = useNumericInputState();
  const [lastUpdatedA, setLastUpdatedA] = useState(true);
  const pairRequest = {
    tokenA: tokenA?.address,
    tokenB: tokenB?.address,
    valueA: lastUpdatedA ? valueA : undefined,
    valueB: lastUpdatedA ? undefined : valueB,
  };
  const {
    data: routerResult,
    isValidating: isValidatingRate,
    error,
  } = useRouterResult({
    tokenA: tokenA?.address,
    tokenB: tokenB?.address,
    valueA: lastUpdatedA ? valueA : undefined,
    valueB: lastUpdatedA ? undefined : valueB,
  });

  const rateData = getRouterEstimates(pairRequest, routerResult);
  const [{ isValidating: isValidatingSwap }, swapRequest] = useSwap();

  const valueAConverted = lastUpdatedA ? valueA : rateData?.valueA;
  const valueBConverted = lastUpdatedA ? rateData?.valueB : valueB;

  const swapTokens = useCallback(
    function () {
      setTokenA(tokenB);
      setTokenB(tokenA);
      setInputValueA(valueBConverted || '');
      setInputValueB(valueAConverted || '');
      setLastUpdatedA((flag) => !flag);
    },
    [
      tokenA,
      tokenB,
      valueAConverted,
      valueBConverted,
      setInputValueA,
      setInputValueB,
    ]
  );

  const { data: balanceTokenA } = useBankBalance(tokenA);
  const valueAConvertedNumber = new BigNumber(valueAConverted || 0);
  const hasFormData =
    address && tokenA && tokenB && valueAConvertedNumber.isGreaterThan(0);
  const hasSufficientFunds =
    valueAConvertedNumber.isLessThanOrEqualTo(balanceTokenA || 0) || false;

  const [inputSlippage, setInputSlippage, slippage = '0'] =
    useNumericInputState(defaultSlippage);

  const [token0, token1] =
    useOrderedTokenPair([tokenA?.address, tokenB?.address]) || [];
  const {
    data: [token0Ticks, token1Ticks],
  } = useTokenPairTickLiquidity([token0, token1]);

  const onFormSubmit = useCallback(
    function (event?: React.FormEvent<HTMLFormElement>) {
      if (event) event.preventDefault();
      // calculate tolerance from user slippage settings
      // set tiny minimum of tolerance as the frontend calculations
      // don't always exactly align with the backend calculations
      const tolerance = Math.max(1e-12, parseFloat(slippage) / 100);
      if (address && routerResult && tokenA && tokenB && !isNaN(tolerance)) {
        // convert to swap request format
        const result = routerResult;
        // Cosmos requires tokens in integer format of smallest denomination
        // add slippage tolerance
        const minOut = result.amountOut.multipliedBy(1 - tolerance);
        // calculate gas estimate
        const tickMin =
          routerResult.tickIndexIn &&
          routerResult.tickIndexOut &&
          Math.min(
            routerResult.tickIndexIn.negated().toNumber(),
            routerResult.tickIndexOut.negated().toNumber()
          );
        const tickMax =
          routerResult.tickIndexIn &&
          routerResult.tickIndexOut &&
          Math.max(
            routerResult.tickIndexIn.negated().toNumber(),
            routerResult.tickIndexOut.negated().toNumber()
          );
        const forward = result.tokenIn === token0;
        const ticks = forward ? token1Ticks : token0Ticks;
        const ticksPassed =
          (tickMin !== undefined &&
            tickMax !== undefined &&
            ticks?.filter((tick) => {
              return (
                tick.tickIndex.isGreaterThanOrEqualTo(tickMin) &&
                tick.tickIndex.isLessThanOrEqualTo(tickMax)
              );
            })) ||
          [];
        const ticksUsed =
          ticksPassed?.filter(
            forward
              ? (tick) => !tick.reserve1.isZero()
              : (tick) => !tick.reserve0.isZero()
          ).length || 0;
        const ticksUnused =
          new Set<number>([
            ...(ticksPassed?.map((tick) => tick.tickIndex.toNumber()) || []),
          ]).size - ticksUsed;
        const gasEstimate = ticksUsed
          ? // 120000 base
            120000 +
            // add 80000 if multiple ticks need to be traversed
            (ticksUsed > 1 ? 80000 : 0) +
            // add 1000000 for each tick that we need to remove liquidity from
            1000000 * (ticksUsed - 1) +
            // add 500000 for each tick we pass without drawing liquidity from
            500000 * ticksUnused +
            // add another 500000 for each reverse tick we pass without drawing liquidity from
            (forward ? 0 : 500000 * ticksUnused)
          : 0;

        swapRequest(
          {
            amountIn:
              getAmountInDenom(tokenA, result.amountIn, tokenA?.display) || '0',
            tokenIn: result.tokenIn,
            tokenA: result.tokenIn,
            tokenB: result.tokenOut,
            minOut: getAmountInDenom(tokenB, minOut, tokenB?.display) || '0',
            creator: address,
            receiver: address,
            // todo: allow custom limit price to be set by the user
            limitPrice: '0',
          },
          gasEstimate
        );
      }
    },
    [
      address,
      routerResult,
      tokenA,
      tokenB,
      token0,
      token0Ticks,
      token1Ticks,
      slippage,
      swapRequest,
    ]
  );

  const onValueAChanged = useCallback(
    (newInputValue = '') => {
      setInputValueA(newInputValue);
      setLastUpdatedA(true);
    },
    [setInputValueA]
  );
  const onValueBChanged = useCallback(
    (newInputValue = '') => {
      setInputValueB(newInputValue);
      setLastUpdatedA(false);
    },
    [setInputValueB]
  );

  const [cardType, setCardType] = useState<CardType>('trade');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [rateTokenOrderAuto, setRateTokenOrderAuto] =
    useState<[Token, Token]>();
  const [rateTokenOrderManual, setRateTokenOrderManual] =
    useState<[Token, Token]>();
  const rateTokenOrder = rateTokenOrderManual || rateTokenOrderAuto;

  const toggleRateTokenOrderManual = useCallback(() => {
    setRateTokenOrderManual(
      (tokens) =>
        (tokens || rateTokenOrderAuto)?.slice().reverse() as [Token, Token]
    );
  }, [rateTokenOrderAuto]);

  // set the token order for the rate
  useEffect(() => {
    if (tokenA && tokenB) {
      // place B as stable denominator
      if (!isStablecoin(tokenA) && isStablecoin(tokenB)) {
        setRateTokenOrderAuto([tokenA, tokenB]);
      }
      // place in order of swap trade
      else {
        setRateTokenOrderAuto([tokenB, tokenA]);
      }
    }
    function isStablecoin(token: Token) {
      return token.description?.toLowerCase().includes('stablecoin');
    }
  }, [tokenA, tokenB]);

  // if tokens change then reset the manual order setting
  useEffect(() => {
    if (tokenA && tokenB) {
      setRateTokenOrderManual((tokenOrder) => {
        // keep settings if tokens have not changed
        if (tokenOrder?.every((token) => [tokenA, tokenB].includes(token))) {
          return tokenOrder;
        }
        // remove settings if they have
        return undefined;
      });
    }
  }, [tokenA, tokenB]);

  const priceImpact =
    routerResult &&
    routerResult.priceIn?.isGreaterThan(0) &&
    routerResult.priceOut?.isGreaterThan(0)
      ? new BigNumber(
          new BigNumber(routerResult.priceOut)
            .dividedBy(new BigNumber(routerResult.priceIn))
            .multipliedBy(100)
        ).minus(100)
      : undefined;

  const tradeCard = (
    <div className="trade-card">
      <div className="page-card">
        <div className="row mb-3">
          <h3 className="h3 card-title">Trade</h3>
          <button
            className="icon-button ml-auto"
            type="button"
            onClick={() => setCardType('settings')}
          >
            <FontAwesomeIcon icon={faSliders}></FontAwesomeIcon>
          </button>
        </div>
        <div className="card-row order-type mb-4">
          <RadioButtonGroupInput<OrderType>
            className="order-type-input mb-4 hide"
            values={useMemo(
              () => ({
                market: (
                  <>
                    <FontAwesomeIcon
                      className="mr-3"
                      icon={faBolt}
                    ></FontAwesomeIcon>
                    Market Order
                  </>
                ),
                limit: (
                  <>
                    <FontAwesomeIcon
                      className="mr-3"
                      icon={faFlag}
                    ></FontAwesomeIcon>
                    Limit Order
                  </>
                ),
              }),
              []
            )}
            value={orderType}
            onChange={setOrderType}
          />
        </div>
        <div className="card-row">
          <TokenInputGroup
            variant={
              (!hasSufficientFunds || error?.insufficientLiquidityIn) && 'error'
            }
            onValueChanged={onValueAChanged}
            onTokenChanged={setTokenA}
            tokenList={tokenList}
            token={tokenA}
            value={lastUpdatedA ? inputValueA : valueAConverted}
            className={
              isValidatingRate && !lastUpdatedA
                ? valueAConverted
                  ? 'estimated-rate'
                  : 'loading-token'
                : ''
            }
            exclusion={tokenB}
          ></TokenInputGroup>
        </div>
        <div className="card-row my-3">
          <button
            type="button"
            onClick={swapTokens}
            className="icon-button swap-button"
          >
            <FontAwesomeIcon
              icon={faArrowRightArrowLeft}
              rotation={90}
            ></FontAwesomeIcon>
          </button>
        </div>
        <div className="card-row">
          <TokenInputGroup
            variant={error?.insufficientLiquidityOut && 'error'}
            onValueChanged={onValueBChanged}
            onTokenChanged={setTokenB}
            tokenList={tokenList}
            token={tokenB}
            value={lastUpdatedA ? valueBConverted : inputValueB}
            className={
              isValidatingRate && lastUpdatedA
                ? valueBConverted
                  ? 'estimated-rate'
                  : 'loading-token'
                : ''
            }
            exclusion={tokenA}
            disabledInput={true}
          ></TokenInputGroup>
        </div>
        <div className="card-row text-detail">
          {tokenA &&
            tokenB &&
            parseFloat(valueAConverted || '') > 0 &&
            parseFloat(valueBConverted || '') > 0 && (
              <div className="text-grid my-4">
                <span className="text-header">Exchange Rate</span>
                <span className="text-value">
                  {routerResult && rateTokenOrder ? (
                    <>
                      1 {rateTokenOrder[1].symbol} ={' '}
                      {formatLongPrice(
                        routerResult.tokenIn === rateTokenOrder[1].address
                          ? routerResult.amountOut
                              .dividedBy(routerResult.amountIn)
                              .toFixed()
                          : routerResult.amountIn
                              .dividedBy(routerResult.amountOut)
                              .toFixed()
                      )}{' '}
                      {rateTokenOrder[0].symbol}
                      <button
                        className="icon-button ml-3"
                        type="button"
                        onClick={toggleRateTokenOrderManual}
                      >
                        <FontAwesomeIcon
                          icon={faArrowRightArrowLeft}
                        ></FontAwesomeIcon>
                      </button>
                    </>
                  ) : isValidatingRate ? (
                    'Finding exchange rate...'
                  ) : (
                    'No exchange information'
                  )}
                </span>
                <span className="text-header">Price Impact</span>
                {priceImpact && (
                  <span
                    className={[
                      'text-value',
                      (() => {
                        switch (true) {
                          case priceImpact.isGreaterThanOrEqualTo(0):
                            return 'text-success';
                          case priceImpact.isGreaterThan(-1):
                            return 'text-value';
                          case priceImpact.isGreaterThan(-5):
                            return 'text';
                          default:
                            return 'text-error';
                        }
                      })(),
                    ].join(' ')}
                  >
                    {formatAmount(priceImpact.toFixed(), {
                      maximumSignificantDigits: 4,
                      minimumSignificantDigits: 4,
                    })}
                    %
                  </span>
                )}
              </div>
            )}
        </div>
        <div className="mt-4">
          {address ? (
            hasFormData &&
            hasSufficientFunds &&
            !error?.insufficientLiquidity &&
            !error?.insufficientLiquidityIn &&
            !error?.insufficientLiquidityOut ? (
              <button
                className="submit-button button-primary"
                type="submit"
                disabled={!new BigNumber(valueBConverted || 0).isGreaterThan(0)}
              >
                {orderType === 'limit' ? 'Place Limit Order' : 'Swap'}
              </button>
            ) : error?.insufficientLiquidity ? (
              <button className="submit-button button-error" type="button">
                Insufficient liquidity
              </button>
            ) : hasFormData ? (
              <button className="submit-button button-error" type="button">
                Insufficient funds
              </button>
            ) : (
              <button
                className="submit-button button-primary"
                type="button"
                disabled
              >
                Enter Token Amount
              </button>
            )
          ) : (
            <button
              className="submit-button button-dark"
              type="button"
              onClick={connectWallet}
            >
              Connect Wallet
            </button>
          )}
        </div>
        <PriceDataDisclaimer tokenA={tokenA} tokenB={tokenB} />
      </div>
      <SettingsCard
        cardType={cardType}
        setCardType={setCardType}
        inputSlippage={inputSlippage}
        setInputSlippage={setInputSlippage}
      />
    </div>
  );
  return (
    <form
      onSubmit={onFormSubmit}
      className={['swap-page page-card p-0 row', isValidatingSwap && 'disabled']
        .filter(Boolean)
        .join(' ')}
    >
      {tradeCard}
    </form>
  );
}

function SettingsCard({
  cardType,
  setCardType,
  inputSlippage,
  setInputSlippage,
}: {
  cardType: CardType;
  setCardType: React.Dispatch<React.SetStateAction<CardType>>;
  inputSlippage: string;
  setInputSlippage: React.Dispatch<React.SetStateAction<string>>;
}) {
  return (
    <div
      className={[
        'settings-card',
        `settings-card--${cardType === 'settings' ? 'visible' : 'hidden'}`,
      ].join(' ')}
    >
      <div className="page-card">
        <div className="row mb-4">
          <h3 className="h3 card-title">Settings</h3>
          <button
            className="icon-button ml-auto"
            type="button"
            onClick={() => setCardType('trade')}
          >
            <FontAwesomeIcon icon={faXmark}></FontAwesomeIcon>
          </button>
        </div>
        <div className="row mb-3">
          <h4 className="card-title">Max Slippage</h4>
          <NumberInput
            type="text"
            className="ml-auto"
            value={inputSlippage}
            appendString="%"
            onChange={setInputSlippage}
          />
          <button
            type="button"
            className="badge badge-lg badge-info ml-2"
            onClick={() => setInputSlippage(defaultSlippage)}
          >
            Auto
          </button>
        </div>
      </div>
    </div>
  );
}
