// Safe polyfill for window.fetch before any modules load
if (typeof window !== 'undefined') {
    try {
        const descriptor = Object.getOwnPropertyDescriptor(window, 'fetch');
        if (!descriptor || !descriptor.writable) {
            Object.defineProperty(window, 'fetch', {
                value: window.fetch || globalThis.fetch,
                writable: true,
                configurable: true
            });
        }
    } catch (e) {
        // ignore
    }
}

import {createRoot} from 'react-dom/client';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import '@solana/wallet-adapter-react-ui/styles.css';
import App from './App.tsx';
import './index.css';

const endpoint = import.meta.env.VITE_SOLANA_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com';
const wallets = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];

createRoot(document.getElementById('root')!).render(
    <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
            <WalletModalProvider><App /></WalletModalProvider>
        </WalletProvider>
    </ConnectionProvider>
);
