import type { AppConfig } from "../config.js";
import { accessPermissions } from "./permissions.js";

export async function ensureAuthDirectory(config: AppConfig): Promise<void> {
  await postJson(new URL("/permissions", config.authBaseUrl), {
    audience: config.authAudience,
    permissions: accessPermissions,
  });
  await postJson(new URL("/oauth/token/user_info", config.authBaseUrl), {
    subject: config.ownerSubject,
    name: "Ada North",
    given_name: "Ada",
    family_name: "North",
    nickname: "ada",
    email: "ada.north@northwharf.example",
    email_verified: true,
  });
}

async function postJson(url: URL, body: unknown): Promise<void> {
  let last = "no attempt";
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        return;
      }
      last = `${response.status} ${await response.text()}`;
    } catch (error) {
      last = error instanceof Error ? error.message : "request failed";
    }
    await delay(300 * attempt);
  }
  throw new Error(`Auth directory request failed for ${url.pathname}: ${last}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
