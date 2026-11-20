import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('stdio handles MCP requests, notifications and JSON-RPC errors', () => {
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 'list', method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'unknown' },
  ];
  const output = execFileSync(process.execPath, ['mcp-stdio.mjs'], {
    input: `${requests.map((request) => JSON.stringify(request)).join('\n')}\nnot json\n`,
    encoding: 'utf8',
  });
  const responses = output.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(responses.length, 4);
  assert.equal(responses[0].id, 1);
  assert.equal(responses[0].result.protocolVersion, '2024-11-05');
  assert.deepEqual(responses[1], { jsonrpc: '2.0', id: 'list', result: { tools: [] } });
  assert.equal(responses[2].error.code, -32601);
  assert.equal(responses[3].error.code, -32700);
});
