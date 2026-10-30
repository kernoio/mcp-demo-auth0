import { ctx } from '@kerno/ts-sandbox'
import { expect, vi } from 'vitest'

export const meta = {
  description: 'The seeded owner Ada North authenticates with a password grant to the local Auth0 issuer at http://localhost:3000, then walks a three-step card-management flow over the MCP endpoint: list all cards, freeze her own debit card (10000000-0000-4000-8000-000000000041, last four 4412, GBP), then list the cards again. The flow verifies that (1) the initial list_cards call returns HTTP 200 with Ada\'s card in active status, (2) the set_card_status call with status frozen returns HTTP 200 with the card entry showing frozen, (3) the final list_cards call returns HTTP 200 with Ada\'s card showing frozen status while Ben\'s card (10000000-0000-4000-8000-000000000042) remains frozen as the seed left it and no card is cancelled, (4) the cards array entries contain exactly the seven expected fields (id, memberId, accountId, lastFour, status, spendingLimitMinor, currency) and no PAN-like fields (number, pan, cvv, expiry), (5) the frozen status persists in the Postgres cards table, and (6) the response bodies contain no stack traces, filesystem paths, SQL text or exception class names. Cleanup restores Ada\'s card to active status so the flow can run again from the same starting state.',
  path: 'FLOW owner-freezes-a-debit-card',
}

