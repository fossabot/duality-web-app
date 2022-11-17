import BigNumber from 'bignumber.js';
import {
  useState,
  useMemo,
  useCallback,
  useLayoutEffect,
  MouseEvent,
  useRef,
} from 'react';

import { formatPrice } from '../../lib/utils/number';
import { feeTypes } from '../../lib/web3/utils/fees';
import useCurrentPriceFromTicks from './useCurrentPriceFromTicks';
import useOnDragMove from '../hooks/useOnDragMove';

import { Token } from '../TokenPicker/hooks';
import { TickInfo } from '../../lib/web3/indexerProvider';

import './LiquiditySelector.scss';

export interface LiquiditySelectorProps {
  tokenA: Token;
  tokenB: Token;
  ticks: TickInfo[] | undefined;
  feeTier: number | undefined;
  userTickSelected: number | undefined;
  setUserTickSelected: (index: number) => void;
  setRangeMin: (rangeMin: string) => void;
  setRangeMax: (rangeMax: string) => void;
  userTicksBase?: Array<Tick | undefined>;
  userTicks?: Array<Tick | undefined>;
  setUserTicks?: (callback: (userTicks: TickGroup) => TickGroup) => void;
  advanced?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  canMoveX?: boolean;
  viewOnlyUserTicks?: boolean;
}

export interface Tick {
  reserveA: BigNumber;
  reserveB: BigNumber;
  tickIndex: number;
  price: BigNumber;
  fee: BigNumber;
  feeIndex: number;
  tokenA: Token;
  tokenB: Token;
}
export type TickGroup = Array<Tick>;
type TickGroupBucketsEmpty = Array<
  [lowerBound: BigNumber, upperBound: BigNumber]
>;
type TickGroupBucketsFilled = Array<
  [
    lowerBound: BigNumber,
    upperBound: BigNumber,
    reserveA: BigNumber,
    reserveB: BigNumber
  ]
>;

const bucketWidth = 50; // bucket width in pixels

