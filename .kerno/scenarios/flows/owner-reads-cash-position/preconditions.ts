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

    // 2. Required Auth0 env vars are set
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

    // 3. DATABASE_URL is set
    try {
      expect(process.env.DATABASE_URL, 'DATABASE_URL must be set').toBeTruthy()
    } catch (e) { failures.push(String((e as Error).message)) }

    // 4. SUT is reachable (any HTTP status counts — connection failure does not)
    try {
      const baseUrl = process.env.SUT_BASE_URL as string
      const healthUrl = new URL('/health', baseUrl).toString()
      const res = await fetch(healthUrl)
      expect(res.status, `SUT unreachable at ${healthUrl}`).toBeGreaterThanOrEqual(100)
    } catch (e) {
      const msg = String((e as Error).message)
      if (msg.includes('fetch') || msg.includes('ECONNREFUSED') || msg.includes('network')) {
        failures.push(`SUT not reachable: ${msg}`)
      } else {
        failures.push(msg)
      }
    }

    // 5. Actor can sign in: mint token for Ada North via AuthClient.getTokenByPassword
    try {
      const { AuthClient } = await import('@auth0/auth0-auth-js')
      const adaNorth = { id: 'ada-north-owner' }

      const login = async () => {
        const domain = process.env.AUTH0_DOMAIN as string
        // AuthClient always builds https:// URLs; this issuer is HTTP-only on port 3000.
        // customFetch rewrites https://domain → http://domain before fetching.
        // For OIDC discovery responses, the returned metadata contains issuer: "http://..."
        // but AuthClient compares it against "https://...". We rewrite http:// → https://
        // in the discovery response body so the comparison succeeds.
        const customFetch: typeof fetch = async (input, init) => {
          const rawUrl = typeof input === 'string' ? input
            : input instanceof URL ? input.toString()
            : (input as Request).url
          const rewritten = rawUrl.replace(`https://${domain}`, `http://${domain}`)
          const res = await fetch(rewritten, init)
          // If this is an OIDC discovery request, patch the issuer in the JSON body
          if (rawUrl.includes('openid-configuration') || rawUrl.includes('oauth-authorization-server')) {
            const body = await res.text()
            const patched = body.replace(new RegExp(`http://${domain.replace(':', '\\:')}`, 'g'), `https://${domain}`)
            return new Response(patched, {
              status: res.status,
              statusText: res.statusText,
              headers: res.headers,
            })
          }
          return res
        }
        const client = new AuthClient({
          domain,
          clientId: process.env.AUTH0_CLIENT_ID as string,
          clientSecret: process.env.AUTH0_CLIENT_SECRET as string,
          customFetch,
        })
        let tokenResult: Awaited<ReturnType<typeof client.getTokenByPassword>>
        try {
          tokenResult = await client.getTokenByPassword({
            username: process.env.AUTH0_TEST_USERNAME as string,
            password: process.env.AUTH0_TEST_PASSWORD as string,
            audience: process.env.AUTH0_AUDIENCE as string,
          })
        } catch (authErr) {
          const msg = String((authErr as Error).message)
          if (msg.toLowerCase().includes('https') || msg.toLowerCase().includes('ssl') || msg.toLowerCase().includes('tls')) {
            throw new Error(`BLOCKED: Auth0 HTTPS environment fault — ${msg}`)
          }
          throw authErr
        }
        // Try both known shapes: { data: { accessToken } } and { data: { token } } and root-level
        const token = tokenResult.data?.accessToken
          ?? (tokenResult.data as Record<string, unknown> | undefined)?.['token'] as string | undefined
          ?? (tokenResult as unknown as Record<string, unknown>)['accessToken'] as string | undefined
          ?? (tokenResult as unknown as Record<string, unknown>)['token'] as string | undefined
        if (!token) {
          const dump = JSON.stringify(tokenResult, null, 0).slice(0, 400)
          throw new Error(`getTokenByPassword result has no token. Shape: ${dump}`)
        }
        return { client: token as string }
      }

      const { clientProvider } = await import('@kerno/ts-sandbox')
      await clientProvider().withClient({ user: adaNorth, login, poolable: true }, async (token) => {
        expect(token, 'Ada North access token must be a non-empty string').toBeTruthy()
      })
    } catch (e) { failures.push(String((e as Error).message)) }

    // 6. DB: seeded organization and Ada North member exist, and org has at least one account
    try {
      const pg = await import('pg')
      const db = new pg.default.Client(process.env.DATABASE_URL)
      await db.connect()
      try {
        const orgRes = await db.query(
          `SELECT id FROM organizations WHERE id = $1 LIMIT 1`,
          ['10000000-0000-4000-8000-000000000001']
        )
        expect(orgRes.rowCount, 'Seeded organization Northwharf Ltd must exist').toBeGreaterThan(0)

        const memberRes = await db.query(
          `SELECT id FROM members WHERE email = $1 LIMIT 1`,
          ['ada.north@northwharf.example']
        )
        expect(memberRes.rowCount, 'Seeded member Ada North must exist').toBeGreaterThan(0)

        const accountRes = await db.query(
          `SELECT id FROM accounts WHERE organization_id = $1 LIMIT 1`,
          ['10000000-0000-4000-8000-000000000001']
        )
        expect(accountRes.rowCount, 'Northwharf Ltd must have at least one account').toBeGreaterThan(0)
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