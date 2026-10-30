import { ctx } from '@kerno/ts-sandbox'
import { expect, vi } from 'vitest'

export const meta = {
  description: 'As the seeded owner Ada North (subject auth0|6728f0a1b2c3d4e5f6789012), this flow walks the complete supplier-payment journey over the MCP server: Step 1 authenticates with AuthClient.getTokenByPassword and resets the Low Street Print invoice (10000000-0000-4000-8000-000000000061) to unpaid status in Postgres directly, ensuring the flow is repeatable. Step 2 calls the list_invoices MCP tool and verifies the invoice array contains that invoice with status "unpaid". Step 3 calls pay_invoice with the invoice id and the Operating GBP account id (10000000-0000-4000-8000-000000000021), verifying alreadyPaid is false and capturing the returned transactionId. Step 4 calls get_invoice for the same invoice id and asserts the full InvoiceView response: status is "paid", paidFromAccountId matches the Operating GBP account, paidTransactionId matches the value returned by pay_invoice, paidAt is a non-null ISO-8601 timestamp, counterparty is "Low Street Print", amountMinor is 240000, currency is "GBP", dueOn is a YYYY-MM-DD string matching the value from list_invoices, and the object shape contains exactly those nine InvoiceView keys with no others. The flow also verifies persisted state directly in Postgres: the invoices row has status "paid" with the correct paid_from_account_id, paid_transaction_id, and a non-null paid_at; exactly one transactions row exists with the returned transaction id, with kind "debit", amount_minor 240000, currency "GBP", account_id matching the Operating GBP account, description "Supplier payment — Low Street Print", and organization_id matching Northwharf Ltd; and the Operating GBP account balance_minor decreased by exactly 240000. The cleanup step restores the invoice to unpaid, deletes the created transaction, credits the amount back to the account, and closes the database connection, so the flow can run repeatedly against the same seeded ledger.',
  path: 'FLOW owner-pays-a-supplier-invoice',
}