function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);

  useLayoutEffect(() => {
    const handleResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return width;
}

export default function LiquiditySelector({
  ticks = [],
  tokenA,
  tokenB,
  feeTier,
  userTickSelected = -1,
  setUserTickSelected,
  setRangeMin,
  setRangeMax,
  userTicks = [],
  userTicksBase = userTicks,
  setUserTicks,
  advanced = false,
  canMoveUp,
  canMoveDown,
  canMoveX,
  viewOnlyUserTicks = false,
}: LiquiditySelectorProps) {
  // translate ticks from token0/1 to tokenA/B
  const allTicks: TickGroup = useMemo(() => {
    return (
      ticks
        // filter to only ticks that match our token set
        .filter(
          ({ token0, token1, reserve0, reserve1 }) =>
            // check that there are reserves in this tick
            (!reserve0.isZero() || !reserve1.isZero()) &&
            // check the direction is either forward or reverse
            ((token0 === tokenA && token1 === tokenB) ||
              (token1 === tokenA && token0 === tokenB))
        )
        .map(
          ({
            token0,
            token1,
            reserve0,
            reserve1,
            tickIndex,
            price,
            fee,
            feeIndex,
          }) => {
            const forward = token0 === tokenA;
            return {
              tokenA: forward ? token0 : token1,
              tokenB: forward ? token1 : token0,
              reserveA: forward ? reserve0 : reserve1,
              reserveB: forward ? reserve1 : reserve0,
              tickIndex: (forward ? tickIndex : tickIndex.negated()).toNumber(),
              price: forward ? price : new BigNumber(1).dividedBy(price),
              fee,
              feeIndex: feeIndex.toNumber(),
            };
          }
        )
    );
  }, [ticks, tokenA, tokenB]);

  // collect tick information in a more useable form
  const feeTicks: TickGroup = useMemo(() => {
    return !feeTier
      ? allTicks
      : allTicks
          // filter to only fee tier ticks
          .filter((tick) => feeTypes[tick.feeIndex]?.fee === feeTier);
  }, [allTicks, feeTier]);

  // todo: base graph start and end on existing ticks and current price
  //       (if no existing ticks exist only cuurent price can indicate start and end)

  const currentPriceFromTicks =
    useCurrentPriceFromTicks(tokenA.address, tokenB.address) || 1;

  const initialGraphStart = useMemo(() => {
    const graphStart = new BigNumber(currentPriceFromTicks).dividedBy(4);
    return graphStart.isLessThan(1 / 1.1) ? new BigNumber(1 / 1.1) : graphStart;
  }, [currentPriceFromTicks]);
  const initialGraphEnd = useMemo(() => {
    const graphEnd = new BigNumber(currentPriceFromTicks).multipliedBy(4);
    return graphEnd.isLessThan(1.1) ? new BigNumber(1.1) : graphEnd;
  }, [currentPriceFromTicks]);

  const [dataStart, dataEnd] = useMemo(() => {
    const { xMin = new BigNumber(1 / 1.1), xMax = new BigNumber(1.1) } =
      allTicks.reduce<{
        [key: string]: BigNumber;
      }>((result, { price }) => {
        if (result.xMin === undefined || price.isLessThan(result.xMin))
          result.xMin = price;
        if (result.xMax === undefined || price.isGreaterThan(result.xMax))
          result.xMax = price;
        return result;
      }, {});
    return [xMin, xMax];
  }, [allTicks]);

  // set and allow ephemeral setting of graph extents
  const [graphStart, setGraphStart] = useState(initialGraphStart);
  const [graphEnd, setGraphEnd] = useState(initialGraphEnd);

  // find container size that buckets should fit
  const [container, setContainer] = useState<SVGSVGElement | null>(null);
  const windowWidth = useWindowWidth();
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    setContainerSize({
      width: container?.clientWidth ?? 0,
      height: container?.clientHeight ?? 0,
    });
  }, [container, windowWidth]);

  const bucketCount =
    (Math.ceil(containerSize.width / bucketWidth) ?? 1) + // default to 1 bucket if none
    1; // add bucket to account for splitting bucket on current price
  const bucketRatio = useMemo(() => {
    // get bounds
    const xMin = graphStart.sd(1, BigNumber.ROUND_DOWN);
    const xMax = graphEnd.sd(1, BigNumber.ROUND_UP);
    const xWidth = xMax.dividedBy(xMin);

    /**
     * The "width" of the buckets is a ratio that is applied bucketCount times up to the total width:
     *   xWidth = x^bucketCountAdjusted
     *   x^bucketCountAdjusted) = xWidth
     *   ln(x^bucketCountAdjusted) = ln(xWidth)
     *   ln(x)*bucketCountAdjusted = ln(xWidth)
     *   ln(x) = ln(xWidth)/bucketCountAdjusted
     *   x = e^(ln(xWidth)/bucketCountAdjusted)
     */
    return Math.exp(Math.log(xWidth.toNumber()) / bucketCount) || 1; // set at least 1
    // note: BigNumber cannot handle logarithms so it cannot calculate this
  }, [graphStart, graphEnd, bucketCount]);

  // calculate bucket extents
  const emptyBuckets = useMemo<
    [TickGroupBucketsEmpty, TickGroupBucketsEmpty]
  >(() => {
    // get bounds
    const xMin = dataStart.sd(2, BigNumber.ROUND_DOWN).toNumber();
    const xMax = dataEnd.sd(2, BigNumber.ROUND_UP).toNumber();
    const tokenABuckets = Array.from({ length: bucketCount }).reduce<
      [min: BigNumber, max: BigNumber][]
    >((result) => {
      const newValue = result[0]?.[0] ?? new BigNumber(currentPriceFromTicks);
      return newValue.isLessThan(xMin)
        ? // return finished array
          result
        : // prepend new bucket
          [[newValue.dividedBy(bucketRatio), newValue], ...result];
    }, []);
    const tokenBBuckets = Array.from({ length: bucketCount }).reduce<
      [min: BigNumber, max: BigNumber][]
    >((result) => {
      const newValue =
        result[result.length - 1]?.[1] ?? new BigNumber(currentPriceFromTicks);
      return newValue.isGreaterThan(xMax)
        ? // return finished array
          result
        : // append new bucket
          [...result, [newValue, newValue.multipliedBy(bucketRatio)]];
    }, []);

    // return concantenated buckes
    return [tokenABuckets, tokenBBuckets];
  }, [currentPriceFromTicks, bucketRatio, bucketCount, dataStart, dataEnd]);

  // allow user ticks to reset the boundary of the graph
  useLayoutEffect(() => {
    const minUserTickPrice = userTicks.reduce<BigNumber | undefined>(
      (result, tick) => {
        if (!tick) return result;
        const { price } = tick;
        return !result || price.isLessThan(result) ? price : result;
      },
      undefined
    );
    const maxUserTickPrice = userTicks.reduce<BigNumber | undefined>(
      (result, tick) => {
        if (!tick) return result;
        const { price } = tick;
        return !result || price.isGreaterThan(result) ? price : result;
      },
      undefined
    );
    // if focusing on just the current tick price range
    if (viewOnlyUserTicks && minUserTickPrice && maxUserTickPrice) {
      setGraphStart(minUserTickPrice.multipliedBy(0.9));
      setGraphEnd(maxUserTickPrice.dividedBy(0.9));
      return;
    }
    // todo: ensure buckets (of maximum bucketWidth) can fit onto the graph extents
    // by padding dataStart and dataEnd with the needed amount of pixels
    const minExistingTickPrice = dataStart;
    const maxExistingTickPrice = dataEnd;
    const minTickPrice = minUserTickPrice?.isLessThan(minExistingTickPrice)
      ? minUserTickPrice
      : minExistingTickPrice;
    const maxTickPrice = maxUserTickPrice?.isGreaterThan(maxExistingTickPrice)
      ? maxUserTickPrice
      : maxExistingTickPrice;
    if (minTickPrice)
      setGraphStart(
        minTickPrice.isLessThan(initialGraphStart)
          ? minTickPrice
          : initialGraphStart
      );
    if (maxTickPrice)
      setGraphEnd(
        maxTickPrice.isGreaterThan(initialGraphEnd)
          ? maxTickPrice
          : initialGraphEnd
      );
  }, [
    initialGraphStart,
    initialGraphEnd,
    dataStart,
    dataEnd,
    userTicks,
    viewOnlyUserTicks,
  ]);

  // calculate histogram values
  const feeTickBuckets = useMemo<
    [TickGroupBucketsFilled, TickGroupBucketsFilled]
  >(() => {
    return [
      fillBuckets(emptyBuckets[0], feeTicks),
      fillBuckets(emptyBuckets[1], feeTicks),
    ];
  }, [emptyBuckets, feeTicks]);

  const graphHeight = useMemo(() => {
    const allFeesTickBuckets = [
      fillBuckets(emptyBuckets[0], allTicks),
      fillBuckets(emptyBuckets[1], allTicks),
    ];
    return allFeesTickBuckets
      .flat()
      .reduce((result, [lowerBound, upperBound, tokenAValue, tokenBValue]) => {
        return Math.max(result, tokenAValue.toNumber(), tokenBValue.toNumber());
      }, 0);
  }, [emptyBuckets, allTicks]);

  // plot values as percentages on a 100 height viewbox (viewBox="0 -100 100 100")
  const xMin = graphStart.sd(2, BigNumber.ROUND_DOWN).toNumber();
  const xMax = graphEnd.sd(2, BigNumber.ROUND_UP).toNumber();
  const plotX = useCallback(
    (x: number): number => {
      const leftPadding = containerSize.width * 0.1;
      const rightPadding = containerSize.width * 0.1;
      const width = containerSize.width - leftPadding - rightPadding;
      return xMin === xMax
        ? // choose midpoint
          leftPadding + width / 2
        : // interpolate coordinate to graph
          leftPadding +
            (width * (Math.log(x) - Math.log(xMin))) /
              (Math.log(xMax) - Math.log(xMin));
    },
    [xMin, xMax, containerSize.width]
  );
  const plotXinverse = useCallback(
    (x: number): number => {
      const leftPadding = containerSize.width * 0.1;
      const rightPadding = containerSize.width * 0.1;
      const width = containerSize.width - leftPadding - rightPadding;
      return Math.exp(
        ((x - leftPadding) * (Math.log(xMax) - Math.log(xMin))) / width +
          Math.log(xMin)
      );
    },
    [xMin, xMax, containerSize.width]
  );
  const plotY = useCallback(
    (y: number): number => {
      const topPadding = containerSize.height * 0.05;
      const bottomPadding = containerSize.height * 0.05;
      const height = containerSize.height - topPadding - bottomPadding;
      return graphHeight === 0
        ? -bottomPadding // pin to bottom
        : -bottomPadding - (height * y) / graphHeight;
    },
    [graphHeight, containerSize.height]
  );
  const percentY = useCallback(
    (y: number): number => {
      const topPadding = containerSize.height * 0.05;
      const bottomPadding = containerSize.height * 0.05;
      const height = containerSize.height - topPadding - bottomPadding;
      return -bottomPadding - height * y;
    },
    [containerSize.height]
  );
  const plotXBigNumber = useCallback(
    (x: BigNumber) => plotX(x.toNumber()),
    [plotX]
  );
  const plotYBigNumber = useCallback(
    (y: BigNumber) => plotY(y.toNumber()),
    [plotY]
  );
  const percentYBigNumber = useCallback(
    (y: BigNumber) => percentY(y.toNumber()),
    [percentY]
  );

  return (
    <svg
      className={['chart-liquidity', advanced && 'chart-type--advanced']
        .filter(Boolean)
        .join(' ')}
      viewBox={`0 -${containerSize.height} ${containerSize.width} ${
        containerSize.height + 5
      }`}
      ref={setContainer}
    >
      <defs>
        <linearGradient id="white-concave-fade">
          <stop offset="0%" stopColor="var(--text-default)" stopOpacity="0.6" />
          <stop
            offset="20%"
            stopColor="var(--text-default)"
            stopOpacity="0.5"
          />
          <stop
            offset="46%"
            stopColor="var(--text-default)"
            stopOpacity="0.4"
          />
          <stop
            offset="54%"
            stopColor="var(--text-default)"
            stopOpacity="0.4"
          />
          <stop
            offset="80%"
            stopColor="var(--text-default)"
            stopOpacity="0.5"
          />
          <stop
            offset="100%"
            stopColor="var(--text-default)"
            stopOpacity="0.6"
          />
        </linearGradient>
      </defs>
      {graphEnd.isZero() && <text>Chart is not currently available</text>}
      {!advanced && (
        <TicksBackgroundArea
          className="new-ticks-area"
          ticks={userTicks.filter((tick): tick is Tick => !!tick)}
          plotX={plotXBigNumber}
          plotY={percentYBigNumber}
        />
      )}
      <TickBucketsGroup
        className="left-ticks"
        tickBuckets={feeTickBuckets[0]}
        plotX={plotXBigNumber}
        plotY={plotYBigNumber}
      />
      <TickBucketsGroup
        className="right-ticks"
        tickBuckets={feeTickBuckets[1]}
        plotX={plotXBigNumber}
        plotY={plotYBigNumber}
      />
      {advanced ? (
        <TicksGroup
          className="new-ticks"
          currentPrice={currentPriceFromTicks}
          userTicks={userTicks}
          backgroundTicks={userTicksBase}
          setUserTicks={setUserTicks}
          userTickSelected={userTickSelected}
          setUserTickSelected={setUserTickSelected}
          plotX={plotXBigNumber}
          percentY={percentYBigNumber}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          canMoveX={canMoveX}
        />
      ) : (
        <TicksArea
          className="new-ticks-area"
          ticks={userTicks.filter((tick): tick is Tick => !!tick)}
          plotX={plotXBigNumber}
          plotY={percentYBigNumber}
          setRangeMin={setRangeMin}
          setRangeMax={setRangeMax}
          plotXinverse={plotXinverse}
          bucketRatio={bucketRatio}
        />
      )}
      <Axis
        className="x-axis"
        // todo: make better (x-axis roughly adds tick marks to buckets near the extents)
        xMin={xMin / 1.2}
        xMax={xMax * 1.2}
        plotX={plotX}
        plotY={plotY}
      />
    </svg>
  );
}

