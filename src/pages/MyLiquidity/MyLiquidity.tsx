import { Flex, Heading } from '@chakra-ui/react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import BigNumber from 'bignumber.js';

import { DexShare } from '../../lib/web3/generated/duality/nicholasdotsol.duality.dex/module/rest';
import {
  useBankBalances,
  useIndexerData,
  useShares,
  TickInfo,
} from '../../lib/web3/indexerProvider';
import { useWeb3 } from '../../lib/web3/useWeb3';
import { useSimplePrice } from '../../lib/tokenPrices';
import { Token, useDualityTokens } from '../../components/TokenPicker/hooks';

import './MyLiquidity.scss';

interface ShareValue {
  share: DexShare;
  token0: Token;
  token1: Token;
  tick?: TickInfo;
  userReserves0?: BigNumber;
  userReserves1?: BigNumber;
}
interface ShareValueMap {
  [pairID: string]: Array<ShareValue>;
}

export default function MyLiquidity() {
  const { wallet } = useWeb3();
  const { data: balances, isValidating } = useBankBalances();

  const { data: indexer } = useIndexerData();
  const { data: shares } = useShares();
  const dualityTokens = useDualityTokens();

  const shareValueMap = useMemo(() => {
    if (shares && indexer) {
      return shares.reduce<ShareValueMap>((result, share) => {
        const token0 = dualityTokens.find(
          (token) => token.address === share.token0
        );
        const token1 = dualityTokens.find(
          (token) => token.address === share.token1
        );
        if (token0 && token1) {
          const extendedShare: ShareValue = { share, token0, token1 };
          const pairID = `${share.token0}-${share.token1}`;
          const tickID = `${share.price}-${share.fee}`;
          const tick = indexer[pairID]?.ticks?.[tickID]?.find(Boolean);
          // add optional tick data from indexer
          if (tick && tick.totalShares.isGreaterThan(0)) {
            const shareFraction = new BigNumber(
              share.shareAmount ?? 0
            ).dividedBy(tick.totalShares);
            extendedShare.userReserves0 = shareFraction.multipliedBy(
              tick.reserve0
            );
            extendedShare.userReserves1 = shareFraction.multipliedBy(
              tick.reserve1
            );
            extendedShare.tick = tick;
          }
          result[pairID] = result[pairID] || [];
          result[pairID].push(extendedShare);
        }
        return result;
      }, {});
    }
  }, [shares, indexer, dualityTokens]);

  if (!wallet || (!isValidating && (!balances || balances.length === 0))) {
    return (
      <Flex
        className="no-liquidity"
        flexDirection="column"
        gap="1.25em"
        alignItems="center"
      >
        <Heading size="lg"> No liquidity positions found</Heading>
        <Link to="/add-liquidity">
          <button className="button button-info add-liquidity p-3 px-4">
            Add new liquidity
          </button>
        </Link>
      </Flex>
    );
  }

  return (
    <div className="my-liquidity-page">
      {shareValueMap &&
        Object.entries(shareValueMap).map(([pairID, shareValues]) => {
          return (
            <PositionCard
              key={pairID}
              token0={shareValues[0].token0}
              token1={shareValues[0].token1}
              shareValues={shareValues}
            />
          );
        })}
    </div>
  );
}

function PositionCard({
  token0,
  token1,
  shareValues,
}: {
  token0: Token;
  token1: Token;
  shareValues: Array<ShareValue>;
}) {
  const {
    data: [price0, price1],
  } = useSimplePrice([token0, token1]);
  if (token0 && token1) {
    const [total0, total1] = shareValues.reduce<[BigNumber, BigNumber]>(
      ([total0, total1], shareValue) => {
        return [
          total0.plus(shareValue.userReserves0 || 0),
          total1.plus(shareValue.userReserves1 || 0),
        ];
      },
      [new BigNumber(0), new BigNumber(0)]
    );
    const value0 = price0 && total0.multipliedBy(price0);
    const value1 = price1 && total1.multipliedBy(price1);

    return (
      <div className="page-card">
        <div className="heading">
          {token0.symbol} + {token1.symbol}
        </div>
        <div className="content">
          <div className="share-total">
            <div className="balance row">
              <div className="col">Balance</div>
              <div className="col ml-auto">
                {value0 && value1 && <>${value0.plus(value1).toFixed(2)}</>}
              </div>
            </div>
            <div className="value-text row">
              <div className="value-0 col">
                {total0.toFixed()} {token0.symbol}{' '}
                {value0 && <>(${value0.toFixed(2)})</>}
              </div>
              <div className="value-1 col ml-auto">
                {total1.toFixed()} {token1.symbol}{' '}
                {value1 && <>(${value1.toFixed(2)})</>}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return null;
}
