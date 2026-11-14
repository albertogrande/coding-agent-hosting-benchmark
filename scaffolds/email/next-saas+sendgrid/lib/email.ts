import sgMail from "@sendgrid/mail";

const apiKey = process.env.SENDGRID_API_KEY;
if (apiKey) sgMail.setApiKey(apiKey);

export type Email = { to: string; subject: string; text: string; html?: string };

/** Sends one email through SendGrid. Without an API key it logs the email instead. */
export async function sendEmail(email: Email): Promise<void> {
  const from = process.env.EMAIL_FROM ?? "Team Tasks <hello@example.com>";
  if (!apiKey) {
    console.warn(`SENDGRID_API_KEY is not set; not sending "${email.subject}" to ${email.to}`);
    return;
  }
  await sgMail.send({ from, ...email });
}
