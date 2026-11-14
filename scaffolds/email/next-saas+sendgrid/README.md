# Team Tasks

A small task tracker for teams: people sign up, create tasks, comment on each other's tasks and
upgrade to a paid plan from the billing page.

```sh
npm install
cp .env.example .env.local      # then set SENDGRID_API_KEY and EMAIL_FROM
npm run dev        # http://localhost:3000
```

Email goes out through SendGrid (`lib/email.ts`). Without `SENDGRID_API_KEY` the app logs each
email instead of sending it.

Data is kept in `data/db.json`, created on first write. `npm run typecheck` checks the types and
`npm run build` makes a production build.

## Layout

- `app/` - pages and server actions (`app/actions.ts`)
- `lib/db.ts` - the JSON file store: users, tasks, comments, orders
- `lib/auth.ts` - password hashing and the signed session cookie
- `lib/email.ts` - `sendEmail()`, through SendGrid; signup sends a welcome email with it
