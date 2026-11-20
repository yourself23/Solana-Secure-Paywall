import { createInterface } from 'node:readline';

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

input.on('line', (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      request.jsonrpc !== '2.0' || typeof request.method !== 'string' ||
      ('id' in request && request.id !== null && typeof request.id !== 'string' && typeof request.id !== 'number')) {
    send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
    return;
  }
  if (!('id' in request)) return;

  let result;
  if (request.method === 'initialize') {
    result = {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'solana-x402-gateway', version: '1.0.0' },
    };
  } else if (request.method === 'tools/list') {
    result = { tools: [] };
  } else if (request.method === 'ping') {
    result = {};
  } else {
    send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } });
    return;
  }
  send({ jsonrpc: '2.0', id: request.id, result });
});