export default function owner_freezes_a_debit_card() {
  const cardId = '10000000-0000-4000-8000-000000000041'
  const benCardId = '10000000-0000-4000-8000-000000000042'
  let accessToken: string
  let db: any
  let initialCard: any
  let mcpIdCounter = 1

  const callMcpTool = async (toolName: string, args: Record<string, unknown> = {}) => {
    const res = await fetch(`${process.env.SUT_BASE_URL}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: mcpIdCounter++,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
    })
    const body = await res.text()
    return { res, body }
  }

  ctx.step('authenticate', 'Mint owner access token and set card to active', async () => {
    // Mint token using clientProvider with raw POST /oauth/token (AuthClient does not work with this local issuer)
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
      if (res.status === 429) throw new RetryableError('rate limited')
      const body = await res.json() as Record<string, unknown>
      const token = body.access_token as string | undefined
      expect(token, 'access token must be returned from password grant').toBeTruthy()
      return { client: token as string, expiresAt: body.expires_in ? Date.now() + (body.expires_in as number) * 1000 : undefined }
    }

    await clientProvider().withClient({ user, login, poolable: true }, async (token) => {
      accessToken = token as string
    })

    const clue = `Minted access token: ${accessToken.substring(0, 20)}...`
    expect(accessToken, clue).toBeTruthy()

    // Set card status to 'active' in Postgres
    const pg = await import('pg')
    db = new pg.default.Client(process.env.DATABASE_URL)
    await db.connect()

    const updateResult = await db.query(
      `UPDATE cards SET status = $1 WHERE id = $2 RETURNING id, status`,
      ['active', cardId]
    )
    expect(updateResult.rowCount, `Card ${cardId} must exist and be updated`).toBe(1)
    expect(updateResult.rows[0].status, `Card ${cardId} status after update`).toBe('active')

    ctx.onCleanUp('close database connection', async () => {
      if (db) await db.end().catch(() => {})
    })
  })

  ctx.step('list-cards-initial', 'List cards to confirm Ada\'s card is active', async () => {
    const { res, body } = await callMcpTool('list_cards')
    const clue = `list_cards (initial) -> ${res.status} ${body}`
    
    expect.soft(res.status, clue).toBe(200)
    
    const parsed = JSON.parse(body)
    expect.soft('error' in parsed, clue).toBe(false)
    expect.soft(parsed.result?.content?.[0]?.type, clue).toBe('text')
    
    const resultText = parsed.result.content[0].text
    const resultData = JSON.parse(resultText)
    
    expect.soft(Array.isArray(resultData.cards), clue).toBe(true)
    
    const adaCard = resultData.cards.find((c: any) => c.id === cardId)
    expect.soft(adaCard, clue).toBeDefined()
    expect.soft(adaCard?.status, clue).toBe('active')
    expect.soft(adaCard?.lastFour, clue).toBe('4412')
    expect.soft(adaCard?.currency, clue).toBe('GBP')
    
    initialCard = adaCard
  })

  ctx.step('freeze-card', 'Freeze Ada\'s card with set_card_status', async () => {
    const { res, body } = await callMcpTool('set_card_status', { cardId, status: 'frozen' })
    const clue = `set_card_status -> ${res.status} ${body}`
    
    expect.soft(res.status, clue).toBe(200)
    
    const parsed = JSON.parse(body)
    expect.soft('error' in parsed, clue).toBe(false)
    expect.soft(parsed.result?.content?.[0]?.type, clue).toBe('text')
    
    const resultText = parsed.result.content[0].text
    const resultData = JSON.parse(resultText)
    
    expect.soft(resultData.id, clue).toBe(cardId)
    expect.soft(resultData.status, clue).toBe('frozen')

    ctx.onCleanUp('restore card to active', async () => {
      try {
        const restoreRes = await fetch(`${process.env.SUT_BASE_URL}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'accept': 'application/json, text/event-stream',
            'authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 999,
            method: 'tools/call',
            params: { name: 'set_card_status', arguments: { cardId, status: 'active' } },
          }),
        })
        const restoreBody = await restoreRes.text()
        expect.soft(restoreRes.status, `restore card -> ${restoreRes.status} ${restoreBody}`).toBe(200)
      } catch (e) {
        console.error('Failed to restore card status:', e)
      }
    })
  })

  ctx.step('list-cards-final', 'List cards again and verify frozen status', async () => {
    const { res, body } = await callMcpTool('list_cards')
    const clue = `list_cards (final) -> ${res.status} ${body}`
    
    // Transport assertions
    expect.soft(res.status, clue).toBe(200)
    
    // Envelope assertions
    const parsed = JSON.parse(body)
    expect.soft('error' in parsed, clue).toBe(false)
    expect.soft(parsed.result?.content?.[0]?.type, clue).toBe('text')
    
    const resultText = parsed.result.content[0].text
    const resultData = JSON.parse(resultText)
    
    // Cards array structure
    expect.soft(Array.isArray(resultData.cards), clue).toBe(true)
    expect.soft(Object.keys(resultData).length, clue).toBe(1)
    
    // Find Ada's card
    const adaCards = resultData.cards.filter((c: any) => c.id === cardId)
    expect.soft(adaCards.length, clue).toBe(1)
    
    const adaCard = adaCards[0]
    
    // Field-by-field assertions for Ada's frozen card
    expect.soft(adaCard.id, clue).toBe(cardId)
    expect.soft(adaCard.memberId, clue).toBe(initialCard.memberId)
    expect.soft(adaCard.accountId, clue).toBe(initialCard.accountId)
    expect.soft(adaCard.lastFour, clue).toBe('4412')
    expect.soft(adaCard.status, clue).toBe('frozen')
    expect.soft(adaCard.spendingLimitMinor, clue).toBe(initialCard.spendingLimitMinor)
    expect.soft(adaCard.currency, clue).toBe('GBP')
    
    // No extra properties beyond the expected seven
    const expectedFields = ['id', 'memberId', 'accountId', 'lastFour', 'status', 'spendingLimitMinor', 'currency']
    const actualFields = Object.keys(adaCard).sort()
    expect.soft(actualFields, clue).toEqual(expectedFields.sort())
    
    // No PAN-like fields
    expect.soft(adaCard, clue).not.toHaveProperty('number')
    expect.soft(adaCard, clue).not.toHaveProperty('pan')
    expect.soft(adaCard, clue).not.toHaveProperty('cvv')
    expect.soft(adaCard, clue).not.toHaveProperty('expiry')
    
    // Ben's card isolation
    const benCard = resultData.cards.find((c: any) => c.id === benCardId)
    expect.soft(benCard, clue).toBeDefined()
    expect.soft(benCard?.status, clue).toBe('frozen')
    
    // No cancelled cards
    const cancelledCards = resultData.cards.filter((c: any) => c.status === 'cancelled')
    expect.soft(cancelledCards.length, clue).toBe(0)
    
    // Response headers
    const contentType = res.headers.get('content-type')
    expect.soft(['application/json', 'text/event-stream'].some(ct => contentType?.includes(ct)), `content-type: ${contentType}`).toBe(true)
    
    expect.soft(res.headers.get('set-cookie'), 'Set-Cookie must be absent').toBeNull()
    expect.soft(res.headers.get('access-control-allow-origin'), 'Access-Control-Allow-Origin must be absent').toBeNull()
    
    // Negative: no leak of internals
    expect.soft(body.includes('at '), 'body must not contain stack frames').toBe(false)
    expect.soft(body.includes('/src/'), 'body must not contain filesystem paths').toBe(false)
    expect.soft(body.includes('/app/'), 'body must not contain filesystem paths').toBe(false)
    expect.soft(body.toLowerCase().includes('sql'), 'body must not contain SQL').toBe(false)
    expect.soft(body.toLowerCase().includes('error'), 'body must not contain exception class names').toBe(false)
    
    // Postgres check
    const dbResult = await db.query(
      `SELECT status, spending_limit_minor, last_four, currency FROM cards WHERE id = $1`,
      [cardId]
    )
    const dbClue = `Postgres check: ${JSON.stringify(dbResult.rows)}`
    expect.soft(dbResult.rowCount, dbClue).toBe(1)
    const dbRow = dbResult.rows[0]
    expect.soft(dbRow.status, dbClue).toBe('frozen')
    expect.soft(parseInt(dbRow.spending_limit_minor, 10), dbClue).toBe(initialCard.spendingLimitMinor)
    expect.soft(dbRow.last_four, dbClue).toBe('4412')
    expect.soft(dbRow.currency, dbClue).toBe('GBP')
  })
}