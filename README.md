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

## Operation ledger (v0.2.0)

Every tool call that can spend USDC now goes through [effect-ledger](https://www.npmjs.com/package/effect-ledger),
a durable record of external action outcomes (SQLite at `~/.x402-mcp/ledger.db`,
override with `X402_LEDGER_PATH`).

- **Replay:** repeating an identical call returns the recorded result instead of paying again.
- **Dedupe:** concurrent duplicate calls collapse to a single execution.
- **Unknown ≠ failed:** if the paid request's response is lost after payment may have
  settled, the tool reports `ledger_status: "unknown"` and tells you not to retry
  blindly. There is no provider status lookup for these endpoints, so unknown
  records stay unknown until you decide.
- **Fingerprint binding:** reusing an `operationId` with different arguments is rejected.

Tool args added:

| Arg | Purpose |
|---|---|
| `operationId` | Your durable intent id (job id, run id). Omit to derive one from the arguments — identical arguments dedupe, which may not match your intent for repeat purchases. |
| `restart` | Explicitly re-run a `failed`/`unknown` operation. Only for `failed`; for `unknown` use it only if you are certain no payment settled. |

Pre-payment failures (network down, 402 with no key) are recorded as `failed` —
safe to retry. Failures after the signed request was sent are `unknown`.

Requires Node >= 22.13 (`node:sqlite`).

## Built with

This server and the fleet it fronts are built on Kopachelli's open-source
reliability packages:

- [effect-ledger](https://www.npmjs.com/package/effect-ledger) — exactly-once
  semantics for paid operations (replay, dedupe, unknown-outcome tracking)
- [x402-receipt](https://www.npmjs.com/package/x402-receipt) — x402 payment
  artifact verification
- [one-flight](https://www.npmjs.com/package/one-flight) — in-flight request
  deduplication
- [httpsig-js](https://www.npmjs.com/package/httpsig-js) — RFC 9421 HTTP Message
  Signatures
- [verifiable-log](https://www.npmjs.com/package/verifiable-log) — hash-chained
  audit trails
- [time-budget](https://www.npmjs.com/package/time-budget) — deadline propagation
