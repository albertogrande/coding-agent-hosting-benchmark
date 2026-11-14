# streamable-mcp-server

[![Deploy to Koyeb](https://www.koyeb.com/static/images/deploy/button.svg)](https://app.koyeb.com/deploy?type=git&repository=github.com/albertogrande/mcp-streamable-http-typescript-server&branch=main&name=mcp-streamable-http-typ)

This is a starting place for a new streamable-http MCP Server built with typescript.

Streamable HTTP Transport was introduced on 2025-03-26. [See MCP Spec Changelog](https://modelcontextprotocol.io/specification/2025-03-26/changelog).

Starts with the [Model Context Protocol Typescript SDK Streamable HTTP with Session Management Example](https://github.com/modelcontextprotocol/typescript-sdk?tab=readme-ov-file#with-session-management) and contains some sensible dependencies and tsconfig to get rolling.

Clone or fork this repo, make updates and start building your Streamable HTTP MCP Server.

# Install and Run Locally

To install the dependencies, run:

```bash
npm install
```

Then build:

```bash
npm run build
```

## Running the Server

### Production Mode

To run the server in production mode:

```bash
npm start
# or directly with
node build/index.js
```


It runs on port 3000 by default. If you need another port, you can specify with the PORT env var.

```bash
PORT=3002 npm start
# or
PORT=3002 node build/index.js
```

### Development Mode

For development, you can use the dev mode which automatically watches for changes in your source files, rebuilds, and restarts the server:

```bash
npm run dev
```

With a custom port:

```bash
PORT=3002 npm run dev
```

# Connect a Client

You can connect a client to your Streamable HTTP MCP Server once it's running. Configure per the client's configuration. There is the [mcp-config.json](/mcp-config.json) that has an example configuration that looks like this:
```json
{
  "mcpServers": {
    "streamable-mcp-server": {
      "type": "streamable-http",
      "url": "http://localhost:3000"
    }
  }
}
```


Future enhancements:
- handle oauth authentication
- more tool examples