function fillBuckets(emptyBuckets: TickGroupBucketsEmpty, ticks: Tick[]) {
  return emptyBuckets.reduce<TickGroupBucketsFilled>(
    (result, [lowerBound, upperBound]) => {
      const [reserveA, reserveB] = ticks.reduceRight(
        (result, { price, reserveA, reserveB }) => {
          if (
            price.isGreaterThanOrEqualTo(lowerBound) &&
            price.isLessThanOrEqualTo(upperBound)
          ) {
            // TODO: remove safely used ticks from set to minimise reduce time
            return [result[0].plus(reserveA), result[1].plus(reserveB)];
          }
          return result;
        },
        [new BigNumber(0), new BigNumber(0)]
      );
      if (reserveA || reserveB) {
        result.push([lowerBound, upperBound, reserveA, reserveB]);
      }
      return result;
    },
    []
  );
}

function TicksBackgroundArea({
  ticks,
  plotX,
  plotY,
  className,
}: {
  ticks: TickGroup;
  plotX: (x: BigNumber) => number;
  plotY: (y: BigNumber) => number;
  className?: string;
}) {
  const startTickPrice = ticks?.[0]?.price;
  const endTickPrice = ticks?.[ticks.length - 1]?.price;

  return startTickPrice && endTickPrice ? (
    <g
      className={['ticks-area__background', className]
        .filter(Boolean)
        .join(' ')}
    >
      <rect
        className="tick-area"
        // fill is defined on <svg><defs><linearGradient>
        fill="url(#white-concave-fade)"
        x={plotX(startTickPrice).toFixed(3)}
        width={
          endTickPrice.isGreaterThan(startTickPrice)
            ? (plotX(endTickPrice) - plotX(startTickPrice)).toFixed(3)
            : '0'
        }
        y={plotY(new BigNumber(1)).toFixed(3)}
        height={(plotY(new BigNumber(0)) - plotY(new BigNumber(1))).toFixed(3)}
      />
    </g>
  ) : null;
}

