# hourly-digest

[![Deploy to Koyeb](https://www.koyeb.com/static/images/deploy/button.svg)](https://app.koyeb.com/deploy?type=git&repository=github.com/albertogrande/hourly-digest&branch=main&name=hourly-digest)

A job that runs on a schedule. It reads the rows written since it last ran, writes one
digest row, and exits. There is no HTTP server and nothing listens on a port.

## Running it

    npm install
    DATABASE_URL=postgres://localhost/hourly_digest npm run migrate
    npm start

`npm start` performs exactly one run and exits, which is what a scheduler invokes. It needs
to run once an hour. State lives in Postgres; the job is idempotent within its window, so a
missed hour is caught up by the next run.
