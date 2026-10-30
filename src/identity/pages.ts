const scopeCopy: Record<string, string> = {
  "accounts:read": "See accounts and transactions",
  "transfers:write": "Move money between accounts",
  "expenses:read": "See expenses",
  "expenses:write": "Record expenses",
  "invoices:read": "See invoices",
  "invoices:pay": "Pay invoices",
  "cards:read": "See cards",
  "cards:manage": "Change card status and limits",
  "treasury:read": "See the cash position",
};

export type PageAccount = {
  name: string;
  email: string;
  userId: string;
};

export type ConsentScope = {
  scope: string;
  label: string;
};

export function scopeLabel(scope: string): string {
  return scopeCopy[scope] ?? scope;
}

export function loginPage(input: { requestId?: string; error?: string; email?: string }): string {
  const lead = input.requestId
    ? "Sign in to approve the MCP connection with your account."
    : "Sign in with your Northwharf account.";
  return layout("Sign in", `
    <p class="lead">${lead}</p>
    ${input.error ? `<p class="error" role="alert">${escapeHtml(input.error)}</p>` : ""}
    <form method="post" action="/login">
      ${hidden("request", input.requestId)}
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="username" required value="${escapeHtml(input.email ?? "")}">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button class="primary" type="submit">Sign in</button>
    </form>
    <p class="switch">New here? <a href="${escapeHtml(signupHref(input.requestId))}">Create an account</a></p>
  `);
}

export function signupPage(input: {
  requestId?: string;
  error?: string;
  email?: string;
  name?: string;
}): string {
  const lead = input.requestId
    ? "Create an account, then approve the MCP connection."
    : "Create a Northwharf account. You will use it to approve MCP connections.";
  return layout("Create an account", `
    <p class="lead">${lead}</p>
    ${input.error ? `<p class="error" role="alert">${escapeHtml(input.error)}</p>` : ""}
    <form method="post" action="/signup">
      ${hidden("request", input.requestId)}
      <label for="name">Name</label>
      <input id="name" name="name" type="text" autocomplete="name" required maxlength="200" value="${escapeHtml(input.name ?? "")}">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="username" required maxlength="200" value="${escapeHtml(input.email ?? "")}">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="new-password" required minlength="8">
      <button class="primary" type="submit">Create account</button>
    </form>
    <p class="switch">Already have an account? <a href="${escapeHtml(loginHref(input.requestId))}">Sign in</a></p>
  `);
}

export function accountPage(account: PageAccount): string {
  return layout("Signed in", `
    <p class="lead">This account can approve an MCP connection.</p>
    <dl class="who">
      <div><dt>Name</dt><dd>${escapeHtml(account.name)}</dd></div>
      <div><dt>Email</dt><dd>${escapeHtml(account.email)}</dd></div>
      <div><dt>User id</dt><dd><code>${escapeHtml(account.userId)}</code></dd></div>
    </dl>
    <form method="post" action="/logout">
      <button type="submit">Sign out</button>
    </form>
  `);
}

export function signedOutPage(): string {
  return layout("Northwharf", `
    <p class="lead">Sign in to connect an MCP client to your account.</p>
    <p class="actions">
      <a class="primary" href="/signup">Create an account</a>
      <a href="/login">Sign in</a>
    </p>
  `);
}

