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

    // 2. Service is reachable (any HTTP response counts)
    try {
      const baseUrl = process.env.SUT_BASE_URL ?? ''
      const healthUrl = baseUrl.replace(/\/mcp$/, '') + '/health'
      const res = await fetch(healthUrl)
      expect(res.status, `SUT health endpoint returned unexpected status`).toBeGreaterThanOrEqual(100)
    } catch (e) { failures.push(String((e as Error).message)) }

    // 3. Required Auth0 env vars are present
    try {
      expect(process.env.AUTH0_DOMAIN, 'AUTH0_DOMAIN must be set').toBeTruthy()
    } catch (e) { failures.push(String((e as Error).message)) }
    try {
      expect(process.env.AUTH0_CLIENT_ID, 'AUTH0_CLIENT_ID must be set').toBeTruthy()
    } catch (e) { failures.push(String((e as Error).message)) }
    try {
      expect(process.env.AUTH0_CLIENT_SECRET, 'AUTH0_CLIENT_SECRET must be set').toBeTruthy()
    } catch (e) { failures.push(String((e as Error).message)) }
    try {
      expect(process.env.AUTH0_AUDIENCE, 'AUTH0_AUDIENCE must be set').toBeTruthy()
    } catch (e) { failures.push(String((e as Error).message)) }
    try {
      expect(process.env.AUTH0_TEST_USERNAME, 'AUTH0_TEST_USERNAME must be set').toBeTruthy()
    } catch (e) { failures.push(String((e as Error).message)) }
    try {
      expect(process.env.AUTH0_TEST_PASSWORD, 'AUTH0_TEST_PASSWORD must be set').toBeTruthy()
    } catch (e) { failures.push(String((e as Error).message)) }

    // 4. DATABASE_URL is present
    try {
      expect(process.env.DATABASE_URL, 'DATABASE_URL must be set').toBeTruthy()
    } catch (e) { failures.push(String((e as Error).message)) }

    // 5. Owner Ada North can authenticate — warm the pooled session
    const { clientProvider } = await import('@kerno/ts-sandbox')
    const { AuthClient } = await import('@auth0/auth0-auth-js')

    const ownerIdentity = { id: 'ada-north-owner' }
    const login = async () => {
      const domain = process.env.AUTH0_DOMAIN ?? ''
      const customFetch: typeof fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
        const rewritten = url.replace(`https://${domain}`, `http://${domain}`)
        return fetch(rewritten, init)
      }
      const authClient = new AuthClient({
        domain,
        clientId: process.env.AUTH0_CLIENT_ID ?? '',
        clientSecret: process.env.AUTH0_CLIENT_SECRET ?? '',
        audience: process.env.AUTH0_AUDIENCE ?? '',
        customFetch,
      })
      let tokenResponse: Awaited<ReturnType<typeof authClient.getTokenByPassword>>
      try {
        tokenResponse = await authClient.getTokenByPassword({
          username: process.env.AUTH0_TEST_USERNAME ?? '',
          password: process.env.AUTH0_TEST_PASSWORD ?? '',
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED')) {
          throw new Error(`BLOCKED: Auth0 fetch failed (local issuer is HTTP-only on port 3000): ${msg}`)
        }
        throw err
      }
      const token = tokenResponse.accessToken
      const expiresAt = tokenResponse.expiresIn != null ? Date.now() + tokenResponse.expiresIn * 1000 : undefined
      return { client: token, expiresAt }
    }

    try {
      await clientProvider().withClient({ user: ownerIdentity, login, poolable: true }, async (token) => {
        expect(token, 'owner access token must be a non-empty string').toBeTruthy()
      })
    } catch (e) {
      const msg = String((e as Error).message)
      if (msg.includes('BLOCKED')) {
        throw new Error(msg)
      }
      failures.push(msg)
    }

    // 6. Seeded GBP accounts exist in the database
    const pg = await import('pg')
    const db = new pg.default.Client(process.env.DATABASE_URL)
    await db.connect()
    try {
      const result = await db.query(
        `SELECT id, currency FROM accounts WHERE id IN ($1, $2)`,
        ['10000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000022']
      )
      try {
        expect(result.rows.length, 'both seeded GBP accounts must exist').toBe(2)
      } catch (e) { failures.push(String((e as Error).message)) }
      for (const row of result.rows) {
        try {
          expect(row.currency, `account ${String(row.id)} must be GBP`).toBe('GBP')
        } catch (e) { failures.push(String((e as Error).message)) }
      }
    } finally {
      await db.end()
    }
  })
  // HARD expect — labeled exception to the soft-throughout assert rule: this single aggregate
  // expectation IS the whole report. Every individual check already ran to completion in act
  // (each in its own try/catch pushing to failures[]), so there is nothing downstream to hide.
  ctx.assert('all preconditions hold', () => { expect(failures, failures.join(' | ')).toHaveLength(0) })
}