// Robust fetch polyfill for browser environment
const globalFetch = typeof window !== 'undefined' ? window.fetch.bind(window) : globalThis.fetch;
export const fetch = globalFetch;
export default globalFetch;