function TicksArea({
  ticks,
  plotX,
  plotY,
  setRangeMin,
  setRangeMax,
  plotXinverse,
  bucketRatio,
  className,
}: {
  ticks: TickGroup;
  plotX: (x: BigNumber) => number;
  plotY: (y: BigNumber) => number;
  setRangeMin: (rangeMin: string) => void;
  setRangeMax: (rangeMax: string) => void;
  plotXinverse: (x: number) => number;
  bucketRatio: number;
  className?: string;
}) {
  const startTickPrice = ticks?.[0]?.price;
  const endTickPrice = ticks?.[ticks.length - 1]?.price;
  const bucketWidth =
    plotX(new BigNumber(bucketRatio)) - plotX(new BigNumber(1));

  const [startDragMin, isDraggingMin] = useOnDragMove(
    useCallback(
      (ev: MouseEventInit) => {
        const x = ev.movementX;
        if (x) {
          const xStart = plotX(startTickPrice);
          const newValue = new BigNumber(plotXinverse(xStart + x));
          const newValueString = formatPrice(newValue.toFixed());
          setRangeMin(newValueString);
          if (endTickPrice.isLessThanOrEqualTo(newValue)) {
            setRangeMax(newValueString);
          }
        }
      },
      [
        startTickPrice,
        endTickPrice,
        plotXinverse,
        plotX,
        setRangeMin,
        setRangeMax,
      ]
    )
  );

  const [startDragMax, isDraggingMax] = useOnDragMove(
    useCallback(
      (ev: MouseEventInit) => {
        const x = ev.movementX;
        if (x) {
          const xStart = plotX(endTickPrice);
          const newValue = new BigNumber(plotXinverse(xStart + x));
          const newValueString = formatPrice(newValue.toFixed());
          setRangeMax(newValueString);
          if (startTickPrice.isGreaterThanOrEqualTo(newValue)) {
            setRangeMin(newValueString);
          }
        }
      },
      [
        startTickPrice,
        endTickPrice,
        plotXinverse,
        plotX,
        setRangeMin,
        setRangeMax,
      ]
    )
  );

  const rounding = 5;

  return startTickPrice && endTickPrice ? (
    <g className={['ticks-area', className].filter(Boolean).join(' ')}>
      <g className="pole-a">
        <line
          className="line pole-stick"
          x1={plotX(startTickPrice).toFixed(3)}
          x2={plotX(startTickPrice).toFixed(3)}
          y1={plotY(new BigNumber(0)).toFixed(3)}
          y2={plotY(new BigNumber(1)).toFixed(3)}
        />
        <rect
          className="pole-to-flag"
          x={(plotX(startTickPrice) - rounding).toFixed(3)}
          width={rounding}
          y={plotY(new BigNumber(1)).toFixed(3)}
          height={-(plotY(new BigNumber(0)) * 2).toFixed(3)}
        />
        <rect
          className="pole-flag"
          x={(plotX(startTickPrice) - 0.75 * bucketWidth).toFixed(3)}
          width={(0.75 * bucketWidth).toFixed(3)}
          y={plotY(new BigNumber(1)).toFixed(3)}
          height={-(plotY(new BigNumber(0)) * 2).toFixed(3)}
          rx={rounding}
        />
        <line
          className="pole-flag-stripe"
          x1={(plotX(startTickPrice) - 0.45 * bucketWidth).toFixed(3)}
          x2={(plotX(startTickPrice) - 0.45 * bucketWidth).toFixed(3)}
          y1={plotY(new BigNumber(0.97)).toFixed(3)}
          y2={plotY(new BigNumber(0.92)).toFixed(3)}
        />
        <line
          className="pole-flag-stripe"
          x1={(plotX(startTickPrice) - 0.25 * bucketWidth).toFixed(3)}
          x2={(plotX(startTickPrice) - 0.25 * bucketWidth).toFixed(3)}
          y1={plotY(new BigNumber(0.97)).toFixed(3)}
          y2={plotY(new BigNumber(0.92)).toFixed(3)}
        />
        {isDraggingMin ? (
          <rect
            className="pole-flag--hit-area"
            x="0"
            width="100000"
            y="-100000"
            height="100000"
          />
        ) : (
          <rect
            className="pole-flag--hit-area"
            x={(plotX(startTickPrice) - 0.75 * bucketWidth).toFixed(3)}
            width={(0.75 * bucketWidth).toFixed(3)}
            y={plotY(new BigNumber(1)).toFixed(3)}
            height={-(plotY(new BigNumber(0)) * 2).toFixed(3)}
            rx={rounding}
            onMouseDown={startDragMin}
          />
        )}
      </g>
      <g className="flag-line">
        <line
          className="line flag-joiner"
          x1={plotX(startTickPrice).toFixed(3)}
          x2={plotX(endTickPrice).toFixed(3)}
          y1={plotY(new BigNumber(0.7)).toFixed(3)}
          y2={plotY(new BigNumber(0.7)).toFixed(3)}
        />
      </g>
      <g className="pole-b">
        <line
          className="line pole-stick"
          x1={plotX(endTickPrice).toFixed(3)}
          x2={plotX(endTickPrice).toFixed(3)}
          y1={plotY(new BigNumber(0)).toFixed(3)}
          y2={plotY(new BigNumber(1)).toFixed(3)}
        />
        <rect
          className="pole-to-flag"
          x={plotX(endTickPrice).toFixed(3)}
          width={rounding}
          y={plotY(new BigNumber(1)).toFixed(3)}
          height={-(plotY(new BigNumber(0)) * 2).toFixed(3)}
        />
        <rect
          className="pole-flag"
          x={plotX(endTickPrice).toFixed(3)}
          width={(0.75 * bucketWidth).toFixed(3)}
          y={plotY(new BigNumber(1)).toFixed(3)}
          height={-(plotY(new BigNumber(0)) * 2).toFixed(3)}
          rx={rounding}
        />
        <line
          className="pole-flag-stripe"
          x1={(plotX(endTickPrice) + 0.45 * bucketWidth).toFixed(3)}
          x2={(plotX(endTickPrice) + 0.45 * bucketWidth).toFixed(3)}
          y1={plotY(new BigNumber(0.97)).toFixed(3)}
          y2={plotY(new BigNumber(0.92)).toFixed(3)}
        />
        <line
          className="pole-flag-stripe"
          x1={(plotX(endTickPrice) + 0.25 * bucketWidth).toFixed(3)}
          x2={(plotX(endTickPrice) + 0.25 * bucketWidth).toFixed(3)}
          y1={plotY(new BigNumber(0.97)).toFixed(3)}
          y2={plotY(new BigNumber(0.92)).toFixed(3)}
        />
        {isDraggingMax ? (
          <rect
            className="pole-flag--hit-area"
            x="0"
            width="100000"
            y="-100000"
            height="100000"
          />
        ) : (
          <rect
            className="pole-flag--hit-area"
            x={plotX(endTickPrice).toFixed(3)}
            width={(0.75 * bucketWidth).toFixed(3)}
            y={plotY(new BigNumber(1)).toFixed(3)}
            height={-(plotY(new BigNumber(0)) * 2).toFixed(3)}
            rx={rounding}
            onMouseDown={startDragMax}
          />
        )}
      </g>
    </g>
  ) : null;
}

