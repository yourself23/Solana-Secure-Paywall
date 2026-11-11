import React, {useCallback} from 'react';
import {useConnection, useWallet} from '@solana/wallet-adapter-react';
import {WalletMultiButton} from '@solana/wallet-adapter-react-ui';
import {Transaction, SystemProgram, PublicKey} from '@solana/web3.js';

export default function Paywall() {
    const {connection} = useConnection();
    const {publicKey, sendTransaction} = useWallet();

    const onPay = useCallback(async () => {
        if (!publicKey) return;

        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: publicKey,
                toPubkey: new PublicKey('2AoLHzCkR9FpEjPqMma2kZs4cAFjcfb2rWMSxMM2yhym'),
                lamports: 0.1 * 1_000_000_000,
            })
        );

        const signature = await sendTransaction(transaction, connection);
        console.log('Transaction signature:', signature);
    }, [publicKey, sendTransaction, connection]);

    return (
        <div className="p-4 bg-gray-900 text-white rounded-lg">
            <h2 className="text-xl font-bold">Secure Paywall</h2>
            <p className="mb-4">Cost: 0.1 SOL</p>
            <WalletMultiButton />
            {publicKey && (
                <button 
                    onClick={onPay}
                    className="mt-4 bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
                >
                    Pay 0.1 SOL
                </button>
            )}
        </div>
    );
}
