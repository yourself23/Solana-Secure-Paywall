import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      global: 'globalThis',
      'import.meta.env.VITE_TREASURY_ADDRESS': JSON.stringify(env.VITE_TREASURY_ADDRESS),
      'import.meta.env.VITE_SOLANA_RPC_URL': JSON.stringify(env.VITE_SOLANA_RPC_URL),
      'import.meta.env.VITE_PAYMENT_AMOUNT_SOL': JSON.stringify(env.VITE_PAYMENT_AMOUNT_SOL),
      'import.meta.env.VITE_API_CALLS_PER_PAYMENT': JSON.stringify(env.VITE_API_CALLS_PER_PAYMENT),
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    optimizeDeps: {
      include: ['@solana/web3.js', '@solana/wallet-adapter-react', '@solana/wallet-adapter-react-ui', '@solana/wallet-adapter-wallets'],
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
