import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createMimeMessage } from "mimetext";

export type Email = { to: string; subject: string; text: string };

/**
 * Sends one email through the worker's `send_email` binding (`EMAIL` in wrangler.jsonc).
 * Outside the worker runtime there is no binding, so the email is logged instead.
 */
export async function sendEmail(email: Email): Promise<void> {
  let env: CloudflareEnv;
  try {
    env = (await getCloudflareContext({ async: true })).env;
  } catch {
    console.warn(`no Cloudflare context; not sending "${email.subject}" to ${email.to}`);
    return;
  }
  const from = env.EMAIL_FROM;
  const msg = createMimeMessage();
  msg.setSender({ name: "Team Tasks", addr: from });
  msg.setRecipient(email.to);
  msg.setSubject(email.subject);
  msg.addMessage({ contentType: "text/plain", data: email.text });
  const { EmailMessage } = await import(/* webpackIgnore: true */ "cloudflare:email");
  await env.EMAIL.send(new EmailMessage(from, email.to, msg.asRaw()));
}
