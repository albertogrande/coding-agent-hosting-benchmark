// The bindings this worker declares in wrangler.jsonc. `npx wrangler types --env-interface
// CloudflareEnv` regenerates a full version of this file.

interface SendEmail {
  send(message: unknown): Promise<void>;
}

interface CloudflareEnv {
  EMAIL: SendEmail;
  EMAIL_FROM: string;
}

declare module "cloudflare:email" {
  export class EmailMessage {
    constructor(from: string, to: string, raw: string);
    readonly from: string;
    readonly to: string;
  }
}