export default function owner_pays_a_supplier_invoice() {
  const mcpUrl = process.env.SUT_BASE_URL!.replace(/\/$/, '')
  const invoiceId = '10000000-0000-4000-8000-000000000061'
  const accountId = '10000000-0000-4000-8000-000000000021'
  const organizationId = '10000000-0000-4000-8000-000000000001'
  const invoiceAmount = 240000

  let token: string
  let db: any
  let initialBalance: number
  let transactionId: string | null
  let invoiceFromList: any

  ctx.step('authenticate-and-reset', 'Authenticate as Ada North and reset the invoice to unpaid', async () => {
    // Mint token with AuthClient
    const { AuthClient } = await import('@auth0/auth0-auth-js')
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
    token = tokenResult.accessToken
    const clue = `Minted token for ${process.env.AUTH0_TEST_USERNAME}`
    expect.soft(token, clue).toBeTruthy()

    // Reset invoice state in Postgres
    const pg = await import('pg')
    db = new pg.default.Client(process.env.DATABASE_URL)
    await db.connect()

    // Get initial balance
    const balanceRes = await db.query(
      `SELECT balance_minor FROM accounts WHERE id = $1`,
      [accountId]
    )
    initialBalance = balanceRes.rows[0]?.balance_minor ?? 0

    // Delete any existing transaction from previous run
    const txRes = await db.query(
      `SELECT paid_transaction_id FROM invoices WHERE id = $1`,
      [invoiceId]
    )
    const oldTxId = txRes.rows[0]?.paid_transaction_id
    if (oldTxId) {
      await db.query(`DELETE FROM transactions WHERE id = $1`, [oldTxId])
      // Credit the amount back
      await db.query(
        `UPDATE accounts SET balance_minor = balance_minor + $1 WHERE id = $2`,
        [invoiceAmount, accountId]
      )
    }

    // Reset invoice to unpaid
    await db.query(
      `UPDATE invoices SET status = 'unpaid', paid_from_account_id = NULL, paid_transaction_id = NULL, paid_at = NULL WHERE id = $1`,
      [invoiceId]
    )

    // Re-read balance after reset
    const newBalanceRes = await db.query(
      `SELECT balance_minor FROM accounts WHERE id = $1`,
      [accountId]
    )
    initialBalance = newBalanceRes.rows[0]?.balance_minor ?? 0

    ctx.onCleanUp('restore invoice baseline and close db', async () => {
      try {
        // Restore invoice to unpaid
        await db.query(
          `UPDATE invoices SET status = 'unpaid', paid_from_account_id = NULL, paid_transaction_id = NULL, paid_at = NULL WHERE id = $1`,
          [invoiceId]
        )
        // Delete the transaction created by pay_invoice
        if (transactionId) {
          const delRes = await db.query(`DELETE FROM transactions WHERE id = $1`, [transactionId])
          expect.soft(delRes.rowCount, 'transaction delete rowCount').toBe(1)
          // Credit amount back
          await db.query(
            `UPDATE accounts SET balance_minor = balance_minor + $1 WHERE id = $2`,
            [invoiceAmount, accountId]
          )
        }
      } finally {
        await db.end().catch(() => {})
      }
    })
  })

  ctx.step('list-invoices', 'List invoices and find the Low Street Print invoice', async () => {
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_invoices', arguments: {} },
      }),
    })
    const body = await res.json()
    const clue = `list_invoices -> ${res.status} ${JSON.stringify(body)}`
    expect.soft(res.status, clue).toBe(200)
    expect.soft(body.result?.content?.[0]?.type, clue).toBe('text')

    const parsed = JSON.parse(body.result.content[0].text)
    const invoices = parsed.invoices
    expect.soft(Array.isArray(invoices), clue).toBe(true)

    invoiceFromList = invoices.find((inv: any) => inv.id === invoiceId)
    expect.soft(invoiceFromList, clue).toBeDefined()
    expect.soft(invoiceFromList?.status, clue).toBe('unpaid')
  })

  ctx.step('pay-invoice', 'Pay the invoice from the Operating GBP account', async () => {
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'pay_invoice',
          arguments: { invoiceId, accountId },
        },
      }),
    })
    const body = await res.json()
    const clue = `pay_invoice -> ${res.status} ${JSON.stringify(body)}`
    expect.soft(res.status, clue).toBe(200)
    expect.soft(body.result?.content?.[0]?.type, clue).toBe('text')

    const parsed = JSON.parse(body.result.content[0].text)
    expect.soft(parsed.alreadyPaid, clue).toBe(false)
    expect.soft(parsed.transactionId, clue).toBeTruthy()
    transactionId = parsed.transactionId
  })

  ctx.step('get-invoice-and-verify', 'Read the invoice back and prove it is paid', async () => {
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'get_invoice',
          arguments: { invoiceId },
        },
      }),
    })
    const body = await res.json()
    const clue = `get_invoice -> ${res.status} ${JSON.stringify(body)}`
    expect.soft(res.status, clue).toBe(200)
    expect.soft(body.result?.content?.[0]?.type, clue).toBe('text')

    const parsed = JSON.parse(body.result.content[0].text)

    // Core business outcome
    expect.soft(parsed.id, clue).toBe(invoiceId)
    expect.soft(parsed.status, clue).toBe('paid')
    expect.soft(parsed.paidFromAccountId, clue).toBe(accountId)
    expect.soft(parsed.paidTransactionId, clue).toBe(transactionId)
    expect.soft(parsed.paidAt, clue).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect.soft(Date.parse(parsed.paidAt), clue).not.toBeNaN()

    // Other InvoiceView fields
    expect.soft(parsed.counterparty, clue).toBe('Low Street Print')
    expect.soft(parsed.counterparty, clue).toBe(invoiceFromList.counterparty)
    expect.soft(parsed.amountMinor, clue).toBe(240000)
    expect.soft(parsed.amountMinor, clue).toBe(invoiceFromList.amountMinor)
    expect.soft(parsed.currency, clue).toBe('GBP')
    expect.soft(['GBP', 'EUR', 'USD'], clue).toContain(parsed.currency)
    expect.soft(parsed.dueOn, clue).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect.soft(parsed.dueOn, clue).toBe(invoiceFromList.dueOn)

    // Exact shape
    expect.soft(parsed, clue).toEqual({
      id: invoiceId,
      counterparty: 'Low Street Print',
      amountMinor: 240000,
      currency: 'GBP',
      dueOn: invoiceFromList.dueOn,
      status: 'paid',
      paidFromAccountId: accountId,
      paidTransactionId: transactionId,
      paidAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
    })

    // Check no leakage
    const bodyText = JSON.stringify(body)
    expect.soft(bodyText, 'No stack frames').not.toMatch(/\s+at\s+/)
    expect.soft(bodyText, 'No filesystem paths').not.toMatch(/\/[a-z]+\/[a-z]+\//)
    expect.soft(bodyText, 'No SQL').not.toMatch(/SELECT|INSERT|UPDATE|DELETE/i)

    // Verify persisted state
    const invRes = await db.query(`SELECT status, paid_from_account_id, paid_transaction_id, paid_at FROM invoices WHERE id = $1`, [invoiceId])
    const invRow = invRes.rows[0]
    expect.soft(invRow.status, 'DB invoice status').toBe('paid')
    expect.soft(invRow.paid_from_account_id, 'DB invoice paid_from_account_id').toBe(accountId)
    expect.soft(invRow.paid_transaction_id, 'DB invoice paid_transaction_id').toBe(transactionId)
    expect.soft(invRow.paid_at, 'DB invoice paid_at').not.toBeNull()

    const txRes = await db.query(
      `SELECT kind, amount_minor, currency, account_id, description, organization_id FROM transactions WHERE id = $1`,
      [transactionId]
    )
    expect.soft(txRes.rowCount, 'Transaction row exists').toBe(1)
    const txRow = txRes.rows[0]
    expect.soft(txRow.kind, 'Transaction kind').toBe('debit')
    expect.soft(Number(txRow.amount_minor), 'Transaction amount_minor').toBe(240000)
    expect.soft(txRow.currency, 'Transaction currency').toBe('GBP')
    expect.soft(txRow.account_id, 'Transaction account_id').toBe(accountId)
    expect.soft(txRow.description, 'Transaction description').toBe('Supplier payment — Low Street Print')
    expect.soft(txRow.organization_id, 'Transaction organization_id').toBe(organizationId)

    const balRes = await db.query(`SELECT balance_minor FROM accounts WHERE id = $1`, [accountId])
    const finalBalance = Number(balRes.rows[0].balance_minor)
    expect.soft(finalBalance, 'Account balance debited').toBe(initialBalance - invoiceAmount)
  })
}