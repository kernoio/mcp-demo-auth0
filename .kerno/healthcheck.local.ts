// kerno-healthcheck-contract: v3
// CONTRACT (parsed by Kerno — keep this shape when hand-editing):
//   - record every failure with fail('<kind>', error) inside the single act step, and keep
//     fail()'s recorded shape '<ErrorName>: <message> [<cause code>]';
//   - report every component with its own expect.soft(...) whose clue starts with
//     'healthcheck:<kind>' — one component, one soft expectation, never joined;
//   - keep the contract marker line above: a file without it is treated as predating the
//     contract and re-authored on the next environment setup (a file that stops compiling
//     reports red — it is never silently replaced).
import { ctx } from '@kerno/ts-sandbox'
import { expect } from 'vitest'
export const meta = { description: 'environment healthcheck', path: 'HEALTHCHECK' }
export default function () {
  const failures: Record<string, string[]> = {}
  // The error TYPE leads and the cause code (ERR_INVALID_URL, ECONNREFUSED, ETIMEDOUT, ...) rides
  // at the end, so a reader can classify code-vs-environment by TYPE and CAUSE rather than by the
  // top-level message shape — Node's fetch hides the real cause behind a generic "fetch failed",
  // and a driver that failed on every resolved address (pg on 127.0.0.1 and ::1) throws an
  // AggregateError with NO message at all: without its type that failure reads as a code defect.
  const fail = (kind: string, e: unknown) => {
    const error = e as { name?: string; message?: string; cause?: { code?: string } }
    const cause = error?.cause?.code
    const type = error?.name ?? 'Error'
    ;(failures[kind] ??= []).push(
      type + ': ' + String(error?.message ?? '') + (cause ? ' [' + cause + ']' : ''),
    )
  }
  const fails = (kind: string) => failures[kind] ?? []
  ctx.act('check every infrastructure component', async () => {
    // sut — the application itself. Relative-URL SUT routing is not active in this runtime:
    // probe the absolute base URL directly.
    try {
      const sutBase = process.env.SUT_BASE_URL ?? "http://localhost:8080/mcp"
      // MCP liveness: a 2xx MCP reply or 401/403 is live; credentials are checked by the run precondition.
      const r = await fetch(sutBase, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'kerno-healthcheck', version: '1' } },
        }),
        signal: AbortSignal.timeout(10_000),
      }).catch((e) => {
        throw e?.name === 'TimeoutError'
          ? { name: 'McpProbeError', message: 'POST initialize to ' + sutBase + ': no reply within 10s' }
          : e
      })
      await r.body?.cancel()
      const type = r.headers.get('content-type') ?? ''
      const session = r.headers.get('mcp-session-id')
      if (session) await fetch(sutBase, { method: 'DELETE', headers: { 'mcp-session-id': session }, signal: AbortSignal.timeout(5_000) }).catch(() => {})
      const mcpReply = r.ok && (type.includes('application/json') || type.includes('text/event-stream'))
      if (!mcpReply && r.status !== 401 && r.status !== 403) {
        fail('sut', { name: 'McpProbeError', message: 'POST initialize to ' + sutBase + ' -> ' + r.status + ' ' + type + ' (not a live MCP endpoint)' })
      }
    } catch (e) { fail('sut', e) }

    // postgres
    try {
      const { Client } = await import('pg')
      const client = new Client({ connectionString: process.env["DATABASE_URL"] })
      await client.connect()
      try { await client.query('SELECT 1') } finally { await client.end() }
    } catch (e) { fail('postgres', e) }
  })
  // One expect.soft per component: soft-throughout so EVERY component reports independently —
  // a red postgres must never hide behind a red sut (or vice versa).
  ctx.assert('environment healthy', () => {
    expect.soft(fails('sut'), 'healthcheck:sut: ' + fails('sut').join(' | ')).toHaveLength(0)
    expect.soft(fails('postgres'), 'healthcheck:postgres: ' + fails('postgres').join(' | ')).toHaveLength(0)
  })
}
