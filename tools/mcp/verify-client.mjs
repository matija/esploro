import assert from 'node:assert/strict';
import { createInterface } from 'node:readline';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

const input = createInterface({ input: process.stdin });
const lines = input[Symbol.asyncIterator]();
const clients = [];
const databaseIds = ['postgres', 'mysql', 'mariadb'];
const options = { timeout: 10_000 };

async function receive() {
  const line = await lines.next();
  assert.equal(line.done, false, 'Fixture host closed its control pipe');
  return JSON.parse(line.value);
}

async function fixture(command, connectionId) {
  process.stdout.write(`${JSON.stringify({ command, connectionId })}\n`);
  const result = await receive();
  assert.equal(result.ok, true, `Fixture command failed: ${command}`);
  return result;
}

async function connect(url, token) {
  const client = new Client({ name: 'esploro-sdk-acceptance', version: '1.0.0' });
  clients.push(client);
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport, options);
  assert.notEqual(LATEST_PROTOCOL_VERSION, '2025-06-18');
  assert.equal(transport.protocolVersion, '2025-06-18');
  assert.equal(client.getServerVersion().name, 'esploro');
  assert.deepEqual(client.getServerCapabilities(), { tools: {} });
  return client;
}

async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args }, undefined, options);
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent.connections ?? result.structuredContent);
  return result.structuredContent;
}

async function pages(client, args, key) {
  const entries = [];
  const cursors = new Set();
  let cursor;
  do {
    const page = await call(client, 'inspect_schema', { ...args, limit: 1, ...(cursor ? { cursor } : {}) });
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 256_000);
    assert.equal(page.omittedEntries, 0);
    assert.ok(page[key].length <= 1);
    entries.push(...page[key]);
    cursor = page.nextCursor;
    assert.equal(page.truncated, Boolean(cursor));
    assert.deepEqual(page.truncationReasons, cursor ? ['pageLimit'] : []);
    if (cursor) {
      assert.equal(typeof cursor, 'string');
      assert.equal(cursors.has(cursor), false, 'Inspection cursor did not advance');
      cursors.add(cursor);
      assert.ok(cursors.size < 1000, 'Inspection did not terminate');
    }
  } while (cursor);
  const names = entries.map(entry => entry.name);
  assert.deepEqual(names, [...new Set(names)].sort());
  assert.ok(cursors.size > 0, `${key} inspection did not paginate`);
  return entries;
}

try {
  const { url, token } = await receive();
  const client = await connect(url, token);
  const tools = (await client.listTools({}, options)).tools;
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['execute_query', 'inspect_schema', 'list_connections']);
  for (const tool of tools) assert.equal(tool.inputSchema.type, 'object');
  assert.deepEqual((await call(client, 'list_connections')).connections, [{ connectionId: 'postgres', label: 'postgres' }]);
  for (const name of ['inspect_schema', 'execute_query']) {
    let expected;
    for (const connectionId of ['mysql', 'mariadb', 'missing']) {
      const result = await client.callTool({ name, arguments: { connectionId, ...(name === 'execute_query' ? { sql: 'SELECT 1' } : {}) } }, undefined, options);
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.rows, undefined);
      assert.equal(result.structuredContent.schemas, undefined);
      if (expected) assert.deepEqual(result, expected);
      expected = result;
    }
  }
  await fixture('grant');
  assert.deepEqual((await call(client, 'list_connections')).connections.map(entry => entry.connectionId).sort(), [...databaseIds].sort());
  for (const connectionId of databaseIds) {
    const rows = [[{ t: 'text', v: '42' }]];
    const schemas = await pages(client, { connectionId }, 'schemas');
    assert.ok(schemas.some(schema => schema.name === 't6_metadata'));
    const objects = await pages(client, { connectionId, schema: 't6_metadata' }, 'objects');
    assert.deepEqual(objects.map(object => object.name), ['a_view', 'byte_pages', 'columns_page', 'oversized']);
    assert.equal(objects[0].kind, 'VIEW');
    const columns = await pages(client, { connectionId, schema: 't6_metadata', object: 'columns_page' }, 'columns');
    assert.deepEqual(columns.map(column => column.name), Array.from({ length: 105 }, (_, n) => `c${String(n).padStart(3, '0')}`));
    for (const column of columns) {
      assert.equal(typeof column.dataType, 'string');
      assert.equal(column.isNullable, true);
    }
    const result = await call(client, 'execute_query', { connectionId, sql: 'SELECT 42 AS acceptance' });
    assert.deepEqual(result.columns, ['acceptance']);
    assert.deepEqual(result.rows, rows);
    assert.equal(result.truncated, false);
    for (const sql of ['DELETE FROM acceptance', 'SELECT 1; SELECT 2', 'SELECT * FROM missing_acceptance_table']) {
      const error = await client.callTool({ name: 'execute_query', arguments: { connectionId, sql } }, undefined, options);
      assert.equal(error.isError, true);
      assert.equal(typeof error.structuredContent.error, 'string');
      assert.equal(error.structuredContent.rows, undefined);
    }
    await assert.rejects(client.callTool({ name: 'inspect_schema', arguments: { connectionId, cursor: 'invalid' } }, undefined, options), error => error.code === -32602);
    await fixture('lock', connectionId);
    const abort = new AbortController();
    let settled = false;
    const cancelled = client.callTool({ name: 'execute_query', arguments: { connectionId, sql: 'SELECT c000 FROM t6_metadata.columns_page' } }, undefined, { ...options, signal: abort.signal });
    const rejected = assert.rejects(cancelled, /SDK acceptance cancellation/).finally(() => { settled = true; });
    await fixture('active');
    assert.equal(settled, false, 'Query must be running when cancelled');
    abort.abort(new Error('SDK acceptance cancellation'));
    await rejected;
    await fixture('cancelled');
    await fixture('unlock');
    assert.deepEqual((await call(client, 'execute_query', { connectionId, sql: 'SELECT 42 AS acceptance' })).rows, rows);
    await call(client, 'inspect_schema', { connectionId });
    process.stderr.write(`SDK acceptance passed: ${connectionId}\n`);
  }
  await client.ping(options);
  const replacement = await fixture('replace');
  await assert.rejects(client.listTools({}, options), error => error.code === 401);
  await assert.rejects(connect(url, token), error => error.code === 401);
  const fresh = await connect(url, replacement.token);
  assert.deepEqual((await call(fresh, 'execute_query', { connectionId: 'postgres', sql: 'SELECT 42 AS acceptance' })).rows, [[{ t: 'text', v: '42' }]]);
  await Promise.all(clients.map(client => client.close()));
  await fixture('shutdown');
  process.stderr.write('SDK handshake, discovery, grants, pagination, results, errors, cancellation and token replacement passed\n');
} finally {
  await Promise.all(clients.map(client => client.close()));
  input.close();
  process.stdin.pause();
}
