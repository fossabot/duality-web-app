import React, { useState, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowUpLong,
  faArrowDownLong,
} from '@fortawesome/free-solid-svg-icons';

import TokenInputGroup from '../../components/TokenInputGroup';
import {
  useTokens,
  useDotCounter,
  Token,
} from '../../components/TokenPicker/mockHooks';

import { useWeb3 } from '../../lib/web3/useWeb3';
import { MsgSwap } from '../../lib/web3/generated/duality/nicholasdotsol.duality.router/module/types/router/tx';

import { getRouterEstimates, useRouterResult } from './hooks/useRouter';
import { useSwap } from './hooks/useSwap';

import './Swap.scss';

const { REACT_APP__COIN_MIN_DENOM_EXP = '18' } = process.env;
const denomExponent = parseInt(REACT_APP__COIN_MIN_DENOM_EXP) || 0;

export default function Swap() {
  const { address } = useWeb3();
  const { data: tokenList = [], isValidating: isValidaingTokens } = useTokens();
  const [tokenA, setTokenA] = useState(tokenList[0] as Token | undefined);
  const [tokenB, setTokenB] = useState(undefined as Token | undefined);
  const [valueA, setValueA] = useState<string | undefined>('0');
  const [valueB, setValueB] = useState<string>();
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
    error: rateError,
  } = useRouterResult({
    tokenA: tokenA?.address,
    tokenB: tokenB?.address,
    valueA: lastUpdatedA ? valueA : undefined,
    valueB: lastUpdatedA ? undefined : valueB,
  });
  const rateData = getRouterEstimates(pairRequest, routerResult);
  const [swapRequest, setSwapRequest] = useState<MsgSwap>();
  const {
    data: swapResponse,
    isValidating: isValidatingSwap,
    error: swapError,
  } = useSwap(swapRequest);
  const dotCount = useDotCounter(0.25e3);

  const valueAConverted = lastUpdatedA ? valueA : rateData?.valueA;
  const valueBConverted = lastUpdatedA ? rateData?.valueB : valueB;

  const swapTokens = useCallback(
    function () {
      setTokenA(tokenB);
      setTokenB(tokenA);
      setValueA(valueBConverted);
      setValueB(valueAConverted);
      setLastUpdatedA((flag) => !flag);
    },
    [tokenA, tokenB, valueAConverted, valueBConverted]
  );

  const onFormSubmit = useCallback(
    function (event?: React.FormEvent<HTMLFormElement>) {
      if (event) event.preventDefault();
      if (address && routerResult) {
        // convert to swap request format
        const result = routerResult;
        // Cosmos requires tokens in integer format of smallest denomination
        setSwapRequest({
          amountIn: result.amountIn.toFixed(denomExponent),
          tokenIn: result.tokenIn,
          tokenOut: result.tokenOut,
          // TODO: add tolerance factor
          minOut: result.amountOut.toFixed(denomExponent),
          creator: address,
        });
      }
    },
    [address, routerResult]
  );

  const onValueAChanged = useCallback((newValue: string) => {
    setValueA(newValue);
    setLastUpdatedA(true);
  }, []);
  const onValueBChanged = useCallback((newValue: string) => {
    setValueB(newValue);
    setLastUpdatedA(false);
  }, []);

  return (
    <form onSubmit={onFormSubmit} className="swap-page">
      <div className="card page-card">
        <h2 className="card-title">Trade</h2>
        <div className="card-row">
          <TokenInputGroup
            onValueChanged={onValueAChanged}
            onTokenChanged={setTokenA}
            tokenList={tokenList}
            token={tokenA}
            value={valueAConverted}
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
        <div className="card-row">
          <button
            type="button"
            onClick={swapTokens}
            className="icon-button mx-auto"
          >
            <FontAwesomeIcon icon={faArrowUpLong}></FontAwesomeIcon>
            <FontAwesomeIcon icon={faArrowDownLong}></FontAwesomeIcon>
          </button>
        </div>
        <div className="card-row">
          <TokenInputGroup
            onValueChanged={onValueBChanged}
            onTokenChanged={setTokenB}
            tokenList={tokenList}
            token={tokenB}
            value={valueBConverted}
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
        <div className="text-secondary text-row card-row">
          <span className="text-header">Gas price</span>
          <span className="text-value">{rateData?.gas}</span>
        </div>
        {swapRequest && swapError && (
          <div className="text-error card-row">{swapError}</div>
        )}
        {rateError && <div className="text-error card-row">{rateError}</div>}
        {isValidaingTokens ||
          (isValidatingRate && (
            <div className="text-secondary card-row">
              {'.'.repeat(dotCount)}
            </div>
          ))}
        {!isValidatingSwap && swapResponse && (
          <div className="text-secondary card-row">
            Swapped {valueAConverted} {tokenA?.address} for {valueBConverted}{' '}
            {tokenB?.address}
          </div>
        )}
        <input type="submit" value="Swap" />
      </div>
    </form>
  );
}
