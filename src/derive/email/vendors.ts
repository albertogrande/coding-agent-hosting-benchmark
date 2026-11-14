/**
 * The email project's vocabulary: which strings name a provider, which packages and modules
 * belong to one, which domains it owns, and which SMTP hosts point at it.
 *
 * The name patterns and the owned-domain map are the ones the chat probes were labelled with
 * (`research/resend-aeo/probes/grade.mjs` in the publication's repository), so a session and a
 * chat answer that name the same provider are read the same way. A provider is a lowercase id
 * (`resend`, `sendgrid`, `ses`); `diy` is not a provider but the answer that runs its own SMTP or
 * uses the framework's mailer with no provider behind it.
 *
 * These are recognisers, not a roster. A package or a name outside them leaves `picked` empty
 * and sends the run to review, where the vocabulary grows out of the answers.
 */
import type { Alias } from "@/db/schema";

/** Names a message might use, as in the probes' grader. */
export const VENDOR_PATTERNS: Record<string, RegExp> = {
  resend: /\bresend\b(?!\s+(the|it|that|this|a|an|your|my|verification|confirmation|link|button|code|email|invite|invitation))/i,
  "react-email": /\breact[- ]email\b|@react-email/i,
  sendgrid: /\bsend ?grid\b/i,
  postmark: /\bpostmark\b/i,
  mailgun: /\bmailgun\b/i,
  ses: /\b(amazon|aws)\s+ses\b|\bses\b(?=\s*(\(|v2|,|\.|is|for|if|at|when|\u2014|-))|simple email service/i,
  mailchimp: /\bmailchimp\b|\bmandrill\b/i,
  brevo: /\bbrevo\b|\bsendinblue\b/i,
  mailersend: /\bmailersend\b/i,
  mailjet: /\bmailjet\b/i,
  sparkpost: /\bsparkpost\b|\bbird\b(?=.*email)/i,
  loops: /\bloops(\.so)?\b/i,
  plunk: /\bplunk\b|useplunk/i,
  "customer-io": /customer\.io/i,
  convertkit: /\bconvertkit\b|\bkit\.com\b/i,
  beehiiv: /\bbeehiiv\b/i,
  buttondown: /\bbuttondown\b/i,
  cloudflare: /cloudflare email|email routing|email workers|send_email binding/i,
  agentmail: /\bagentmail\b/i,
  nylas: /\bnylas\b/i,
  mailtrap: /\bmailtrap\b/i,
  zeptomail: /\bzeptomail\b|zoho/i,
  smtp2go: /\bsmtp2go\b/i,
  scaleway: /\bscaleway\b/i,
  "azure-acs": /azure communication services/i,
  firebase: /trigger email|firebase extension/i,
  nodemailer: /\bnodemailer\b/i,
  gmail: /\bgmail\b|google workspace smtp/i,
  diy: /self[- ]host(ed)? (smtp|mail)|your own (smtp|mail) server|\bpostfix\b|\bpostal\b|\bharaka\b/i,
};

/** Patterns that name a library or an approach rather than a provider someone could pick. */
const NOT_PROVIDERS = new Set(["react-email", "nodemailer", "diy"]);

/** Every provider id, in the order the patterns declare them. */
export const PROVIDERS = Object.keys(VENDOR_PATTERNS).filter((v) => !NOT_PROVIDERS.has(v));

/** The domains each provider owns, as in the probes' grader. */
export const OWNED: Record<string, string[]> = {
  resend: ["resend.com", "react.email"],
  sendgrid: ["sendgrid.com", "twilio.com"],
  postmark: ["postmarkapp.com"],
  mailgun: ["mailgun.com"],
  ses: ["aws.amazon.com", "docs.aws.amazon.com"],
  mailersend: ["mailersend.com"],
  brevo: ["brevo.com"],
  loops: ["loops.so"],
  plunk: ["useplunk.com"],
  mailtrap: ["mailtrap.io"],
  cloudflare: ["cloudflare.com", "developers.cloudflare.com"],
};

export const COMMUNITY = [
  "reddit.com", "news.ycombinator.com", "stackoverflow.com", "dev.to", "medium.com", "github.com",
  "youtube.com", "x.com", "twitter.com", "indiehackers.com", "hashnode.dev",
];

export type DomainClass = `owned:${string}` | "community" | "third-party" | "unknown";

export function hostOf(url: string): string | null {
  try { return new URL(url).host.replace(/^www\./, "").toLowerCase(); } catch { return null; }
}

/** owned:<provider>, community or third-party, exactly as the probes classify a page. */
export function domainClass(host: string | null): DomainClass {
  if (!host) return "unknown";
  const h = host.toLowerCase().replace(/^www\./, "");
  for (const [v, ds] of Object.entries(OWNED)) if (ds.some((d) => h === d || h.endsWith(`.${d}`))) return `owned:${v}`;
  if (COMMUNITY.some((d) => h === d || h.endsWith(`.${d}`))) return "community";
  return "third-party";
}

/**
 * Packages, by name, in any of the three ecosystems the scaffolds use. `diy` marks a library
 * that sends over SMTP with nobody behind it until a host is configured. A package that only
 * renders templates is not here: React Email is read by `templates`, never as a pick.
 */
export const PACKAGES: Record<string, string> = {
  // npm
  "resend": "resend",
  "@sendgrid/mail": "sendgrid", "@sendgrid/client": "sendgrid", "sendgrid": "sendgrid",
  "postmark": "postmark",
  "mailgun.js": "mailgun", "mailgun-js": "mailgun",
  "@aws-sdk/client-ses": "ses", "@aws-sdk/client-sesv2": "ses",
  "@getbrevo/brevo": "brevo", "sib-api-v3-sdk": "brevo", "@sendinblue/client": "brevo",
  "node-mailjet": "mailjet",
  "sparkpost": "sparkpost",
  "mailersend": "mailersend",
  "loops": "loops",
  "@plunk/node": "plunk",
  "mailtrap": "mailtrap",
  "@mailchimp/mailchimp_transactional": "mailchimp",
  "@azure/communication-email": "azure-acs",
  "zeptomail": "zeptomail",
  "nodemailer": "diy",
  // PyPI
  "postmarker": "postmark",
  "brevo-python": "brevo",
  "mailjet-rest": "mailjet",
  "fastapi-mail": "diy", "aiosmtplib": "diy", "yagmail": "gmail",
  // RubyGems
  "sendgrid-ruby": "sendgrid", "sendgrid-actionmailer": "sendgrid",
  "postmark-rails": "postmark",
  "mailgun-ruby": "mailgun",
  "aws-sdk-ses": "ses", "aws-sdk-sesv2": "ses", "aws-actionmailer-ses": "ses",
  "mailjet": "mailjet",
  "mailersend-ruby": "mailersend",
  "loops_sdk": "loops",
};

/** Generic cloud SDKs that are a provider only when the code asks them for email. */
export const GENERIC_SDKS: Record<string, { vendor: string; when: RegExp }> = {
  "boto3": { vendor: "ses", when: /\bclient\(\s*["']sesv?2?["']|\bses(v2)?_client\b|\.send_email\(|\.send_raw_email\(/ },
  "aws-sdk": { vendor: "ses", when: /\bnew\s+(AWS\.)?SES(V2)?\b|\.sendEmail\(/ },
};

/** Python modules, by their import name, when it differs from the package. */
export const PY_MODULES: Record<string, string> = {
  resend: "resend", sendgrid: "sendgrid", postmarker: "postmark", postmark: "postmark",
  mailjet_rest: "mailjet", sib_api_v3_sdk: "brevo", brevo_python: "brevo", sparkpost: "sparkpost",
  mailersend: "mailersend", mailtrap: "mailtrap", fastapi_mail: "diy", aiosmtplib: "diy", smtplib: "diy",
  yagmail: "gmail",
};

/** What a Ruby file says when it uses a provider. ActionMailer alone is the framework's mailer. */
export const RUBY_SIGNS: [RegExp, string][] = [
  [/\bResend(\.api_key|::)|require\s+["']resend["']|delivery_method\s*=\s*:resend\b/, "resend"],
  [/\bSendGrid::|require\s+["']sendgrid-ruby["']|delivery_method\s*=\s*:sendgrid/, "sendgrid"],
  [/\bPostmark::|delivery_method\s*=\s*:postmark\b/, "postmark"],
  [/\bMailgun::|delivery_method\s*=\s*:mailgun\b/, "mailgun"],
  [/Aws::SES(V2)?::|delivery_method\s*=\s*:ses(_v2)?\b/, "ses"],
  [/\bMailjet\.|delivery_method\s*=\s*:mailjet\b/, "mailjet"],
  [/\bclass\s+\w+\s*<\s*(ApplicationMailer|ActionMailer::Base)\b|delivery_method\s*=\s*:smtp\b|ActionMailbox/, "diy"],
];

/** SMTP relays, by host. A framework mailer pointed at one of these is that provider. */
export const SMTP_HOSTS: [RegExp, string][] = [
  [/\bsmtp\.resend\.com\b/i, "resend"],
  [/\bsmtp\.sendgrid\.net\b/i, "sendgrid"],
  [/\bsmtp(-broadcasts)?\.postmarkapp\.com\b/i, "postmark"],
  [/\bsmtp(\.eu)?\.mailgun\.org\b/i, "mailgun"],
  [/\bemail-smtp\.[a-z0-9-]+\.amazonaws\.com\b/i, "ses"],
  [/\bsmtp-relay\.(brevo|sendinblue)\.com\b/i, "brevo"],
  [/\bin-v3\.mailjet\.com\b/i, "mailjet"],
  [/\bsmtp\.sparkpostmail\.com\b/i, "sparkpost"],
  [/\bsmtp\.mailersend\.net\b/i, "mailersend"],
  [/\b(live\.)?smtp\.mailtrap\.io\b/i, "mailtrap"],
  [/\bsmtp\.zeptomail\.com\b/i, "zeptomail"],
  [/\bsmtp\.mandrillapp\.com\b/i, "mailchimp"],
  [/\bsmtp\.gmail\.com\b/i, "gmail"],
];

/** Cloudflare's own way to send: a `send_email` binding or the Workers email module. */
export const CLOUDFLARE_SIGNS = /["']cloudflare:email["']|"send_email"\s*:|\[\[send_email\]\]|\bsend_email\s*=/;

/** The packages that are React Email. */
export const REACT_EMAIL = /^(react-email|@react-email\/[\w.-]+)$/;

/**
 * The provider list the store's project carries, so the preflight's ownership and branding
 * checks run against it. `aliases` are written to match the brief check in
 * `src/derive/benchmark.ts`, which is a plain word match: they are the vendors' names, not the
 * patterns above.
 */
export const EMAIL_CATALOGUE: Alias[] = [
  { name: "resend", aliases: ["Resend"], domains: OWNED.resend },
  { name: "sendgrid", aliases: ["SendGrid", "Twilio SendGrid"], domains: OWNED.sendgrid },
  { name: "postmark", aliases: ["Postmark"], domains: OWNED.postmark },
  { name: "mailgun", aliases: ["Mailgun"], domains: OWNED.mailgun },
  { name: "ses", aliases: ["Amazon SES", "AWS SES", "SES"], domains: OWNED.ses },
  { name: "mailersend", aliases: ["MailerSend"], domains: OWNED.mailersend },
  { name: "brevo", aliases: ["Brevo", "Sendinblue"], domains: OWNED.brevo },
  { name: "loops", aliases: ["Loops"], domains: OWNED.loops },
  { name: "plunk", aliases: ["Plunk"], domains: OWNED.plunk },
  { name: "mailtrap", aliases: ["Mailtrap"], domains: OWNED.mailtrap },
  { name: "cloudflare", aliases: ["Cloudflare Email", "Email Workers"], domains: OWNED.cloudflare },
  { name: "mailjet", aliases: ["Mailjet"], domains: ["mailjet.com"] },
  { name: "sparkpost", aliases: ["SparkPost"], domains: ["sparkpost.com"] },
  { name: "mailchimp", aliases: ["Mailchimp", "Mandrill"], domains: ["mailchimp.com", "mandrillapp.com"] },
];
