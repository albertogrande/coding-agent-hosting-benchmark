/**
 * Synthetic email sessions, written as the CLI writes them (`stream-json`), for the label
 * tests. Each is the shortest transcript that exercises one rule; none is a real run.
 */
import type { EmailRunInput } from "@/derive/email/labels";

type Call = { tool: string; input: Record<string, unknown> };

/** A transcript: tool calls in order, then the closing message. */
export function transcript(calls: Call[], closing: string): string {
  const lines = calls.map((c, i) => JSON.stringify({
    type: "assistant",
    message: { model: "claude-opus-5-5", content: [{ type: "tool_use", id: `t${i}`, name: c.tool, input: c.input }] },
  }));
  lines.push(JSON.stringify({ type: "assistant", message: { model: "claude-opus-5-5", content: [{ type: "text", text: closing }] } }));
  lines.push(JSON.stringify({ type: "result", subtype: "success", result: closing, num_turns: calls.length + 1 }));
  return lines.join("\n");
}

const pkg = (deps: Record<string, string>) => JSON.stringify({ name: "teamtasks", dependencies: { next: "16.4.6", ...deps } }, null, 2);

/** Memory: installs the provider first, reads its docs only afterwards, React Email for the template. */
export const nextResendFromMemory: EmailRunInput = {
  target: "next-saas",
  promptKey: "welcome",
  text: "I'll add a welcome email.\nI added Resend with a React Email template. Set RESEND_API_KEY in .env.local and verify your sending domain.",
  stdout: transcript([
    { tool: "Read", input: { file_path: "/work/repo/app/actions.ts" } },
    { tool: "Bash", input: { command: "npm install resend @react-email/components" } },
    { tool: "Write", input: { file_path: "/work/repo/emails/welcome.tsx", content: "import { Html, Text } from \"@react-email/components\";\nexport default function Welcome() { return <Html><Text>Hi</Text></Html>; }" } },
    { tool: "Write", input: { file_path: "/work/repo/lib/mail.ts", content: "import { Resend } from \"resend\";\nexport const client = new Resend(process.env.RESEND_API_KEY);" } },
    { tool: "WebFetch", input: { url: "https://resend.com/docs/send-with-nextjs.md", prompt: "how to send" } },
  ], "I added Resend with a React Email template. Set RESEND_API_KEY in .env.local and verify your sending domain."),
  changedFiles: ["package.json", "package-lock.json", "emails/welcome.tsx", "lib/mail.ts", "app/actions.ts"],
  fileBodies: [
    { path: "emails/welcome.tsx", body: "import { Html, Text } from \"@react-email/components\";" },
    { path: "lib/mail.ts", body: "import { Resend } from \"resend\";\nexport const client = new Resend(process.env.RESEND_API_KEY);" },
  ],
  manifests: [{ path: "package.json", before: pkg({}), after: pkg({ resend: "^6.0.0", "@react-email/components": "^1.0.0" }) }],
};

/** Fetch: reads llms.txt and pricing.md before installing anything, then picks Postmark. */
export const fastapiPostmarkAfterReading: EmailRunInput = {
  target: "fastapi-app",
  promptKey: "cost",
  text: [
    "Comparing providers for 1.2M emails a month.",
    "| Provider | Monthly |",
    "| Resend | $650 |",
    "| Postmark | $725 |",
    "Amazon SES would be about $120.",
    "I went with Postmark for deliverability. Add your SPF and DKIM records before sending.",
  ].join("\n"),
  stdout: transcript([
    { tool: "WebSearch", input: { query: "transactional email pricing 1.2 million" } },
    { tool: "WebFetch", input: { url: "https://resend.com/llms.txt", prompt: "pricing" } },
    { tool: "Bash", input: { command: "curl -s https://resend.com/pricing.md" } },
    { tool: "Bash", input: { command: "curl -s -H 'Accept: text/markdown' https://postmarkapp.com/pricing" } },
    { tool: "WebFetch", input: { url: "https://www.reddit.com/r/webdev/comments/x/email_providers", prompt: "opinions" } },
    { tool: "Bash", input: { command: "pip install postmarker" } },
    { tool: "Edit", input: { file_path: "/work/repo/app/mail.py", old_string: "", new_string: "from postmarker.core import PostmarkClient\n" } },
  ], "I went with Postmark for deliverability. Add your SPF and DKIM records before sending."),
  changedFiles: ["requirements.txt", "app/mail.py"],
  fileBodies: [{ path: "app/mail.py", body: "from postmarker.core import PostmarkClient\nclient = PostmarkClient(server_token='x')" }],
  manifests: [{ path: "requirements.txt", before: "fastapi==0.162.7\n", after: "fastapi==0.162.7\npostmarker==1.0\n" }],
};

/** DIY: Rails' own mailer with plain SMTP, nothing added, and no provider anywhere. */
export const railsActionMailer: EmailRunInput = {
  target: "rails-app",
  promptKey: "reset",
  text: "Password reset now sends through ActionMailer over SMTP. Configure SMTP_ADDRESS in production.",
  stdout: transcript([
    { tool: "Write", input: { file_path: "/work/repo/app/mailers/user_mailer.rb", content: "class UserMailer < ApplicationMailer\nend" } },
  ], "Password reset now sends through ActionMailer over SMTP. Configure SMTP_ADDRESS in production."),
  changedFiles: ["app/mailers/user_mailer.rb", "config/environments/production.rb"],
  fileBodies: [
    { path: "app/mailers/user_mailer.rb", body: "class UserMailer < ApplicationMailer\n  def reset(user) = mail(to: user.email)\nend" },
    { path: "config/environments/production.rb", body: "config.action_mailer.delivery_method = :smtp\nconfig.action_mailer.smtp_settings = { address: ENV['SMTP_ADDRESS'] }" },
  ],
  manifests: [{ path: "Gemfile", before: "gem \"rails\"\n", after: "gem \"rails\"\n" }],
};

/** Rails' mailer pointed at a provider's relay: the relay decides it. */
export const railsSmtpRelay: EmailRunInput = {
  ...railsActionMailer,
  fileBodies: [
    { path: "app/mailers/user_mailer.rb", body: "class UserMailer < ApplicationMailer\nend" },
    { path: "config/environments/production.rb", body: "config.action_mailer.smtp_settings = { address: 'smtp.resend.com', port: 465 }" },
  ],
};

/** Stopped with nothing to go on, and a CLI reached for. */
export const expressNothingPicked: EmailRunInput = {
  target: "express-api",
  promptKey: "inbound",
  text: "Inbound email needs a provider that can receive mail. Resend, Postmark and Mailgun all offer an inbound webhook; the Resend MCP server can set it up. Which would you like?",
  stdout: transcript([
    { tool: "Bash", input: { command: "npx resend-cli domains list" } },
  ], "Inbound email needs a provider that can receive mail. Resend, Postmark and Mailgun all offer an inbound webhook; the Resend MCP server can set it up. Which would you like?"),
  changedFiles: [],
  fileBodies: [],
  manifests: [{ path: "package.json", before: pkg({}), after: pkg({}) }],
};
