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

    // 2. Required env vars
    const requiredVars = [
      'AUTH0_DOMAIN',
      'AUTH0_CLIENT_ID',
      'AUTH0_CLIENT_SECRET',
      'AUTH0_AUDIENCE',
      'AUTH0_TEST_USERNAME',
      'AUTH0_TEST_PASSWORD',
      'DATABASE_URL',
    ]
    for (const name of requiredVars) {
      try {
        expect(process.env[name], `${name} must be set`).toBeTruthy()
      } catch (e) { failures.push(String((e as Error).message)) }
    }

    // 3. Service answers at /health (any HTTP status counts as reachable)
    try {
      const base = process.env.SUT_BASE_URL!
      const resp = await fetch(`${base.replace(/\/mcp$/, '')}/health`)
      expect(resp.status, 'health endpoint returned an unexpected status').toBeGreaterThanOrEqual(100)
    } catch (e) { failures.push(String((e as Error).message)) }

    // 4 & 5. Auth0 can mint a token for Ada North; MCP lists create_expense and list_expenses
    // AuthClient always dials https://AUTH0_DOMAIN. This issuer is HTTP on port 3000.
    // A fetch failure here is an environment fault — report BLOCKED so the suite knows.
    try {
      const { clientProvider } = await import('@kerno/ts-sandbox')
      const { AuthClient } = await import('@auth0/auth0-auth-js')

      const adaNorth = { id: 'ada-north-owner' }
      const login = async () => {
        const domain = process.env.AUTH0_DOMAIN!
        const customFetch: typeof fetch = (input, init) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
          const rewritten = url.replace(`https://${domain}`, `http://${domain}`)
          return fetch(rewritten, init)
        }
        const authClient = new AuthClient({
          domain,
          clientId: process.env.AUTH0_CLIENT_ID!,
          clientSecret: process.env.AUTH0_CLIENT_SECRET!,
          audience: process.env.AUTH0_AUDIENCE!,
          customFetch,
        })
        let result: Awaited<ReturnType<typeof authClient.getTokenByPassword>>
        try {
          result = await authClient.getTokenByPassword({
            username: process.env.AUTH0_TEST_USERNAME!,
            password: process.env.AUTH0_TEST_PASSWORD!,
          })
        } catch (fetchErr) {
          const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
          if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED') || msg.includes('certificate')) {
            throw new Error(`BLOCKED: Auth0 HTTPS fetch failed (local issuer is HTTP-only on port 3000): ${msg}`)
          }
          throw fetchErr
        }
        const tokenData = result as unknown as Record<string, unknown>
        const accessToken =
          (tokenData.accessToken as string | undefined) ??
          (tokenData.access_token as string | undefined) ??
          ((tokenData.data as Record<string, unknown> | undefined)?.accessToken as string | undefined) ??
          ((tokenData.data as Record<string, unknown> | undefined)?.access_token as string | undefined)
        if (!accessToken) {
          throw new Error(`getTokenByPassword returned no access token; keys: ${Object.keys(tokenData).join(',')}`)
        }
        const expiresIn =
          (tokenData.expiresIn as number | undefined) ??
          (tokenData.expires_in as number | undefined) ??
          ((tokenData.data as Record<string, unknown> | undefined)?.expiresIn as number | undefined) ??
          ((tokenData.data as Record<string, unknown> | undefined)?.expires_in as number | undefined)
        return {
          client: accessToken,
          expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
        }
      }

      await clientProvider().withClient({ user: adaNorth, login, poolable: true }, async (token) => {
        // Check the token is valid JWT for Ada North with required permissions
        expect(token, 'access token must be a non-empty string').toBeTruthy()
        const parts = (token as string).split('.')
        expect(parts.length, 'access token must be a JWT with 3 parts').toBe(3)
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>
        expect(payload.sub, 'token subject must be Ada North').toBe('auth0|6728f0a1b2c3d4e5f6789012')
        const perms = payload.permissions as string[] | undefined
        expect(perms, 'token must include expenses:write').toContain('expenses:write')
        expect(perms, 'token must include expenses:read').toContain('expenses:read')

        // Also verify that create_expense and list_expenses are registered
        const base = process.env.SUT_BASE_URL!
        const resp = await fetch(base, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'accept': 'application/json, text/event-stream',
            'authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
        })
        expect(resp.status, 'tools/list must return 200').toBe(200)
        const body = await resp.text()
        expect(body, 'tools/list response must mention create_expense').toContain('create_expense')
        expect(body, 'tools/list response must mention list_expenses').toContain('list_expenses')
      })
    } catch (e) { failures.push(String((e as Error).message)) }

    // 6. Postgres: organization Northwharf Ltd exists
    try {
      const pg = await import('pg')
      const db = new pg.default.Client(process.env.DATABASE_URL)
      await db.connect()
      try {
        const res = await db.query(
          "SELECT id FROM organizations WHERE id = '10000000-0000-4000-8000-000000000001'",
        )
        expect(res.rows.length, 'organization Northwharf Ltd must exist').toBe(1)
      } finally {
        await db.end()
      }
    } catch (e) { failures.push(String((e as Error).message)) }

    // 7. Postgres: Ada North member row exists
    try {
      const pg = await import('pg')
      const db = new pg.default.Client(process.env.DATABASE_URL)
      await db.connect()
      try {
        const res = await db.query(
          "SELECT id FROM members WHERE auth_subject = 'auth0|6728f0a1b2c3d4e5f6789012'",
        )
        expect(res.rows.length, 'Ada North member row must exist').toBe(1)
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