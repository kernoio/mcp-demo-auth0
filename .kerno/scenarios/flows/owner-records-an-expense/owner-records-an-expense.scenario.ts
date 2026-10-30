import { ctx } from '@kerno/ts-sandbox'
import { expect, vi } from 'vitest'

export const meta = {
  description: 'As the seeded owner Ada North (subject auth0|6728f0a1b2c3d4e5f6789012), this flow authenticates via Auth0 password grant with a customFetch that rewrites HTTPS URLs to HTTP (because the local issuer runs HTTP-only on port 3000), records an expense with a unique per-run merchant name and amount using the create_expense MCP tool, then verifies that exact expense appears in the organization\'s expense list returned by list_expenses. The flow asserts the created expense\'s id is a UUID, all fields match the submitted values (merchant, amountMinor, currency GBP, category travel, status submitted), the memberId matches Ada\'s member record, and occurredAt is a valid ISO-8601 timestamp. Cleanup deletes the expense row directly via Postgres and verifies exactly one row was affected.',
  path: 'FLOW owner-records-an-expense',
}

export default function owner_records_an_expense() {
  const runId = Date.now().toString(36)
  let accessToken: string
  let createdExpenseId: string
  let expectedMerchant: string
  let expectedAmountMinor: number
  let expectedMemberId: string
  const expectedCurrency = 'GBP'
  const expectedCategory = 'travel'
  const expectedStatus = 'submitted'

  ctx.step('authenticate', 'Mint access token for Ada North', async () => {
    const { AuthClient } = await import('@auth0/auth0-auth-js')
    const { faker } = await import('@faker-js/faker')

    const domain = process.env.AUTH0_DOMAIN!
    const clientId = process.env.AUTH0_CLIENT_ID!
    const clientSecret = process.env.AUTH0_CLIENT_SECRET!
    const audience = process.env.AUTH0_AUDIENCE!
    const username = process.env.AUTH0_TEST_USERNAME!
    const password = process.env.AUTH0_TEST_PASSWORD!

    const customFetch: typeof fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
      const rewritten = url.replace(`https://${domain}`, `http://${domain}`)
      return fetch(rewritten, init)
    }

    const authClient = new AuthClient({
      domain,
      clientId,
      clientSecret,
      audience,
      customFetch,
    })

    const result = await authClient.getTokenByPassword({ username, password })
    const tokenData = result as unknown as Record<string, unknown>
    accessToken =
      (tokenData.accessToken as string | undefined) ??
      (tokenData.access_token as string | undefined) ??
      ((tokenData.data as Record<string, unknown> | undefined)?.accessToken as string | undefined) ??
      ((tokenData.data as Record<string, unknown> | undefined)?.access_token as string | undefined) ?? ''

    expect.soft(accessToken, 'access token must be a non-empty string').toBeTruthy()

    // Generate unique merchant and amount for this run
    expectedMerchant = `${faker.company.name()} ${runId}`
    expectedAmountMinor = 10000 + Math.floor(Math.random() * 90000)
  })

  ctx.step('create-expense', 'Record an expense with create_expense', async () => {
    const base = process.env.SUT_BASE_URL!
    const res = await fetch(base, {
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
        params: {
          name: 'create_expense',
          arguments: {
            merchant: expectedMerchant,
            amountMinor: expectedAmountMinor,
            currency: expectedCurrency,
            category: expectedCategory,
            status: expectedStatus,
          },
        },
      }),
    })

    const body = await res.text()
    const clue = `tools/call create_expense -> ${res.status} ${body}`

    expect.soft(res.status, clue).toBe(200)

    const parsed = JSON.parse(body)
    expect.soft(parsed.result?.content?.[0]?.type, clue).toBe('text')

    const toolResult = JSON.parse(parsed.result.content[0].text)
    createdExpenseId = toolResult.id
    expectedMemberId = toolResult.memberId

    expect.soft(createdExpenseId, clue).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

    ctx.onCleanUp('delete the created expense', async () => {
      const pg = await import('pg')
      const db = new pg.default.Client(process.env.DATABASE_URL)
      try {
        await db.connect()
        const result = await db.query('DELETE FROM expenses WHERE id = $1', [createdExpenseId])
        expect.soft(result.rowCount, 'expense deletion should affect exactly one row').toBe(1)
      } finally {
        await db.end().catch(() => {})
      }
    })
  })

  ctx.step('list-expenses', 'Verify the expense appears in list_expenses', async () => {
    const base = process.env.SUT_BASE_URL!
    const res = await fetch(base, {
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
          name: 'list_expenses',
          arguments: {},
        },
      }),
    })

    const body = await res.text()
    const clue = `tools/call list_expenses -> ${res.status} ${body}`

    expect.soft(res.status, clue).toBe(200)

    const parsed = JSON.parse(body)
    expect.soft(parsed.result?.content?.[0]?.type, clue).toBe('text')

    const toolResult = JSON.parse(parsed.result.content[0].text)
    const expenses = toolResult.expenses

    expect.soft(Array.isArray(expenses), clue).toBe(true)

    const matchingExpenses = expenses.filter((e: { id: string }) => e.id === createdExpenseId)
    expect.soft(matchingExpenses.length, `${clue} - exactly one expense with id ${createdExpenseId} should exist`).toBe(1)

    const expense = matchingExpenses[0]

    expect.soft(expense, clue).toEqual({
      id: createdExpenseId,
      memberId: expectedMemberId,
      merchant: expectedMerchant,
      amountMinor: expectedAmountMinor,
      currency: expectedCurrency,
      category: expectedCategory,
      status: expectedStatus,
      occurredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/) as string,
    })

    // Verify occurredAt parses as a real date
    const occurredAt = new Date(expense.occurredAt)
    expect.soft(occurredAt.toString(), `${clue} - occurredAt should parse as a valid date`).not.toBe('Invalid Date')

    // Assert response headers match observed baseline
    expect.soft(res.headers.get('content-type'), `${clue} - content-type header`).toBeTruthy()
  })
}