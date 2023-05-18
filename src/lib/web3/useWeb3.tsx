import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

import { OfflineSigner } from '@cosmjs/proto-signing';
import { ProtobufRpcClient } from '@cosmjs/stargate';

import { useRpcPromise } from './rpcQueryClient';
import {
  getKeplrWallet,
  getKeplrWalletAccount,
  useSyncKeplrState,
} from './wallets/keplr';
import { useLcdClientPromise } from './lcdClient';

type LcdClient = Awaited<ReturnType<typeof useLcdClientPromise>>;
export interface Web3ContextValue {
  connectWallet?: () => void;
  wallet: OfflineSigner | null;
  address: string | null;
  rpcBaseClient?: ProtobufRpcClient;
  lcdClient?: LcdClient;
}

const Web3Context = createContext<Web3ContextValue>({
  wallet: null,
  address: null,
  rpcBaseClient: undefined,
  lcdClient: undefined,
});

interface Web3ContextProps {
  children: ReactNode;
}

const LOCAL_STORAGE_WALLET_CONNECTED_KEY = 'duality.web3.walletConnected';

type SupportedWallet = 'keplr';

export function Web3Provider({ children }: Web3ContextProps) {
  const [address, setAddress] = useState<string | null>(null);
  const [wallet, setWallet] = useState<OfflineSigner | null>(null);

  // set callback to run when user opts in to connecting their wallet
  const connectWallet = useCallback(
    async (walletType: SupportedWallet | string = '') => {
      const [wallet, address] = await (async function (): Promise<
        [OfflineSigner?, string?]
      > {
        switch (walletType) {
          case 'keplr': {
            const wallet = await getKeplrWallet();
            const account = wallet && (await getKeplrWalletAccount(wallet));
            return [wallet, account?.address];
          }
          // if wallet type was not found then mark them as not found
          default: {
            return [];
          }
        }
      })();
      // set or unset wallet and address
      setWallet(wallet ?? null);
      setAddress(wallet ? address ?? null : null);
      // save new state
      if (walletType) {
        localStorage.setItem(LOCAL_STORAGE_WALLET_CONNECTED_KEY, walletType);
      } else {
        localStorage.removeItem(LOCAL_STORAGE_WALLET_CONNECTED_KEY);
      }
    },
    []
  );

  // sync wallet to saved wallet type on load
  useEffect(() => {
    const walletType = localStorage.getItem(LOCAL_STORAGE_WALLET_CONNECTED_KEY);
    connectWallet(walletType || undefined);
  }, [connectWallet]);

  // listen across tabs for wallet connection events through local storage
  useEffect(() => {
    function syncWallet(e: StorageEvent) {
      if (e.key === LOCAL_STORAGE_WALLET_CONNECTED_KEY) {
        connectWallet(e.newValue || undefined);
      }
    }
    window.addEventListener('storage', syncWallet);
    return () => window.removeEventListener('storage', syncWallet);
  }, [connectWallet]);

  // sync Keplr wallet on Keplr state changes
  useSyncKeplrState(
    connectWallet,
    localStorage.getItem(LOCAL_STORAGE_WALLET_CONNECTED_KEY) === 'keplr'
  );

  // persist an activated RPC client
  const [rpc, setRpc] = useState<ProtobufRpcClient>();
  const rpcPromise = useRpcPromise();
  useEffect(() => {
    rpcPromise.then(setRpc);
  }, [rpcPromise]);

  // persist an activated LCD client
  const [lcd, setLcd] = useState<LcdClient>();
  const lcdPromise = useLcdClientPromise();
  useEffect(() => {
    lcdPromise.then(setLcd);
  }, [lcdPromise]);

  return (
    <Web3Context.Provider
      value={{
        // only connect to Keplr wallets for now
        connectWallet: useCallback(
          async () => await connectWallet('keplr'),
          [connectWallet]
        ),
        wallet,
        address,
        rpcBaseClient: rpc,
        lcdClient: lcd,
      }}
    >
      {children}
    </Web3Context.Provider>
  );
}

export function useWeb3() {
  return useContext(Web3Context);
}