function TicksGroup({
  currentPrice,
  userTicks,
  backgroundTicks,
  setUserTicks,
  userTickSelected,
  setUserTickSelected,
  plotX,
  percentY,
  className,
  canMoveUp = false,
  canMoveDown = false,
  canMoveX = false,
  ...rest
}: {
  currentPrice: number;
  userTicks: Array<Tick | undefined>;
  backgroundTicks: Array<Tick | undefined>;
  setUserTicks?: (
    callback: (userTicks: TickGroup, meta?: { index?: number }) => TickGroup
  ) => void;
  userTickSelected: number;
  setUserTickSelected: (index: number) => void;
  plotX: (x: BigNumber) => number;
  percentY: (y: BigNumber) => number;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  canMoveX?: boolean;
  className?: string;
}) {
  const tickANumbers = userTicks.flatMap(
    (tick) => tick?.reserveA.toNumber() || []
  );
  const tickBNumbers = userTicks.flatMap(
    (tick) => tick?.reserveB.toNumber() || []
  );
  const backgroundTickANumbers = backgroundTicks.flatMap(
    (tick) => tick?.reserveA.toNumber() || []
  );
  const backgroundTickBNumbers = backgroundTicks.flatMap(
    (tick) => tick?.reserveB.toNumber() || []
  );

  // find max cumulative value of either the current ticks or background ticks
  const cumulativeTokenAValues: number = Math.max(
    tickANumbers.reduce((acc, v) => acc + v, 0),
    backgroundTickANumbers.reduce((acc, v) => acc + v, 0)
  );
  const cumulativeTokenBValues: number = Math.max(
    tickBNumbers.reduce((acc, v) => acc + v, 0),
    backgroundTickBNumbers.reduce((acc, v) => acc + v, 0)
  );

  const maxAValue = Math.max(...tickANumbers, ...backgroundTickANumbers);
  const maxBValue = Math.max(...tickBNumbers, ...backgroundTickBNumbers);
  const minMaxHeight0 = getMinYHeight(backgroundTickANumbers.length);
  const minMaxHeight1 = getMinYHeight(backgroundTickBNumbers.length);

  // add a scaling factor if the maximum tick is very short (scale up to minMaxHeight)
  const scalingFactorA =
    cumulativeTokenAValues && maxAValue / cumulativeTokenAValues > minMaxHeight0
      ? 0.925
      : (0.925 / (maxAValue / cumulativeTokenAValues)) * minMaxHeight0;
  const scalingFactorB =
    cumulativeTokenBValues && maxBValue / cumulativeTokenBValues > minMaxHeight1
      ? 0.925
      : (0.925 / (maxBValue / cumulativeTokenBValues)) * minMaxHeight1;

  const lastSelectedTick = useRef<{ tick: Tick; index: number }>();

  const [startDragTick, isDragging] = useOnDragMove(
    useCallback(
      (ev: Event, displacement = { x: 0, y: 0 }) => {
        // exit if there is no tick
        const { index: userTickSelected, tick } =
          lastSelectedTick.current || {};
        if (!tick || userTickSelected === undefined || isNaN(userTickSelected))
          return;

        // move tick price
        if (canMoveX && Math.abs(displacement.x) > Math.abs(displacement.y)) {
          return setUserTicks?.((userTicks) => {
            const orderOfMagnitudePixels =
              plotX(new BigNumber(10)) - plotX(new BigNumber(1));
            const displacementRatio = Math.pow(
              10,
              displacement.x / orderOfMagnitudePixels
            );
            return userTicks?.map((userTick, index) => {
              // modify price
              if (userTickSelected === index) {
                const newPrice = tick.price.multipliedBy(displacementRatio);
                return {
                  ...userTick,
                  price: new BigNumber(formatPrice(newPrice.toFixed())),
                };
              } else {
                return userTick;
              }
            });
          });
        }
        // move tick value
        else {
          return setUserTicks?.((userTicks, meta = {}) => {
            // append context for callers that read from this
            // note: this is a bit of a hack to keep setUserTicks(tick => ticks)-like compatibility
            meta.index = userTickSelected;
            // calculate position movement
            const linearPixels =
              percentY(new BigNumber(1)) - percentY(new BigNumber(0));
            // todo: attempt an algorithm that places the value at the approximate mouseover value
            // will require current max Y value to interpolate from
            const displacementPercent = displacement.y / linearPixels;
            const dragSpeedFactor = 5; //larger is faster
            const adjustedMovement = 1 + dragSpeedFactor * displacementPercent;
            return userTicks?.map((userTick, index) => {
              // modify price
              if (userTickSelected === index) {
                const originalAValue = backgroundTicks[index]?.reserveA;
                const originalBValue = backgroundTicks[index]?.reserveB;
                const newAValue = tick.reserveA.multipliedBy(adjustedMovement);
                const newBValue = tick.reserveB.multipliedBy(adjustedMovement);
                return {
                  ...userTick,
                  reserveA:
                    (!canMoveDown &&
                      originalAValue &&
                      newAValue.isLessThan(originalAValue)) ||
                    (!canMoveUp &&
                      originalAValue &&
                      newAValue.isGreaterThan(originalAValue))
                      ? originalAValue
                      : newAValue,
                  reserveB:
                    (!canMoveDown &&
                      originalBValue &&
                      newBValue.isLessThan(originalBValue)) ||
                    (!canMoveUp &&
                      originalBValue &&
                      newBValue.isGreaterThan(originalBValue))
                      ? originalBValue
                      : newBValue,
                };
              } else {
                return userTick;
              }
            });
          });
        }
      },
      [
        backgroundTicks,
        canMoveUp,
        canMoveDown,
        canMoveX,
        setUserTicks,
        plotX,
        percentY,
      ]
    )
  );

  const onTickSelected = useCallback(
    (e: MouseEvent) => {
      // set last tick synchronously
      const index = parseInt(
        (e.target as HTMLElement)?.getAttribute('data-key') || ''
      );
      const tick = userTicks?.[index];
      if (!isNaN(index) && tick) {
        setUserTickSelected(index);
        lastSelectedTick.current = {
          tick,
          index,
        };
      }

      startDragTick(e);
    },
    [userTicks, startDragTick, setUserTickSelected]
  );

  const tickPart = userTicks
    .filter(
      (tick): tick is Tick =>
        !!tick && !tick.reserveA.isNaN() && !tick.reserveB.isNaN()
    )
    .map<[Tick, number]>((tick, index) => [tick, index])
    // sort by top to bottom: select ticks then shortest -> tallest ticks
    .sort(([a, aIndex], [b, bIndex]) => {
      // sort any selected tick to the front
      // (so users can select it somehow else then drag it easily here)
      const aIsSelected = aIndex === userTickSelected;
      const bIsSelected = bIndex === userTickSelected;
      return (
        Number(aIsSelected) - Number(bIsSelected) ||
        // sort by height so that short ticks are above tall ticks
        b.reserveA.plus(b.reserveB).comparedTo(a.reserveA.plus(a.reserveB))
      );
    })
    .map(([tick, index]) => {
      const backgroundTick = backgroundTicks[index] || tick;
      const background = {
        price: backgroundTick.price,
        reserveA: backgroundTick.reserveA,
        reserveB: backgroundTick.reserveB,
      };
      const { price, reserveA, reserveB } = tick;
      const scalingFactor = background.reserveA.isGreaterThan(0)
        ? scalingFactorA
        : scalingFactorB;
      // todo: display cumulative value of both side of ticks, not just one side
      const totalValue =
        (reserveA.isGreaterThan(0)
          ? cumulativeTokenAValues &&
            reserveA
              .multipliedBy(scalingFactor)
              .dividedBy(cumulativeTokenAValues)
          : cumulativeTokenBValues &&
            reserveB
              .multipliedBy(scalingFactor)
              .dividedBy(cumulativeTokenBValues)) || new BigNumber(0);
      const backgroundValue =
        (background.reserveA.isGreaterThan(0)
          ? cumulativeTokenAValues &&
            background.reserveA
              .multipliedBy(scalingFactor)
              .dividedBy(cumulativeTokenAValues)
          : cumulativeTokenBValues &&
            background.reserveB
              .multipliedBy(scalingFactor)
              .dividedBy(cumulativeTokenBValues)) || new BigNumber(0);

      const minValue = totalValue.isLessThan(backgroundValue)
        ? totalValue
        : backgroundValue;
      const maxValue = totalValue.isLessThan(backgroundValue)
        ? backgroundValue
        : totalValue;

      return (
        <g
          key={index}
          className={[
            'tick',
            totalValue.isZero() && 'tick--is-zero',
            userTickSelected === index && 'tick--selected',
            reserveA.isGreaterThan(0) ? 'token-a' : 'token-b',
            !totalValue.isEqualTo(backgroundValue) &&
              (totalValue.isLessThan(backgroundValue)
                ? 'tick--diff-negative'
                : 'tick--diff-positive'),
            // warn user if this seems to be a bad trade
            reserveA.isGreaterThan(0)
              ? price.isGreaterThan(currentPrice) && 'tick--price-warning'
              : price.isLessThan(currentPrice) && 'tick--price-warning',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <line
            {...rest}
            x1={plotX(price).toFixed(3)}
            x2={plotX(price).toFixed(3)}
            y1={percentY(new BigNumber(0)).toFixed(3)}
            y2={percentY(minValue).toFixed(3)}
            className="line"
          />
          {tick !== backgroundTick && (
            <line
              {...rest}
              x1={plotX(price).toFixed(3)}
              x2={plotX(price).toFixed(3)}
              y1={percentY(minValue).toFixed(3)}
              y2={percentY(maxValue).toFixed(3)}
              className="line line--diff"
            />
          )}
          <circle
            cx={plotX(price).toFixed(3)}
            cy={percentY(backgroundValue).toFixed(3)}
            r="5"
            className="tip"
          />
          {tick !== backgroundTick && (
            <circle
              cx={plotX(price).toFixed(3)}
              cy={percentY(totalValue).toFixed(3)}
              r="5"
              className="tip tip--diff"
            />
          )}
          <text
            x={plotX(price).toFixed(3)}
            y={(percentY(maxValue) - 28).toFixed(3)}
            dy="12"
            dominantBaseline="middle"
            textAnchor="middle"
          >
            {index + 1}
          </text>
          <rect
            className="tick--hit-area"
            data-key={index}
            {...(isDragging
              ? {
                  x: '0',
                  y: '-1000',
                  width: '10000',
                  height: '1000',
                }
              : {
                  x: (plotX(price) - 7.5).toFixed(3),
                  y: (percentY(maxValue) - 25).toFixed(3),
                  rx: 7.5,
                  width: 15,
                  height: (
                    percentY(minValue) -
                    percentY(maxValue) +
                    35
                  ).toFixed(3),
                })}
            onMouseDown={onTickSelected}
          />
        </g>
      );
    });

  return (
    <g
      className={['ticks', isDragging && 'ticks--is-dragging', className]
        .filter(Boolean)
        .join(' ')}
    >
      {tickPart}
    </g>
  );
}

function TickBucketsGroup({
  tickBuckets,
  plotX,
  plotY,
  className,
  ...rest
}: {
  tickBuckets: TickGroupBucketsFilled;
  plotX: (x: BigNumber) => number;
  plotY: (y: BigNumber) => number;
  className?: string;
}) {
  return (
    <g className={['tick-buckets', className].filter(Boolean).join(' ')}>
      {tickBuckets.flatMap(
        ([lowerBound, upperBound, tokenAValue, tokenBValue], index) =>
          [
            tokenAValue?.isGreaterThan(0) && (
              <rect
                key={`${index}-0`}
                className="tick-bucket token-a"
                {...rest}
                x={plotX(lowerBound).toFixed(3)}
                width={(plotX(upperBound) - plotX(lowerBound)).toFixed(3)}
                y={plotY(tokenAValue).toFixed(3)}
                height={(plotY(new BigNumber(0)) - plotY(tokenAValue)).toFixed(
                  3
                )}
              />
            ),
            tokenBValue?.isGreaterThan(0) && (
              <rect
                key={`${index}-1`}
                className="tick-bucket token-b"
                {...rest}
                x={plotX(lowerBound).toFixed(3)}
                width={(plotX(upperBound) - plotX(lowerBound)).toFixed(3)}
                y={plotY(tokenAValue.plus(tokenBValue)).toFixed(3)}
                height={(plotY(new BigNumber(0)) - plotY(tokenBValue)).toFixed(
                  3
                )}
              />
            ),
          ].filter(Boolean)
      )}
    </g>
  );
}

function Axis({
  className = '',
  xMin,
  xMax,
  plotX,
  plotY,
}: {
  xMin: number;
  xMax: number;
  className?: string;
  plotX: (x: number) => number;
  plotY: (y: number) => number;
}) {
  if (!xMin || !xMax || xMin === xMax) return null;

  const start = Math.pow(10, Math.floor(Math.log10(xMin)));
  const tickMarks = Array.from({ length: Math.log10(xMax / xMin) + 2 }).flatMap(
    (_, index) => {
      const baseNumber = start * Math.pow(10, index);
      const possibleMultiples = [2, 5, 10];
      const possibleInclusions = possibleMultiples.map((v) => v * baseNumber);
      return possibleInclusions
        .map((possibleInclusion) => {
          if (possibleInclusion >= xMin && possibleInclusion <= xMax) {
            return possibleInclusion;
          }
          return 0;
        })
        .filter(Boolean);
    }
  );

  return (
    <g className={['axis', className].filter(Boolean).join(' ')}>
      <line
        x1="0"
        x2={plotX(xMax * 2)}
        y1={plotY(0).toFixed(0)}
        y2={plotY(0).toFixed(0)}
      />
      <g className="axis-ticks">{tickMarks.map(mapTickMark)}</g>
    </g>
  );

  function mapTickMark(tickMark: number) {
    const decimalPlaces = Math.max(0, -Math.floor(Math.log10(tickMark)));
    return (
      <g key={tickMark} className="axis-tick">
        <line
          x1={plotX(tickMark).toFixed(3)}
          x2={plotX(tickMark).toFixed(3)}
          y1={plotY(0)}
          y2={plotY(0) + 2}
        />
        <text
          x={plotX(tickMark).toFixed(3)}
          y={plotY(0) + 2}
          dy="12"
          dominantBaseline="middle"
          textAnchor="middle"
        >
          {tickMark.toFixed(decimalPlaces)}
        </text>
      </g>
    );
  }
}

function getMinYHeight(tickCount: number): number {
  return 1 / ((tickCount - 2) / 3 + 2) + 0.4;
}
