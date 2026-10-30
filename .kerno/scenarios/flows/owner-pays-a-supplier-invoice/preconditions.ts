import { ctx } from '@kerno/ts-sandbox'
import { expect } from 'vitest'
export const meta = { description: 'endpoint preconditions', path: 'PRECONDITION' }
export default function () {
  const failures: string[] = []
  ctx.act('check preconditions', async () => {
    // 1. SUT_BASE_URL is set
    try {
      expect(process.env.SUT_BASE_URL, 'SUT_BASE_URL must be set').toBeTruthy()
    } catch (e) { failures.push(String((e as Error).message)) }

    // 2. Required env vars present
    const requiredEnvVars = [
      'AUTH0_DOMAIN', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET',
      'AUTH0_AUDIENCE', 'AUTH0_TEST_USERNAME', 'AUTH0_TEST_PASSWORD',
      'DATABASE_URL',
    ]
    for (const v of requiredEnvVars) {
      try {
        expect(process.env[v], `${v} must be set`).toBeTruthy()
      } catch (e) { failures.push(String((e as Error).message)) }
    }

    // 3. SUT answers (any HTTP status is reachable)
    try {
      const baseUrl = process.env.SUT_BASE_URL!
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/health`)
      expect(res.status, `SUT health endpoint responded`).toBeLessThan(600)
    } catch (e) { failures.push(`SUT not reachable: ${String((e as Error).message)}`) }

    // 4. Authenticate as Ada North using clientProvider + AuthClient (proves login works)
    try {
      const { clientProvider } = await import('@kerno/ts-sandbox')
      const { AuthClient } = await import('@auth0/auth0-auth-js')
      const user = { id: 'ada-north-owner' }
      const login = async () => {
        const domain = process.env.AUTH0_DOMAIN!
        const customFetch: typeof fetch = (input, init) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
          const rewritten = url.replace(`https://${domain}`, `http://${domain}`)
          const newInput = typeof input === 'string' ? rewritten
            : input instanceof URL ? new URL(rewritten)
            : new Request(rewritten, input as Request)
          return fetch(newInput, init)
        }
        const authClient = new AuthClient({
          domain,
          clientId: process.env.AUTH0_CLIENT_ID!,
          clientSecret: process.env.AUTH0_CLIENT_SECRET!,
          customFetch,
        })
        const tokenResult = await authClient.getTokenByPassword({
          username: process.env.AUTH0_TEST_USERNAME!,
          password: process.env.AUTH0_TEST_PASSWORD!,
          audience: process.env.AUTH0_AUDIENCE!,
          scope: 'openid profile email',
        })
        const token = tokenResult.accessToken
        expect(token, 'access token must be present').toBeTruthy()
        const expiresAt = tokenResult.expiresIn ? Date.now() + tokenResult.expiresIn * 1000 : undefined
        return { client: token, expiresAt }
      }

      await clientProvider().withClient({ user, login, poolable: true }, async (token) => {
        // 5. Confirm the MCP endpoint exposes the required tools
        const mcpUrl = process.env.SUT_BASE_URL!.replace(/\/$/, '')
        const res = await fetch(mcpUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'accept': 'application/json, text/event-stream',
            'authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
        })
        expect(res.status, `tools/list responded`).toBeLessThan(300)
        const body = await res.json() as { result?: { tools?: Array<{ name: string }> } }
        const toolNames = (body?.result?.tools ?? []).map((t: { name: string }) => t.name)
        expect(toolNames, 'list_invoices tool must be exposed').toContain('list_invoices')
        expect(toolNames, 'pay_invoice tool must be exposed').toContain('pay_invoice')
        expect(toolNames, 'get_invoice tool must be exposed').toContain('get_invoice')
      })
    } catch (e) { failures.push(String((e as Error).message)) }

    // 6. DB: seeded organization and GBP operating account exist
    try {
      const pg = await import('pg')
      const db = new pg.default.Client(process.env.DATABASE_URL)
      await db.connect()
      try {
        const orgRes = await db.query(
          `SELECT id FROM organizations WHERE id = '10000000-0000-4000-8000-000000000001'`
        )
        expect(orgRes.rowCount, 'seeded organization Northwharf Ltd must exist').toBe(1)

        const accRes = await db.query(
          `SELECT id FROM accounts WHERE id = '10000000-0000-4000-8000-000000000021' AND currency = 'GBP'`
        )
        expect(accRes.rowCount, 'GBP operating account 10000000-0000-4000-8000-000000000021 must exist').toBe(1)

        const invRes = await db.query(
          `SELECT id, status FROM invoices WHERE id = '10000000-0000-4000-8000-000000000061' AND organization_id = '10000000-0000-4000-8000-000000000001'`
        )
        expect(invRes.rowCount, 'Low Street Print invoice 10000000-0000-4000-8000-000000000061 must exist').toBe(1)
      } finally {
        await db.end()
      }
    } catch (e) { failures.push(String((e as Error).message)) }
  })
  // HARD expect — labeled exception to the soft-throughout assert rule: this single aggregate
  // expectation IS the whole report. Every individual check already ran to completion in act
  // (each in its own try/catch pushing to failures[]), so there is nothing downstream to hide.
  ctx.assert('all preconditions hold', () => { expect(failures, failures.join(' | ')).toHaveLength(0) })
}