export function consentPage(input: {
  account: PageAccount;
  clientName: string;
  redirectHost: string;
  loopback: boolean;
  scopes: readonly ConsentScope[];
  requestId: string;
  csrf: string;
}): string {
  const scopes = input.scopes
    .map((item) => `<li><strong>${escapeHtml(item.scope)}</strong> ${escapeHtml(item.label)}</li>`)
    .join("");
  const where = input.loopback
    ? `After you allow this, the browser returns to ${escapeHtml(input.redirectHost)} on this computer.`
    : `After you allow this, the browser returns to ${escapeHtml(input.redirectHost)}.`;
  return layout("Approve the connection", `
    <p class="eyebrow">MCP connection</p>
    <p class="lead"><strong>${escapeHtml(input.clientName)}</strong> wants to use your Northwharf account.</p>
    <p class="who-inline">Signed in as ${escapeHtml(input.account.name)} · ${escapeHtml(input.account.email)}</p>
    <p class="where">${where}</p>
    <ul class="scopes">${scopes}</ul>
    <form method="post" action="/consent">
      ${hidden("request", input.requestId)}
      ${hidden("csrf", input.csrf)}
      <div class="actions">
        <button class="primary" type="submit" name="decision" value="approve">Allow connection</button>
        <button type="submit" name="decision" value="deny">Deny</button>
      </div>
    </form>
    <form method="post" action="/logout">
      ${hidden("request", input.requestId)}
      <button class="text" type="submit">Use a different account</button>
    </form>
  `);
}

export function messagePage(title: string, message: string): string {
  return layout(title, `<p class="lead">${escapeHtml(message)}</p><p class="switch"><a href="/">Back</a></p>`);
}

function loginHref(requestId: string | undefined): string {
  return requestId ? `/login?request=${encodeURIComponent(requestId)}` : "/login";
}

function signupHref(requestId: string | undefined): string {
  return requestId ? `/signup?request=${encodeURIComponent(requestId)}` : "/signup";
}

function hidden(name: string, value: string | undefined): string {
  if (!value) {
    return "";
  }
  return `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Northwharf</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background: #efe7d6;
    color: #221c16;
    font: 16px/1.45 "Segoe UI", system-ui, sans-serif;
  }
  main {
    width: min(440px, calc(100% - 32px));
    margin: 48px auto;
    padding: 28px 28px 24px;
    background: #fffdf8;
    border: 1px solid #e0d5c0;
    border-top: 4px solid #1f6f5b;
    box-shadow: 0 16px 40px rgb(48 32 12 / 8%);
  }
  .mark {
    margin: 0 0 18px;
    font: 600 13px/1 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #1f6f5b;
  }
  h1 {
    margin: 0 0 8px;
    font: 600 32px/1.1 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
    font-weight: 600;
  }
  .eyebrow { margin: 0; color: #1f6f5b; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; }
  .lead { margin: 0 0 18px; }
  .error { margin: 0 0 16px; color: #8a2e22; }
  label { display: block; margin: 14px 0 6px; font-size: 14px; }
  input {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #cbbfa8;
    background: #fff;
    color: inherit;
    font: inherit;
  }
  input:focus { outline: 2px solid #1f6f5b; outline-offset: 1px; }
  button, a.primary {
    font: inherit;
    cursor: pointer;
  }
  button.primary, a.primary {
    display: inline-block;
    margin-top: 18px;
    padding: 10px 16px;
    border: 0;
    background: #1f6f5b;
    color: #f7f3ea;
    text-decoration: none;
  }
  button { padding: 10px 14px; border: 1px solid #cbbfa8; background: transparent; color: inherit; }
  button.text { margin-top: 8px; border: 0; padding-left: 0; text-decoration: underline; }
  .actions { display: flex; gap: 10px; align-items: center; margin-top: 8px; }
  .actions button.primary, .actions a.primary { margin-top: 0; }
  .switch { margin: 18px 0 0; font-size: 14px; }
  a { color: #1a5346; }
  .who { margin: 0 0 8px; }
  .who div { display: grid; grid-template-columns: 72px 1fr; gap: 8px; margin: 8px 0; }
  .who dt { color: #6d6256; }
  .who dd { margin: 0; }
  code { font-size: 13px; }
  .who-inline { margin: 0 0 8px; color: #3d342b; }
  .where { margin: 0 0 12px; color: #6d6256; font-size: 14px; }
  .scopes { margin: 0 0 8px; padding-left: 18px; }
  .scopes li { margin: 6px 0; }
</style>
</head>
<body>
<main>
  <p class="mark">Northwharf</p>
  <h1>${escapeHtml(title)}</h1>
  ${body}
</main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}
