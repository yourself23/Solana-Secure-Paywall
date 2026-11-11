import {ConnectionProvider, WalletProvider} from '@solana/wallet-adapter-react';
import {WalletModalProvider} from '@solana/wallet-adapter-react-ui';
import {PhantomWalletAdapter} from '@solana/wallet-adapter-wallets';
import {useMemo} from 'react';
import Paywall from './components/Paywall';
import '@solana/wallet-adapter-react-ui/styles.css';

export default function App() {
    const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
    return (
        <ConnectionProvider endpoint="https://api.mainnet-beta.solana.com">
            <WalletProvider wallets={wallets} autoConnect>
                <WalletModalProvider>
                    <Paywall />
                </WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
}
