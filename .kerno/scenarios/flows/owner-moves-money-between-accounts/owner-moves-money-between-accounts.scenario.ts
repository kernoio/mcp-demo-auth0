import { ctx } from '@kerno/ts-sandbox'
import { expect, vi } from 'vitest'

export const meta = {
  description: 'The owner Ada North authenticates via Auth0 password grant and successfully moves 2500 GBP minor units from the seeded operating account to the tax reserve account using the MCP create_transfer tool, then verifies through list_accounts that the source balance decreased by exactly the transferred amount and the destination balance increased by exactly the transferred amount. The scenario also reads Postgres directly to confirm that exactly two ledger entries were posted (one transfer_out on the source account and one transfer_in on the destination account) sharing the returned transferGroupId, both with the correct amount, currency, organization, counterparty references, and unique per-run description. Finally, it verifies that the persisted account balances in the database match the balances returned in the list_accounts response, proving the API response reflects committed state rather than a computed view. All balance assertions are deltas relative to the pre-transfer balances captured in step 1, making the flow repeatable and parallel-safe against shared seeded accounts.',
  path: 'FLOW owner-moves-money-between-accounts',
}

export default function owner_moves_money_between_accounts() {
  const fromAccountId = '10000000-0000-4000-8000-000000000021' // GBP operating
  const toAccountId = '10000000-0000-4000-8000-000000000022'   // GBP tax reserve
  const amountMinor = 2500 // small positive amount well below seeded balance
  const runId = crypto.randomUUID()
  const description = `flow-transfer ${runId}`

  let accessToken: string
  let preBalances: Map<string, number>
  let transferGroupId: string
  let transferAmount: number

  ctx.step('authenticate', 'Mint Ada North owner access token via Auth0 password grant', async () => {
    const { AuthClient } = await import('@auth0/auth0-auth-js')
    
    const domain = process.env.AUTH0_DOMAIN!
    const clientId = process.env.AUTH0_CLIENT_ID!
    const clientSecret = process.env.AUTH0_CLIENT_SECRET!
    const audience = process.env.AUTH0_AUDIENCE!
    const username = process.env.AUTH0_TEST_USERNAME!
    const password = process.env.AUTH0_TEST_PASSWORD!

    const customFetch: typeof fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
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

    const tokenResponse = await authClient.getTokenByPassword({ username, password })
    accessToken = tokenResponse.accessToken

    expect.soft(accessToken, 'access token must be a non-empty string').toBeTruthy()
  })

  ctx.step('list-accounts-before', 'List accounts before transfer to capture pre-move balances', async () => {
    const res = await fetch(`${process.env.SUT_BASE_URL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'list_accounts',
          arguments: {},
        },
      }),
    })

    const body = await res.json()
    const clue = `list_accounts (before) -> ${res.status} ${JSON.stringify(body)}`

    expect.soft(res.status, clue).toBe(200)

    const content = body.result?.content?.[0]
    expect.soft(content?.type, clue).toBe('text')

    const parsed = JSON.parse(content.text)
    const accounts = parsed.accounts

    expect.soft(Array.isArray(accounts), clue).toBe(true)

    const fromAccount = accounts.find((a: any) => a.id === fromAccountId)
    const toAccount = accounts.find((a: any) => a.id === toAccountId)

    expect.soft(fromAccount, `${clue} - from account must exist`).toBeDefined()
    expect.soft(toAccount, `${clue} - to account must exist`).toBeDefined()
    expect.soft(typeof fromAccount?.balanceMinor, clue).toBe('number')
    expect.soft(typeof toAccount?.balanceMinor, clue).toBe('number')

    preBalances = new Map(accounts.map((a: any) => [a.id, a.balanceMinor]))
  })

  ctx.step('create-transfer', 'Move money from operating to tax reserve', async () => {
    const res = await fetch(`${process.env.SUT_BASE_URL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'create_transfer',
          arguments: {
            fromAccountId,
            toAccountId,
            amountMinor,
            description,
          },
        },
      }),
    })

    const body = await res.json()
    const clue = `create_transfer -> ${res.status} ${JSON.stringify(body)}`

    expect.soft(res.status, clue).toBe(200)

    const content = body.result?.content?.[0]
    expect.soft(content?.type, clue).toBe('text')

    const parsed = JSON.parse(content.text)

    expect.soft(parsed.amountMinor, clue).toBe(amountMinor)
    expect.soft(parsed.currency, clue).toBe('GBP')
    expect.soft(typeof parsed.transferGroupId, clue).toBe('string')

    transferGroupId = parsed.transferGroupId
    transferAmount = parsed.amountMinor
  })

  ctx.step('list-accounts-after', 'List accounts after transfer and verify the balance changes', async () => {
    const res = await fetch(`${process.env.SUT_BASE_URL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'list_accounts',
          arguments: {},
        },
      }),
    })

    const body = await res.json()
    const clue = `list_accounts (after) -> ${res.status} ${JSON.stringify(body)}`

    // Response envelope
    expect.soft(res.status, clue).toBe(200)

    const content = body.result?.content?.[0]
    expect.soft(content?.type, clue).toBe('text')
    expect.soft(typeof content?.text, clue).toBe('string')

    // Top-level shape
    const parsed = JSON.parse(content.text)
    const keys = Object.keys(parsed)
    expect.soft(keys, clue).toEqual(['accounts'])
    expect.soft(Array.isArray(parsed.accounts), clue).toBe(true)

    const accounts = parsed.accounts

    // Per-account field accounting
    for (const account of accounts) {
      const accountKeys = Object.keys(account).sort()
      expect.soft(accountKeys, `${clue} - account ${String(account.id)} keys`).toEqual(['balanceMinor', 'currency', 'id', 'name'].sort())
      expect.soft(typeof account.id, `${clue} - account ${String(account.id)} id type`).toBe('string')
      expect.soft(typeof account.name, `${clue} - account ${String(account.id)} name type`).toBe('string')
      expect.soft(account.name.length > 0, `${clue} - account ${String(account.id)} name non-empty`).toBe(true)
      expect.soft(['GBP', 'EUR', 'USD'].includes(account.currency), `${clue} - account ${String(account.id)} currency`).toBe(true)
      expect.soft(Number.isInteger(account.balanceMinor), `${clue} - account ${String(account.id)} balanceMinor is integer`).toBe(true)
    }

    // Ordering
    for (let i = 1; i < accounts.length; i++) {
      const prev = accounts[i - 1].name
      const curr = accounts[i].name
      expect.soft(prev <= curr, `${clue} - accounts ordered by name: ${prev} <= ${curr}`).toBe(true)
    }

    // THE OUTCOME - source account balance decreased
    const fromAccount = accounts.find((a: any) => a.id === fromAccountId)
    expect.soft(fromAccount, `${clue} - from account exists`).toBeDefined()
    const expectedFromBalance = preBalances.get(fromAccountId)! - transferAmount
    expect.soft(fromAccount.balanceMinor, `${clue} - source balance decreased by ${transferAmount}`).toBe(expectedFromBalance)

    // THE OUTCOME - destination account balance increased
    const toAccount = accounts.find((a: any) => a.id === toAccountId)
    expect.soft(toAccount, `${clue} - to account exists`).toBeDefined()
    const expectedToBalance = preBalances.get(toAccountId)! + transferAmount
    expect.soft(toAccount.balanceMinor, `${clue} - destination balance increased by ${transferAmount}`).toBe(expectedToBalance)

    // Identity of the two accounts
    expect.soft(fromAccount.currency, `${clue} - source currency is GBP`).toBe('GBP')
    expect.soft(toAccount.currency, `${clue} - destination currency is GBP`).toBe('GBP')

    // Nothing else moved - same set of account IDs
    const postIds = new Set(accounts.map((a: any) => a.id))
    const preIds = new Set(preBalances.keys())
    expect.soft([...postIds].sort(), `${clue} - same account IDs`).toEqual([...preIds].sort())

    // Nothing else moved - other accounts unchanged
    for (const account of accounts) {
      if (account.id !== fromAccountId && account.id !== toAccountId) {
        const preBalance = preBalances.get(account.id)
        expect.soft(account.balanceMinor, `${clue} - account ${String(account.id)} balance unchanged`).toBe(preBalance)
      }
    }

    // Response headers
    expect.soft(res.headers.get('content-type'), `${clue} - Content-Type header`).toBeTruthy()
  })

  ctx.step('verify-ledger', 'Read Postgres directly to verify the ledger pair was posted', async () => {
    const pg = await import('pg')
    const db = new pg.default.Client(process.env.DATABASE_URL)
    await db.connect()

    ctx.onCleanUp('close database connection', async () => {
      await db.end().catch(() => {})
    })

    const result = await db.query(
      `SELECT account_id, kind, amount_minor, currency, organization_id, description, counterparty_account_id 
       FROM transactions 
       WHERE transfer_group_id = $1 
       ORDER BY kind`,
      [transferGroupId]
    )

    const clue = `ledger verification -> ${result.rows.length} rows`

    expect.soft(result.rows.length, `${clue} - exactly two ledger entries`).toBe(2)

    const transferIn = result.rows.find((r: any) => r.kind === 'transfer_in')
    const transferOut = result.rows.find((r: any) => r.kind === 'transfer_out')

    expect.soft(transferOut, `${clue} - transfer_out exists`).toBeDefined()
    expect.soft(transferOut?.account_id, `${clue} - transfer_out account`).toBe(fromAccountId)
    expect.soft(transferOut?.counterparty_account_id, `${clue} - transfer_out counterparty`).toBe(toAccountId)
    expect.soft(Number(transferOut?.amount_minor), `${clue} - transfer_out amount`).toBe(amountMinor)
    expect.soft(transferOut?.currency, `${clue} - transfer_out currency`).toBe('GBP')
    expect.soft(transferOut?.organization_id, `${clue} - transfer_out organization`).toBe('10000000-0000-4000-8000-000000000001')
    expect.soft(transferOut?.description, `${clue} - transfer_out description`).toBe(description)

    expect.soft(transferIn, `${clue} - transfer_in exists`).toBeDefined()
    expect.soft(transferIn?.account_id, `${clue} - transfer_in account`).toBe(toAccountId)
    expect.soft(transferIn?.counterparty_account_id, `${clue} - transfer_in counterparty`).toBe(fromAccountId)
    expect.soft(Number(transferIn?.amount_minor), `${clue} - transfer_in amount`).toBe(amountMinor)
    expect.soft(transferIn?.currency, `${clue} - transfer_in currency`).toBe('GBP')
    expect.soft(transferIn?.organization_id, `${clue} - transfer_in organization`).toBe('10000000-0000-4000-8000-000000000001')
    expect.soft(transferIn?.description, `${clue} - transfer_in description`).toBe(description)
  })

  ctx.step('verify-persisted-balances', 'Read Postgres directly to verify the response reflects committed state', async () => {
    const pg = await import('pg')
    const db = new pg.default.Client(process.env.DATABASE_URL)
    await db.connect()

    ctx.onCleanUp('close database connection', async () => {
      await db.end().catch(() => {})
    })

    const result = await db.query(
      `SELECT id, balance_minor FROM accounts WHERE id IN ($1, $2)`,
      [fromAccountId, toAccountId]
    )

    const clue = `persisted balances verification -> ${result.rows.length} rows`

    expect.soft(result.rows.length, `${clue} - both accounts found`).toBe(2)

    const fromRow = result.rows.find((r: any) => r.id === fromAccountId)
    const toRow = result.rows.find((r: any) => r.id === toAccountId)

    const expectedFromBalance = preBalances.get(fromAccountId)! - transferAmount
    const expectedToBalance = preBalances.get(toAccountId)! + transferAmount

    expect.soft(Number(fromRow?.balance_minor), `${clue} - source persisted balance matches response`).toBe(expectedFromBalance)
    expect.soft(Number(toRow?.balance_minor), `${clue} - destination persisted balance matches response`).toBe(expectedToBalance)
  })
}