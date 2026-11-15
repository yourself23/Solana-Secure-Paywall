import {ConnectionProvider, WalletProvider} from '@solana/wallet-adapter-react';
import {WalletModalProvider} from '@solana/wallet-adapter-react-ui';
import {PhantomWalletAdapter, SolflareWalletAdapter} from '@solana/wallet-adapter-wallets';
import {useMemo} from 'react';
import LiveTicker from './components/LiveTicker';
import SalesConsole from './components/SalesConsole';
import Paywall from './components/Paywall';
import BotInventoryStore from './components/BotInventoryStore';
import '@solana/wallet-adapter-react-ui/styles.css';

export default function App() {
    const wallets = useMemo(() => [
        new PhantomWalletAdapter(),
        new SolflareWalletAdapter()
    ], []);

    return (
        <ConnectionProvider endpoint="https://api.mainnet-beta.solana.com">
            <WalletProvider wallets={wallets} autoConnect>
                <WalletModalProvider>
                    <div className="min-h-screen bg-black text-white flex flex-col justify-between selection:bg-indigo-500 selection:text-white pb-12">
                        <LiveTicker />
                        <main className="max-w-7xl mx-auto px-6 py-10 w-full">
                            <div className="space-y-6 mb-6">
                                <Paywall />
                                <BotInventoryStore />
                            </div>
                            <SalesConsole />
                        </main>
                        <div className="pb-4">
                            <LiveTicker />
                        </div>
                    </div>
                </WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
}
