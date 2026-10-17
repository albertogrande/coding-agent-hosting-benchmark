#!/bin/bash
# Shallow-clone each candidate and read off what the benchmark needs to know before it can
# be a target: pinned SHA, size, licence, any platform config already in the tree, and any
# platform named in README/docs. Output: one JSON line per repo.
CANDIDATES="
express-postgres|gauge-sh/prisma-rest-express
express-postgres|itsMinar/express-postgres-prisma-starter
express-postgres|Nditah/hello-prisma
django|gauge-sh/healthchecks
django|gauge-sh/linkding
django|PyPiSan/minimal-django-app
django|kirpit/django-sample-app
django|uedemir/basic-django-and-postgresql-app
fastapi|gauge-sh/create-llama-fastapi
fastapi|kfelts/minimal-fastapi-postgres-template
fastapi|mdhishaamakhtar/fastapi-sqlalchemy-postgres-template
fastapi|modern-python/fastapi-sqlalchemy-template
nextjs|gauge-sh/langchain-nextjs-template
nextjs|glRajkumar/fullstack-nextjs
nextjs|xizon/fullstack-nextjs-app-template
go|gauge-sh/starter-go
go|teten-nugraha/go-rest
go|qiangxue/go-rest-api
go|saidaydogan/chi-poc
rails|tarunvelli/rails-tabler-starter
rails|andrew2net/Rails8StarterKit
mcp|ferrants/mcp-streamable-http-typescript-server
mcp|modelcontextprotocol/example-remote-server
mcp|samwang0723/mcp-template
mcp|invariantlabs-ai/mcp-streamable-http
cron|DO-Solutions/app-platform-cron
discord-bot|zr00da/discord-bot-starter
discord-bot|jmcgorey/discord-bot-starter
discord-bot|bredmor/simple-discord-js-bot
static|withastro/blog-tutorial-demo
static|satnaing/astro-paper
static|11ty/eleventy-base-blog
static|theNewDynamic/gohugo-theme-ananke
static|jekyll/minima
migration|dockersamples/example-voting-app
migration|docker/getting-started-app
migration|khezen/compose-postgres
cron|cronitorio/cronitor-python
cron|Tecnativa/docker-cron
cron|mcuadros/ofelia
"
CONFIGS='render.yaml|render.yml|fly.toml|vercel.json|railway.json|railway.toml|Procfile|heroku.yml|app.yaml|app.yml|cloudbuild.yaml|netlify.toml|wrangler.toml|wrangler.jsonc|apprunner.yaml|.do/app.yaml|.platform.app.yaml|serverless.yml|amplify.yml|.elasticbeanstalk|nixpacks.toml|Dockerfile|docker-compose.yml|docker-compose.yaml|compose.yml|compose.yaml'
# Two passes, because two platform names are also ordinary words. Case-insensitively,
# `render\b` matched `render_template` 25 times in Flask's docs and `lambda` matched Python's
# keyword — both reported as a platform naming the repo, which is what decides whether a fork
# needs its docs stripped. So the unambiguous brands are matched case-insensitively and those
# two only with their capital letter, plus render.com in any case.
PLATFORMS='railway|render\.com|fly\.io|flyctl|vercel|netlify|heroku|digitalocean|app platform|cloud run|app engine|elastic beanstalk|app runner|amplify|azure|cloudflare|koyeb|northflank|coolify|hetzner|pythonanywhere|hostinger|github pages|firebase|supabase'
PLATFORMS_CASED='Render|Lambda'
echo "$CANDIDATES" | grep -v '^$' | while IFS='|' read -r stack repo; do
  dir=$(echo "$repo" | tr '/' '__')
  if [ ! -d "$dir" ]; then GIT_TERMINAL_PROMPT=0 git clone -q --depth 1 "https://github.com/$repo" "$dir" 2>/dev/null || { echo "{\"stack\":\"$stack\",\"repo\":\"$repo\",\"error\":\"clone failed\"}"; continue; }; fi
  cd "$dir"
  sha=$(git rev-parse HEAD); date=$(git log -1 --format=%cs)
  files=$(git ls-files | wc -l); kb=$(git ls-files -z | xargs -0 du -ck 2>/dev/null | tail -1 | cut -f1)
  license=$(ls LICENSE* LICENCE* COPYING* 2>/dev/null | head -1); lic=""; [ -n "$license" ] && lic=$(head -3 "$license" | tr '\n' ' ' | cut -c1-60)
  cfg=$(git ls-files | grep -E "(^|/)($CONFIGS)$" | tr '\n' ',' | sed 's/,$//')
  # Platform names in README and docs, counted per platform (case-insensitive, word-ish).
  # A multi-word hit used to print as its first word only, so "app engine" was reported as
  # "app". The count is stripped off the front and the whole match kept, hyphenated.
  # `docs?/.*` sweeps in whatever else lives beside the prose. linkding's docs site ships a
  # package-lock.json, and its transitive dependencies (@azure/cosmos, @vercel/*, @netlify/*)
  # were counted as the documentation naming a platform — twelve Azure "mentions" in a repo
  # whose docs never say Azure. Lockfiles and dependency manifests are excluded.
  docs=$(git ls-files | grep -iE '(^|/)(readme|docs?/.*|.*\.md)$' \
    | grep -viE '(^|/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|composer\.lock|Gemfile\.lock|uv\.lock|package\.json)$' \
    | tr '\n' '\0' | xargs -0 cat 2>/dev/null)
  mentions=$({ printf '%s' "$docs" | grep -oiE "$PLATFORMS" | tr 'A-Z' 'a-z'; printf '%s' "$docs" | grep -oE "$PLATFORMS_CASED"; } | sort | uniq -c | sort -rn | awk '{c=$1; $1=""; sub(/^ +/, ""); gsub(/ /, "-"); printf "%s:%s,", $0, c}' | sed 's/,$//')
  # Persistent state hints: a database service, an ORM, a volume, sqlite files.
  state=$(git ls-files | tr '\n' '\0' | xargs -0 grep -liE 'postgres|sqlite|mysql|redis|volume|persistent' 2>/dev/null | wc -l)
  printf '{"stack":"%s","repo":"%s","sha":"%s","last_commit":"%s","files":%s,"kb":%s,"license":"%s","platform_configs":"%s","platform_mentions":"%s","state_files":%s}\n' "$stack" "$repo" "$sha" "$date" "$files" "$kb" "$(echo "$lic" | sed 's/"/\\"/g')" "$cfg" "$mentions" "$state"
  cd ..
done
