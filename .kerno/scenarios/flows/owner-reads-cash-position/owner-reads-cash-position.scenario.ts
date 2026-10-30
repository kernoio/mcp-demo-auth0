import { ctx } from '@kerno/ts-sandbox'
import { expect, vi } from 'vitest'

export const meta = {
  description: 'Ada North, the seeded owner of Northwharf Ltd (organization 10000000-0000-4000-8000-000000000001), reads the organization\'s cash position by calling the MCP tool cash_snapshot after the scenario seeds a per-run GBP account with a non-zero balance, one debit transaction (which counts as burn), and one transfer_out transaction (which is an outflow but not burn). The scenario mints an owner access token via Auth0 password grant (using AuthClient.getTokenByPassword with customFetch that rewrites https to http and patches the issuer in OIDC discovery responses), then sends a stateless tools/call request to the MCP endpoint with Authorization: Bearer. The assertions verify that the MCP response is a successful tool result (isError field absent, content array has exactly one text entry), the JSON payload parses and contains exactly the keys asOf, burnWindowDays, currencies, and recentOutflows, asOf is a valid ISO-8601 timestamp, burnWindowDays is 30, currencies is a non-empty sorted array with an entry for GBP (the seeded currency) plus any other currencies the organization holds, each currencies entry has balanceMinor equal to the independent sum(balance_minor) grouped by currency for the organization (cross-checked via direct SQL), each burnMinor equals the independent sum of debit transaction amounts in the last 30 days for that currency (excluding the seeded transfer_out, confirming internal transfers are not counted as burn), each runwayMonths equals round((balance/burn)*100)/100 when burn is positive or null when burn is zero, recentOutflows is an array of at most 8 entries equal in order and content to the independent top-8 debit/transfer_out transactions ordered by occurred_at descending (ids match, amounts parsed as integers match, timestamps as ISO-8601 match), no credential fields (token, accessToken, authorization, password, secret) leak into the snapshot body, and the response Content-Type header is application/json. The scenario cleans up the seeded transactions and account with verified rowCount for each DELETE, and closes the Postgres connection in a finally block.',
  path: 'FLOW owner-reads-cash-position',
}

