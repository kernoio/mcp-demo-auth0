import { ctx } from '@kerno/ts-sandbox'
import { expect } from 'vitest'
export const meta = { description: 'endpoint preconditions', path: 'PRECONDITION' }
export default function () {
  const failures: string[] = []
  ctx.act('check preconditions', async () => {
      // 1. Required env vars are present
    try { expect(process.env.SUT_BASE_URL, 'SUT_BASE_URL must be set').toBeTruthy() } catch (e) { failures.push(String((e as Error).message)) }
    try { expect(process.env.AUTH0_DOMAIN, 'AUTH0_DOMAIN must be set').toBeTruthy() } catch (e) { failures.push(String((e as Error).message)) }
    try { expect(process.env.AUTH0_CLIENT_ID, 'AUTH0_CLIENT_ID must be set').toBeTruthy() } catch (e) { failures.push(String((e as Error).message)) }
    try { expect(process.env.AUTH0_CLIENT_SECRET, 'AUTH0_CLIENT_SECRET must be set').toBeTruthy() } catch (e) { failures.push(String((e as Error).message)) }
    try { expect(process.env.AUTH0_AUDIENCE, 'AUTH0_AUDIENCE must be set').toBeTruthy() } catch (e) { failures.push(String((e as Error).message)) }
    try { expect(process.env.AUTH0_TEST_USERNAME, 'AUTH0_TEST_USERNAME must be set').toBeTruthy() } catch (e) { failures.push(String((e as Error).message)) }
    try { expect(process.env.AUTH0_TEST_PASSWORD, 'AUTH0_TEST_PASSWORD must be set').toBeTruthy() } catch (e) { failures.push(String((e as Error).message)) }
    try { expect(process.env.DATABASE_URL, 'DATABASE_URL must be set').toBeTruthy() } catch (e) { failures.push(String((e as Error).message)) }

    // 2. SUT is reachable — health endpoint derived from SUT_BASE_URL with /mcp suffix removed
    try {
      const base = process.env.SUT_BASE_URL!.replace(/\/mcp\/?$/, '')
      const res = await fetch(`${base}/health`)
      expect(res.status, 'SUT health endpoint returned a response').toBeGreaterThanOrEqual(100)
    } catch (e) { failures.push(String((e as Error).message)) }

    // 3. Actor (Ada North, owner) can authenticate — warms the pooled session
    // AuthClient from @auth0/auth0-auth-js does not work against this HTTP-only local issuer.
    // Use a raw POST /oauth/token password grant inside the clientProvider login callback.
    try {
      const { clientProvider, RetryableError } = await import('@kerno/ts-sandbox')
      const user = { id: 'ada-north-owner' }

      const login = async () => {
        const domain = process.env.AUTH0_DOMAIN!
        const res = await fetch(`http://${domain}/oauth/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'password',
            username: process.env.AUTH0_TEST_USERNAME!,
            password: process.env.AUTH0_TEST_PASSWORD!,
            audience: process.env.AUTH0_AUDIENCE!,
            client_id: process.env.AUTH0_CLIENT_ID!,
            client_secret: process.env.AUTH0_CLIENT_SECRET!,
          }),
        })
        if (res.status === 429) throw new RetryableError('rate limited by auth server')
        const body = await res.json() as Record<string, unknown>
        const token = body.access_token as string | undefined
        expect(token, 'access token must be returned from password grant').toBeTruthy()
        return { client: token as string, expiresAt: body.expires_in ? Date.now() + (body.expires_in as number) * 1000 : undefined }
      }

      await clientProvider().withClient({ user, login, poolable: true }, async (token) => {
        expect(token, 'pooled token must be truthy').toBeTruthy()
      })
    } catch (e) { failures.push(String((e as Error).message)) }

    // 4. Seed check: Ada's card 10000000-0000-4000-8000-000000000041 exists in the DB
    try {
      const pg = await import('pg')
      const db = new pg.default.Client(process.env.DATABASE_URL)
      await db.connect()
      try {
        const result = await db.query(
          `SELECT id, status, last_four FROM cards WHERE id = $1`,
          ['10000000-0000-4000-8000-000000000041']
        )
        expect(result.rowCount, "Ada's card 10000000-0000-4000-8000-000000000041 must exist in cards table").toBeGreaterThan(0)
        if (result.rowCount && result.rowCount > 0) {
          expect(result.rows[0].last_four, "Ada's card last_four must be 4412").toBe('4412')
        }
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