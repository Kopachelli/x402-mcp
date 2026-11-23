# x402-mcp

MCP (Model Context Protocol) server exposing the Kopachelli x402 paid-API fleet as tools.
Works with Claude Desktop, Cursor, Devin, and any stdio MCP client.

## Tools

- `x402_catalog` — list all products, prices, endpoints
- `x402_<product>_<method>_<path>` — one tool per paid endpoint, generated live
  from `https://x402-catalog.kopachelli.workers.dev/v1/catalog` (5-min cache).

Tool args: `query` (object → URL params) and `body` (object → JSON body).

## Payment modes

| Mode | Env | Behavior |
|---|---|---|
| Catalog | (none) | Calls return HTTP 402 `payment_required` details for out-of-band payment |
| Auto-pay | `X402_PRIVATE_KEY` | Signs EIP-712 authorization per call, pays via facilitator, returns result + settlement tx |

**Testnet only by default** (`eip155:84532`, worthless faucet USDC).
For mainnet set `X402_NETWORK=eip155:8453` — real USDC will be spent.

## Client config (Claude Desktop / Cursor / Devin)

```json
{
  "mcpServers": {
    "x402-fleet": {
      "command": "node",
      "args": ["F:/x402/x402-mcp/index.mjs"],
      "env": {
        "X402_PRIVATE_KEY": "0x...testnet-key..."
      }
    }
  }
}
```

Omit `X402_PRIVATE_KEY` for catalog-only mode.