export default function owner_reads_cash_position() {
  const runId = Date.now().toString(36)
  const orgId = '10000000-0000-4000-8000-000000000001'
  
  let accessToken: string
  let db: any
  let memberId: string
  let accountId: string
  let debitTxId: string
  let transferOutTxId: string
  const seededBalanceMinor = 100000
  const seededDebitAmount = 5000
  const seededTransferAmount = 3000

  ctx.step('seed-ledger', 'Seed per-run GBP account and transactions for discriminating cash position', async () => {
    const pg = await import('pg')
    db = new pg.default.Client(process.env.DATABASE_URL)
    await db.connect()

    // Get Ada North's member id
    const memberRes = await db.query(
      'SELECT id FROM members WHERE email = $1 LIMIT 1',
      ['ada.north@northwharf.example']
    )
    if (memberRes.rowCount === 0) throw new Error('Ada North member not found')
    memberId = memberRes.rows[0].id

    // Create unique GBP account
    const { randomUUID } = await import('node:crypto')
    accountId = randomUUID()
    await db.query(
      `INSERT INTO accounts (id, organization_id, name, currency, balance_minor, created_at)
       VALUES ($1, $2, $3, 'GBP', $4, now())`,
      [accountId, orgId, `Test Account ${runId}`, seededBalanceMinor]
    )

    // Create debit transaction (counts as burn)
    debitTxId = randomUUID()
    await db.query(
      `INSERT INTO transactions (id, organization_id, account_id, kind, amount_minor, currency, description, 
                                 transfer_group_id, counterparty_account_id, created_by_member_id, occurred_at)
       VALUES ($1, $2, $3, 'debit', $4, 'GBP', 'Test debit', NULL, NULL, $5, now())`,
      [debitTxId, orgId, accountId, seededDebitAmount, memberId]
    )

    // Create transfer_out transaction (outflow, but not burn)
    transferOutTxId = randomUUID()
    await db.query(
      `INSERT INTO transactions (id, organization_id, account_id, kind, amount_minor, currency, description,
                                 transfer_group_id, counterparty_account_id, created_by_member_id, occurred_at)
       VALUES ($1, $2, $3, 'transfer_out', $4, 'GBP', 'Test transfer out', $5, NULL, $6, now())`,
      [transferOutTxId, orgId, accountId, seededTransferAmount, randomUUID(), memberId]
    )

    ctx.onCleanUp('delete seeded transactions and account', async () => {
      try {
        const delTx1 = await db.query('DELETE FROM transactions WHERE id = $1', [debitTxId])
        expect.soft(delTx1.rowCount, `DELETE transaction ${debitTxId}`).toBeGreaterThan(0)
        
        const delTx2 = await db.query('DELETE FROM transactions WHERE id = $1', [transferOutTxId])
        expect.soft(delTx2.rowCount, `DELETE transaction ${transferOutTxId}`).toBeGreaterThan(0)
        
        const delAcc = await db.query('DELETE FROM accounts WHERE id = $1', [accountId])
        expect.soft(delAcc.rowCount, `DELETE account ${accountId}`).toBeGreaterThan(0)
      } finally {
        await db.end().catch(() => {})
      }
    })
  })

  ctx.step('sign-in', 'Mint owner access token via Auth0 password grant', async () => {
    const { AuthClient } = await import('@auth0/auth0-auth-js')
    const domain = process.env.AUTH0_DOMAIN as string

    // customFetch rewrites https → http and patches issuer in discovery responses
    const customFetch: typeof fetch = async (input, init) => {
      const rawUrl = typeof input === 'string' ? input
        : input instanceof URL ? input.toString()
        : (input as Request).url
      const rewritten = rawUrl.replace(`https://${domain}`, `http://${domain}`)
      const res = await fetch(rewritten, init)
      
      // Patch issuer in OIDC discovery response
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

    const tokenResult = await client.getTokenByPassword({
      username: process.env.AUTH0_TEST_USERNAME as string,
      password: process.env.AUTH0_TEST_PASSWORD as string,
      audience: process.env.AUTH0_AUDIENCE as string,
    })

    // Try all known token field locations
    accessToken = tokenResult.data?.accessToken
      ?? (tokenResult.data as Record<string, unknown> | undefined)?.['token'] as string | undefined
      ?? (tokenResult as unknown as Record<string, unknown>)['accessToken'] as string | undefined
      ?? (tokenResult as unknown as Record<string, unknown>)['token'] as string | undefined
      ?? ''

    if (!accessToken) {
      throw new Error(`getTokenByPassword returned no token: ${JSON.stringify(tokenResult).slice(0, 400)}`)
    }

    expect.soft(accessToken, 'Access token must be non-empty').toBeTruthy()
  })

  ctx.step('call-cash-snapshot', 'Call cash_snapshot MCP tool and verify result envelope', async () => {
    const res = await fetch(process.env.SUT_BASE_URL as string, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'cash_snapshot', arguments: {} },
      }),
    })

    const clue = `POST /mcp tools/call cash_snapshot -> ${res.status}`
    expect.soft(res.status, clue).toBe(200)

    const body = await res.json() as {
      result?: {
        content?: Array<{ type: string; text: string }>
      }
    }

    // Verify MCP result envelope (isError absent or false means success)
    expect.soft('isError' in (body.result ?? {}), 'MCP result.isError absent').toBe(false)
    expect.soft(body.result?.content, 'MCP result.content').toHaveLength(1)
    expect.soft(body.result?.content?.[0]?.type, 'MCP content[0].type').toBe('text')

    const snapshotText = body.result?.content?.[0]?.text ?? ''
    const snapshot = JSON.parse(snapshotText) as {
      asOf: string
      burnWindowDays: number
      currencies: Array<{
        currency: string
        balanceMinor: number
        burnMinor: number
        runwayMonths: number | null
      }>
      recentOutflows: Array<{
        id: string
        accountId: string
        kind: string
        amountMinor: number
        currency: string
        description: string
        transferGroupId: string | null
        counterpartyAccountId: string | null
        occurredAt: string
      }>
    }

    // Verify snapshot structure
    expect.soft(Object.keys(snapshot).sort(), 'snapshot keys').toEqual(['asOf', 'burnWindowDays', 'currencies', 'recentOutflows'].sort())
    expect.soft(snapshot.asOf, 'asOf is ISO-8601').toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect.soft(Date.parse(snapshot.asOf), 'asOf is valid date').not.toBeNaN()
    expect.soft(snapshot.burnWindowDays, 'burnWindowDays').toBe(30)
    expect.soft(snapshot.currencies.length, 'currencies array non-empty').toBeGreaterThan(0)
    expect.soft(snapshot.recentOutflows.length, 'recentOutflows length').toBeLessThanOrEqual(8)

    // Store snapshot for cross-check step
    ctx.onCleanUp('store snapshot for next step', () => {})
    ;(globalThis as any).__snapshot = snapshot
    ;(globalThis as any).__res = res
  })

  ctx.step('verify-against-sql', 'Cross-check snapshot against independent SQL queries', async () => {
    const snapshot = (globalThis as any).__snapshot as {
      asOf: string
      burnWindowDays: number
      currencies: Array<{
        currency: string
        balanceMinor: number
        burnMinor: number
        runwayMonths: number | null
      }>
      recentOutflows: Array<{
        id: string
        accountId: string
        kind: string
        amountMinor: number
        currency: string
        description: string
        transferGroupId: string | null
        counterpartyAccountId: string | null
        occurredAt: string
      }>
    }
    const res = (globalThis as any).__res as Response

    // Independent SQL: balances per currency
    const balanceRes = await db.query(
      `SELECT currency, sum(balance_minor) as total
       FROM accounts
       WHERE organization_id = $1
       GROUP BY currency
       ORDER BY currency`,
      [orgId]
    )
    const balanceMap = new Map<string, number>()
    for (const row of balanceRes.rows) {
      balanceMap.set(row.currency, parseInt(row.total))
    }

    // Independent SQL: burn per currency (debit only, last 30 days)
    const burnRes = await db.query(
      `SELECT currency, coalesce(sum(amount_minor), 0) as total
       FROM transactions
       WHERE organization_id = $1
         AND kind = 'debit'
         AND occurred_at >= now() - interval '30 days'
       GROUP BY currency`,
      [orgId]
    )
    const burnMap = new Map<string, number>()
    for (const row of burnRes.rows) {
      burnMap.set(row.currency, parseInt(row.total))
    }

    // Independent SQL: recent outflows (top 8)
    const outflowRes = await db.query(
      `SELECT id, account_id, kind, amount_minor, currency, description, 
              transfer_group_id, counterparty_account_id, occurred_at
       FROM transactions
       WHERE organization_id = $1
         AND kind IN ('debit', 'transfer_out')
       ORDER BY occurred_at DESC
       LIMIT 8`,
      [orgId]
    )

    // Verify currencies array
    const sortedCurrencies = [...balanceMap.keys()].sort()
    expect.soft(snapshot.currencies.map(c => c.currency).sort(), 'snapshot currencies').toEqual(sortedCurrencies)
    expect.soft(snapshot.currencies.some(c => c.currency === 'GBP'), 'GBP in currencies').toBe(true)

    for (const currencyEntry of snapshot.currencies) {
      const { currency, balanceMinor, burnMinor, runwayMonths } = currencyEntry
      const clue = `currency ${currency}`

      // Verify each currency entry structure
      expect.soft(Object.keys(currencyEntry).sort(), `${clue} keys`).toEqual(['balanceMinor', 'burnMinor', 'currency', 'runwayMonths'].sort())
      expect.soft(['GBP', 'EUR', 'USD'].includes(currency), `${clue} is valid`).toBe(true)

      // Cross-check balance
      const expectedBalance = balanceMap.get(currency) ?? 0
      expect.soft(balanceMinor, `${clue} balanceMinor`).toBe(expectedBalance)

      // Cross-check burn
      const expectedBurn = burnMap.get(currency) ?? 0
      expect.soft(burnMinor, `${clue} burnMinor`).toBe(expectedBurn)

      // Cross-check runway
      const expectedRunway = expectedBurn > 0 ? Math.round((expectedBalance / expectedBurn) * 100) / 100 : null
      expect.soft(runwayMonths, `${clue} runwayMonths`).toBe(expectedRunway)
    }

    // Verify recentOutflows
    expect.soft(snapshot.recentOutflows.length, 'recentOutflows length').toBe(outflowRes.rowCount)
    
    for (let i = 0; i < snapshot.recentOutflows.length; i++) {
      const entry = snapshot.recentOutflows[i]
      const row = outflowRes.rows[i]
      const clue = `recentOutflows[${i}]`

      expect.soft(Object.keys(entry).sort(), `${clue} keys`).toEqual(
        ['accountId', 'amountMinor', 'counterpartyAccountId', 'currency', 'description', 'id', 'kind', 'occurredAt', 'transferGroupId'].sort()
      )
      expect.soft(entry.id, `${clue} id`).toBe(row.id)
      expect.soft(entry.accountId, `${clue} accountId`).toBe(row.account_id)
      expect.soft(entry.kind, `${clue} kind`).toBe(row.kind)
      expect.soft(['debit', 'transfer_out'].includes(entry.kind), `${clue} kind valid`).toBe(true)
      expect.soft(entry.amountMinor, `${clue} amountMinor`).toBe(parseInt(row.amount_minor))
      expect.soft(entry.amountMinor, `${clue} amountMinor positive`).toBeGreaterThan(0)
      expect.soft(entry.currency, `${clue} currency`).toBe(row.currency)
      expect.soft(['GBP', 'EUR', 'USD'].includes(entry.currency), `${clue} currency valid`).toBe(true)
      expect.soft(entry.description, `${clue} description`).toBe(row.description)
      expect.soft(entry.transferGroupId, `${clue} transferGroupId`).toBe(row.transfer_group_id)
      expect.soft(entry.counterpartyAccountId, `${clue} counterpartyAccountId`).toBe(row.counterparty_account_id)
      expect.soft(entry.occurredAt, `${clue} occurredAt ISO-8601`).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      expect.soft(Date.parse(entry.occurredAt), `${clue} occurredAt valid`).not.toBeNaN()
      expect.soft(new Date(entry.occurredAt).toISOString().slice(0, 19), `${clue} occurredAt matches DB`).toBe(
        new Date(row.occurred_at).toISOString().slice(0, 19)
      )
    }

    // Verify no credential leakage
    const snapshotObj = snapshot as Record<string, unknown>
    expect.soft(snapshotObj.token, 'no token field').toBeUndefined()
    expect.soft(snapshotObj.accessToken, 'no accessToken field').toBeUndefined()
    expect.soft(snapshotObj.authorization, 'no authorization field').toBeUndefined()
    expect.soft(snapshotObj.password, 'no password field').toBeUndefined()
    expect.soft(snapshotObj.secret, 'no secret field').toBeUndefined()

    // Pin response headers
    const contentType = res.headers.get('content-type')
    expect.soft(contentType, 'Content-Type header').toMatch(/application\/json/)
  })
}