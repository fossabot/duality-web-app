import { useState, useCallback } from 'react';
import { DeliverTxResponse } from '@cosmjs/stargate';
import { Log } from '@cosmjs/stargate/build/logs';
import BigNumber from 'bignumber.js';

import { useWeb3 } from '../../lib/web3/useWeb3';
import { txClient as dexTxClient } from '../../lib/web3/generated/duality/nicholasdotsol.duality.dex/module';
import { Token } from '../../components/TokenPicker/hooks';
import { TickGroup } from '../../components/LiquiditySelector/LiquiditySelector';
import {
  checkMsgErrorToast,
  checkMsgOutOfGasToast,
  checkMsgRejectedToast,
  checkMsgSuccessToast,
  createLoadingToast,
} from '../../components/Notifications/common';
import { getAmountInDenom } from '../../lib/web3/utils/tokens';
import { feeTypes } from '../../lib/web3/utils/fees';

interface SendDepositResponse {
  gasUsed: string;
  receivedTokenA: string;
  receivedTokenB: string;
}

export function useDeposit(): [
  {
    data?: SendDepositResponse;
    isValidating?: boolean;
    error?: string;
  },
  (
    tokenA: Token | undefined,
    tokenB: Token | undefined,
    fee: BigNumber | undefined,
    userTicks: TickGroup,
    invertedOrder?: boolean
  ) => Promise<void>
] {
  const [data, setData] = useState<SendDepositResponse | undefined>(undefined);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string>();
  const web3 = useWeb3();

  const sendDepositRequest = useCallback(
    async function (
      tokenA: Token | undefined,
      tokenB: Token | undefined,
      fee: BigNumber | undefined,
      userTicks: TickGroup,
      invertedOrder = false
    ) {
      try {
        // check for correct inputs
        if (!web3.address || !web3.wallet) {
          throw new Error('Wallet not connected');
        }
        const web3Address = web3.address;
        if (!tokenA || !tokenB) {
          throw new Error('Tokens not set');
        }
        if (!fee || !fee.isGreaterThanOrEqualTo(0)) {
          throw new Error('Fee not set');
        }
        // check all user ticks and filter to non-zero ticks
        const filteredUserTicks = userTicks.filter(
          ([price, amountA, amountB]) => {
            if (!price || price.isLessThan(0)) {
              throw new Error('Price not set');
            }
            if (
              !amountA ||
              !amountB ||
              amountA.isNaN() ||
              amountB.isNaN() ||
              amountA.isLessThan(0) ||
              amountB.isLessThan(0)
            ) {
              throw new Error('Amounts not set');
            }
            return amountA.isGreaterThan(0) || amountB.isGreaterThan(0);
          }
        );

        if (filteredUserTicks.length === 0) {
          throw new Error('Ticks not set');
        }

        setData(undefined);
        setIsValidating(true);
        setError(undefined);

        // do not make requests if they are not routable
        if (!tokenA.address) {
          throw new Error(
            `Token ${tokenA.symbol} has no address on the Duality chain`
          );
        }
        if (!tokenB.address) {
          throw new Error(
            `Token ${tokenB.symbol} has no address on the Duality chain`
          );
        }

        const id = `${Date.now()}.${Math.random}`;
        createLoadingToast({ id, description: 'Adding Liquidity...' });

        // wrap transaction logic
        try {
          const feeIndex = feeTypes.findIndex((feeType) =>
            fee.isEqualTo(feeType.fee)
          );
          // add each tick message into a signed broadcast
          const client = await dexTxClient(web3.wallet);
          const res = await client.signAndBroadcast([
            client.msgDeposit({
              creator: web3Address,
              tokenA: tokenA.address,
              tokenB: tokenB.address,
              receiver: web3Address,
              // tick indexes must be in the form of "token0/1 index"
              // not "tokenA/B" index, so inverted order indexes should be reversed
              tickIndexes: filteredUserTicks.map(
                ([price]) =>
                  Math.round(Math.log(price.toNumber()) / Math.log(1.0001)) *
                  (invertedOrder ? -1 : 1)
              ),
              feeIndexes: filteredUserTicks.map(() => feeIndex),
              amountsA: filteredUserTicks.map(
                ([, amountA]) =>
                  getAmountInDenom(
                    tokenA,
                    amountA,
                    tokenA.display,
                    tokenA.display
                  ) || '0'
              ),
              amountsB: filteredUserTicks.map(
                ([, , amountB]) =>
                  getAmountInDenom(
                    tokenB,
                    amountB,
                    tokenB.display,
                    tokenB.display
                  ) || '0'
              ),
            }),
          ]);

          // check for response
          if (!res) {
            throw new Error('No response');
          }
          const { code, gasUsed } = res;

          // check for response errors
          if (!checkMsgSuccessToast(res, { id })) {
            const error: Error & { response?: DeliverTxResponse } = new Error(
              `Tx error: ${code}`
            );
            error.response = res;
            throw error;
          }

          // calculate received tokens
          const foundLogs: Log[] = JSON.parse(res.rawLog || '[]');
          const foundEvents = foundLogs.flatMap((log) => log.events);
          const { receivedTokenA, receivedTokenB } = foundEvents.reduce<{
            receivedTokenA: BigNumber;
            receivedTokenB: BigNumber;
          }>(
            (acc, event) => {
              // find and process each dex NewDeposit message created by this user
              if (
                event.type === 'message' &&
                event.attributes.find(
                  ({ key, value }) => key === 'module' && value === 'dex'
                ) &&
                event.attributes.find(
                  ({ key, value }) => key === 'action' && value === 'NewDeposit'
                ) &&
                event.attributes.find(
                  ({ key, value }) => key === 'sender' && value === web3.address
                )
              ) {
                // collect into more usable format for parsing
                const attributes = event.attributes.reduce(
                  (acc, { key, value }) => ({ ...acc, [key]: value }),
                  {}
                ) as {
                  TickIndex: string;
                  FeeIndex: string;
                  Token0: string;
                  Token1: string;
                  OldReserves0: string;
                  OldReserves1: string;
                  NewReserves0: string;
                  NewReserves1: string;
                };

                // accumulate share values
                // ('NewReserves' is the difference between previous and next share value)
                const shareIncrease0 = new BigNumber(
                  attributes['NewReserves0']
                );
                const shareIncrease1 = new BigNumber(
                  attributes['NewReserves1']
                );
                if (
                  tokenA.address === attributes['Token0'] &&
                  tokenB.address === attributes['Token1']
                ) {
                  acc.receivedTokenA = acc.receivedTokenA.plus(shareIncrease0);
                  acc.receivedTokenB = acc.receivedTokenB.plus(shareIncrease1);
                } else if (
                  tokenA.address === attributes['Token1'] &&
                  tokenB.address === attributes['Token0']
                ) {
                  acc.receivedTokenA = acc.receivedTokenA.plus(shareIncrease1);
                  acc.receivedTokenB = acc.receivedTokenB.plus(shareIncrease0);
                }
              }
              return acc;
            },
            {
              receivedTokenA: new BigNumber(0),
              receivedTokenB: new BigNumber(0),
            }
          );

          // check no shares exception
          if (receivedTokenA.isZero() && receivedTokenB.isZero()) {
            const error: Error & { response?: DeliverTxResponse } = new Error(
              'No new shares received'
            );
            error.response = res;
            checkMsgErrorToast(error, {
              id,
              title: 'No new shares received',
              description:
                'The transaction was successful but no new shares were created',
            });
          }
          // set success
          else if (
            receivedTokenA.isGreaterThanOrEqualTo(0) &&
            receivedTokenB.isGreaterThanOrEqualTo(0)
          ) {
            // set new information
            setData({
              gasUsed: gasUsed.toString(),
              receivedTokenA: receivedTokenA.toFixed(),
              receivedTokenB: receivedTokenB.toFixed(),
            });
          }
          // catch other exceptions
          else {
            const error: Error & { response?: DeliverTxResponse } = new Error(
              'Deposit issue'
            );
            error.response = res;
            checkMsgErrorToast(error, {
              id,
              title: 'An unexpected error occured',
              description:
                'The transaction was successful but we could not determine the number of new shares created',
            });
          }

          setIsValidating(false);
        } catch (e) {
          // catch transaction errors
          const err = e as Error & { response?: DeliverTxResponse };
          // chain toast checks so only one toast may be shown
          checkMsgRejectedToast(err, { id }) ||
            checkMsgOutOfGasToast(err, { id }) ||
            checkMsgErrorToast(err, { id });

          // rethrow error to outer try block
          throw e;
        }
      } catch (e) {
        setIsValidating(false);
        setError((e as Error)?.message || (e as string));
      }
    },
    [web3.address, web3.wallet]
  );

  return [{ data, isValidating, error }, sendDepositRequest];
}
