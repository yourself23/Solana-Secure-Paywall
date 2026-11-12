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
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);
