import { ctx } from '@kerno/ts-sandbox'
import { expect, vi } from 'vitest'

export const meta = {
  description: 'The owner Ada North authenticates with a password grant access token (or falls back to pre-minted credentials when the local Auth0 issuer is unreachable over HTTPS), lists her organization\'s cards to locate the seeded card 10000000-0000-4000-8000-000000000041 (last four 4412) and capture its current spending limit, sets that card\'s spending limit to a fresh per-run amount via the set_card_limit MCP tool, and lists cards again. The final list_cards response contains the card with its spendingLimitMinor equal to the amount just set and different from the pre-change value, all other fields (id, memberId, accountId, lastFour, status, currency) unchanged, and no extra keys. The database row reflects the new limit and the correct organization_id. Cleanup restores the seeded limit of 500000.',
  path: 'FLOW owner-changes-a-card-limit',
}

export default function owner_changes_a_card_limit() {
  const mcpUrl = process.env.SUT_BASE_URL!
  const cardId = '10000000-0000-4000-8000-000000000041'
  
  let accessToken: string
  let preChangeLimit: number
  let memberId: string
  let accountId: string
  let lastFour: string
  let status: string
  let currency: string
  let newLimit: number
  let db: any

  ctx.step('authenticate', 'Mint Ada North\'s access token via Auth0 password grant', async () => {
    const { AuthClient } = await import('@auth0/auth0-auth-js')
    
    const domain = process.env.AUTH0_DOMAIN!
    const clientId = process.env.AUTH0_CLIENT_ID!
    const clientSecret = process.env.AUTH0_CLIENT_SECRET!
    const audience = process.env.AUTH0_AUDIENCE!
    const username = process.env.AUTH0_TEST_USERNAME!
    const password = process.env.AUTH0_TEST_PASSWORD!

    const authClient = new AuthClient({ domain, clientId, clientSecret })
    
    try {
      const tokenResult = await authClient.getTokenByPassword({ audience, username, password })
      accessToken = tokenResult.accessToken
      expect.soft(accessToken, 'access_token must be present').toBeTruthy()
    } catch (err) {
      const msg = String((err as Error).message ?? err)
      if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED') || msg.includes('https')) {
        // Known environment fault: AuthClient cannot reach HTTP-only issuer over HTTPS.
        // Fall back to MCP_AUTH_HEADERS injected by Kerno.
        const injectedAuth = process.env.MCP_AUTH_HEADERS
        if (injectedAuth) {
          // Parse "Authorization: Bearer <token>" or just a raw token
          const match = /Bearer\s+(\S+)/i.exec(injectedAuth)
          accessToken = match ? match[1] : injectedAuth
        } else {
          throw new Error(`BLOCKED: Auth0 HTTPS fetch failed (local issuer is HTTP-only on port 3000) and no MCP_AUTH_HEADERS fallback: ${msg}`)
        }
      } else {
        throw err
      }
    }
    
    expect.soft(accessToken, 'must have a bearer token').toBeTruthy()

    // Open database connection for cleanup
    const pg = await import('pg')
    db = new pg.default.Client(process.env.DATABASE_URL)
    await db.connect()
    
    ctx.onCleanUp('close database connection', async () => {
      await db.end().catch(() => {})
    })
  })

  ctx.step('list-cards-initial', 'List cards to capture the current limit', async () => {
    const res = await fetch(mcpUrl, {
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
        params: { name: 'list_cards', arguments: {} },
      }),
    })

    const body = await res.json()
    const clue = `list_cards (initial) -> ${res.status} ${JSON.stringify(body)}`
    
    expect.soft(res.status, clue).toBe(200)
    expect.soft(body.result, clue).toBeDefined()
    expect.soft('isError' in body.result, clue).toBe(false)
    expect.soft(body.result.content, clue).toHaveLength(1)
    expect.soft(body.result.content[0].type, clue).toBe('text')
    
    const parsed = JSON.parse(body.result.content[0].text)
    expect.soft(parsed.cards, clue).toBeDefined()
    expect.soft(Array.isArray(parsed.cards), clue).toBe(true)
    
    const card = parsed.cards.find((c: any) => c.id === cardId)
    expect.soft(card, clue).toBeDefined()
    expect.soft(card.lastFour, clue).toBe('4412')
    
    preChangeLimit = card.spendingLimitMinor
    memberId = card.memberId
    accountId = card.accountId
    lastFour = card.lastFour
    status = card.status
    currency = card.currency
    
    expect.soft(typeof preChangeLimit, clue).toBe('number')
    
    // Generate a new limit different from the current one
    newLimit = 750000
    if (preChangeLimit === newLimit) {
      newLimit = 600000
    }

    ctx.onCleanUp('restore seeded limit', async () => {
      const result = await db.query(
        `UPDATE cards SET spending_limit_minor = 500000 WHERE id = $1`,
        [cardId]
      )
      expect.soft(result.rowCount, 'cleanup: restore seeded limit').toBe(1)
    })
  })

  ctx.step('set-card-limit', 'Set the card spending limit to a new value', async () => {
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'set_card_limit',
          arguments: { cardId, spendingLimitMinor: newLimit },
        },
      }),
    })

    const body = await res.json()
    const clue = `set_card_limit -> ${res.status} ${JSON.stringify(body)}`
    
    expect.soft(res.status, clue).toBe(200)
    expect.soft(body.result, clue).toBeDefined()
    expect.soft('isError' in body.result, clue).toBe(false)
    expect.soft(body.result.content, clue).toHaveLength(1)
    expect.soft(body.result.content[0].type, clue).toBe('text')
    
    const parsed = JSON.parse(body.result.content[0].text)
    expect.soft(parsed.id, clue).toBe(cardId)
    expect.soft(parsed.spendingLimitMinor, clue).toBe(newLimit)
  })

  ctx.step('list-cards-final', 'List cards again and verify the limit changed', async () => {
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'list_cards', arguments: {} },
      }),
    })

    const body = await res.json()
    const clue = `list_cards (final) -> ${res.status} ${JSON.stringify(body)}`
    
    // HTTP and MCP tool success
    expect.soft(res.status, clue).toBe(200)
    expect.soft(body.result, clue).toBeDefined()
    expect.soft('isError' in body.result, clue).toBe(false)
    expect.soft(body.result.content, clue).toHaveLength(1)
    expect.soft(body.result.content[0].type, clue).toBe('text')
    
    // Parse the response
    const parsed = JSON.parse(body.result.content[0].text)
    expect.soft(Object.keys(parsed), clue).toEqual(['cards'])
    expect.soft(Array.isArray(parsed.cards), clue).toBe(true)
    
    // Find the card
    const cards = parsed.cards.filter((c: any) => c.id === cardId)
    expect.soft(cards.length, clue).toBe(1)
    const card = cards[0]
    
    // The business outcome: the limit changed
    expect.soft(card.spendingLimitMinor, clue).toBe(newLimit)
    expect.soft(card.spendingLimitMinor, clue).not.toBe(preChangeLimit)
    
    // Field accounting: all fields present and correct
    expect.soft(card.id, clue).toBe(cardId)
    expect.soft(card.memberId, clue).toBe(memberId)
    expect.soft(card.accountId, clue).toBe(accountId)
    expect.soft(card.lastFour, clue).toBe('4412')
    expect.soft(card.status, clue).toBe(status)
    expect.soft(['active', 'frozen', 'cancelled'].includes(card.status), clue).toBe(true)
    expect.soft(card.currency, clue).toBe(currency)
    expect.soft(['GBP', 'EUR', 'USD'].includes(card.currency), clue).toBe(true)
    
    // No extra keys
    const expectedKeys = ['id', 'memberId', 'accountId', 'lastFour', 'status', 'spendingLimitMinor', 'currency']
    expect.soft(Object.keys(card).sort(), clue).toEqual(expectedKeys.sort())
    
    // Response headers
    const contentType = res.headers.get('content-type')
    expect.soft(contentType, 'content-type header').toBeTruthy()
    expect.soft(
      contentType === 'application/json' || contentType?.startsWith('application/json') || contentType === 'text/event-stream',
      `content-type: ${contentType}`
    ).toBe(true)
    
    // Headers expected absent
    const absentHeaders = [
      'cache-control', 'vary', 'set-cookie', 'access-control-allow-origin',
      'content-security-policy', 'strict-transport-security', 
      'x-frame-options', 'x-content-type-options', 'referrer-policy'
    ]
    for (const header of absentHeaders) {
      const value = res.headers.get(header)
      if (value !== null) {
        expect.soft(value, `${header} expected absent but got`).toBeNull()
      }
    }
    
    // Verify persisted state
    const dbResult = await db.query(
      `SELECT spending_limit_minor, organization_id FROM cards WHERE id = $1`,
      [cardId]
    )
    expect.soft(dbResult.rows.length, 'card exists in database').toBe(1)
    expect.soft(Number(dbResult.rows[0].spending_limit_minor), 'persisted spending_limit_minor').toBe(newLimit)
    expect.soft(dbResult.rows[0].organization_id, 'persisted organization_id').toBe('10000000-0000-4000-8000-000000000001')
  })
}