import useSWR from 'swr';
import { useEffect, useMemo } from 'react';
import { Asset } from '@chain-registry/types';

import { ObservableList, useObservableList } from './utils/observableList';

const { REACT_APP__DEV_ASSET_PRICE_MAP } = import.meta.env;

const baseAPI = 'https://api.coingecko.com/api/v3';

const devTokenPriceMap: Record<string, number> = (() => {
  try {
    return JSON.parse(REACT_APP__DEV_ASSET_PRICE_MAP || '{}');
  } catch {
    return {};
  }
})();

function getDevAssetPrice(asset: Asset | undefined): number | undefined {
  return asset ? devTokenPriceMap[asset.base] : undefined;
}

class FetchError extends Error {
  info?: object;
  status?: number;
}

async function fetcher(url: string) {
  const res = await fetch(`${baseAPI}${url}`, {
    headers: {
      accept: 'application/json',
    },
  });

  // If the status code is not in the range 200-299,
  // we still try to parse and throw it.
  if (!res.ok) {
    const error = new FetchError(
      `Price API error (${res.status || 0}): ${res.statusText || '(no text)'}`
    );
    // Attach extra info to the error object.
    error.info = await res.json().catch(() => undefined);
    error.status = res.status || 0;
    throw error;
  }

  return res.json();
}

interface CoinGeckoSimplePrice {
  [tokenID: string]: {
    [currencyID: string]: number;
  };
}

const currentRequests = new ObservableList<TokenRequests>();

// single request, eg: ATOM/USD
type TokenRequest = [tokenID: string, currencyID: string];

// component requests, eg: [ATOM/USD, ETH/USD]
type TokenRequests = Array<TokenRequest>; // eg. [ATOM/USD, ETH/USD]

function useCombinedSimplePrices(
  tokenIDs: (string | undefined)[],
  currencyID: string
) {
  const tokenIDsString = tokenIDs.filter(Boolean).join(',');
  const [
    allTokenRequests,
    { add: addTokenRequest, remove: removeTokenRequest },
  ] = useObservableList<TokenRequests>(currentRequests);

  // synchronize hook with global state
  useEffect(() => {
    // set callback to update local state
    if (tokenIDsString && currencyID) {
      // define this components requests
      const requests: TokenRequests = tokenIDsString
        .split(',')
        .map((tokenID) => {
          return [tokenID, currencyID];
        });
      // add requests
      addTokenRequest(requests);
      return () => {
        // remove old requests
        removeTokenRequest(requests);
      };
    }
  }, [tokenIDsString, currencyID, addTokenRequest, removeTokenRequest]);

  // get all current unique request IDs
  const allTokenIDs = allTokenRequests.reduce(
    (result, currentTokenRequest) => {
      currentTokenRequest.forEach(([tokenID, currencyID]) => {
        result.tokenIDs.add(tokenID);
        result.currencyIDs.add(currencyID);
      });
      return result;
    },
    { tokenIDs: new Set(), currencyIDs: new Set() }
  );
  // consdense out ID values into array strings
  const allTokenIDsString = Array.from(allTokenIDs.tokenIDs.values()).join(',');
  const allCurrencyIDsString = Array.from(
    allTokenIDs.currencyIDs.values()
  ).join(',');

  // create query with all current combinations
  return useSWR<CoinGeckoSimplePrice, FetchError>(
    allTokenIDsString.length && allCurrencyIDsString.length > 0
      ? `/simple/price?ids=${allTokenIDsString}&vs_currencies=${allCurrencyIDsString}`
      : null,
    fetcher,
    {
      // refresh and refetch infrequently to stay below API limits
      refreshInterval: 30000,
      dedupingInterval: 30000,
      focusThrottleInterval: 30000,
      errorRetryInterval: 30000,
    }
  );
}

const warned = new Set();
export function useSimplePrices(
  assets: (Asset | undefined)[],
  currencyID = 'usd'
) {
  const assetIDs = assets.map((asset) => {
    // note Coin Gecko ID warning for developers
    if (asset && !asset.coingecko_id) {
      const tokenID = JSON.stringify(asset);
      if (!warned.has(tokenID)) {
        // eslint-disable-next-line no-console
        console.warn(
          `Token ${asset.name} (${asset.symbol}) has no CoinGecko ID`
        );
        warned.add(tokenID);
      }
    }
    return asset?.coingecko_id;
  });

  return useCombinedSimplePrices(assetIDs, currencyID);
}

export function useSimplePrice(
  token: Asset | undefined,
  currencyID?: string
): {
  data: number | undefined;
  error: FetchError | undefined;
  isValidating: boolean;
};
export function useSimplePrice(
  assets: (Asset | undefined)[],
  currencyID?: string
): {
  data: (number | undefined)[];
  error: FetchError | undefined;
  isValidating: boolean;
};
export function useSimplePrice(
  tokenOrTokens: (Asset | undefined) | (Asset | undefined)[],
  currencyID = 'usd'
) {
  const assets = useMemo(() => {
    return Array.isArray(tokenOrTokens) ? tokenOrTokens : [tokenOrTokens];
  }, [tokenOrTokens]);

  const { data, error, isValidating } = useSimplePrices(assets, currencyID);

  // cache the found result array so it doesn't generate updates if the values are equal
  const cachedResults = useMemo(() => {
    // return found results as numbers
    return assets.map((asset) =>
      asset?.coingecko_id
        ? // if the information is fetchable, return fetched (number) or not yet fetched (undefined)
          (data?.[asset.coingecko_id]?.[currencyID] as number | undefined)
        : // if the information is not fetchable, return a dev asset price or 0 (unpriced)
          getDevAssetPrice(asset) || 0
    );
  }, [assets, data, currencyID]);

  return {
    // return array of results or singular result depending on how it was asked
    data: Array.isArray(tokenOrTokens) ? cachedResults : cachedResults[0],
    error,
    isValidating,
  };
}

export function usePairPrice(
  assetA: Asset | undefined,
  assetB: Asset | undefined,
  currencyID?: string
) {
  const assetAResponse = useSimplePrice(assetA, currencyID);
  const assetBResponse = useSimplePrice(assetB, currencyID);
  const { data: tokenAPrice } = assetAResponse;
  const { data: tokenBPrice } = assetBResponse;
  const price =
    tokenAPrice !== undefined && tokenBPrice !== undefined
      ? tokenBPrice / tokenAPrice
      : undefined;
  return {
    data: price,
    isValidating: assetAResponse.isValidating || assetBResponse.isValidating,
    error: assetAResponse.error || assetBResponse.error,
  };
}

export function useHasPriceData(
  assets: (Asset | undefined)[],
  currencyID = 'usd'
) {
  const { data, isValidating } = useSimplePrice(assets, currencyID);
  // do not claim price data if assets won't use any CoinGecko lookups
  if (assets.every((asset) => !!asset?.coingecko_id)) {
    return false;
  }
  return isValidating || data.some(Boolean);
}
