#!/usr/bin/env node
// x402-mcp — MCP server exposing the Kopachelli x402 paid-API fleet.
//
// Tools are generated from the live catalog at
// https://x402-catalog.kopachelli.workers.dev/v1/catalog (cached 5 min).
//
// Payment modes:
//   - No X402_PRIVATE_KEY: calls return the HTTP 402 PAYMENT-REQUIRED details
//     so the calling agent/user can pay out-of-band.
//   - X402_PRIVATE_KEY set: server signs an EIP-712 authorization and pays
//     per call via the facilitator, returning the paid response + settlement.
//     TESTNET ONLY (eip155:84532) unless NETWORK is deliberately changed.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const CATALOG_URL = process.env.X402_CATALOG_URL ?? "https://x402-catalog.kopachelli.workers.dev/v1/catalog";
// Fleet is on Base MAINNET (real USDC). X402_NETWORK=eip155:84532 only works
// against testnet deployments; setting a mainnet key here spends real money.
const NETWORK = process.env.X402_NETWORK ?? "eip155:8453";
const PK = process.env.X402_PRIVATE_KEY;

let payer = null;
let httpClient = null;
if (PK) {
  payer = privateKeyToAccount(PK);
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: payer, networks: [NETWORK] });
  httpClient = new x402HTTPClient(client);
}

// --- catalog cache ---
let catalogCache = { at: 0, products: [] };
async function getCatalog() {
  if (Date.now() - catalogCache.at < 5 * 60_000 && catalogCache.products.length) return catalogCache.products;
  const res = await fetch(CATALOG_URL);
  if (!res.ok) throw new Error(`catalog fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  catalogCache = { at: Date.now(), products: data.products ?? [] };
  return catalogCache.products;
}

// --- paid fetch ---
async function paidFetch(url, { method = "GET", headers = {}, body } = {}) {
  const init = { method, headers: { ...headers }, ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) };
  if (body !== undefined && !init.headers["content-type"]) init.headers["content-type"] = "application/json";

  let res = await fetch(url, init);
  if (res.status === 402) {
    const prHeader = res.headers.get("payment-required") ?? res.headers.get("PAYMENT-REQUIRED");
    const paymentRequired = httpClient
      ? httpClient.getPaymentRequiredResponse((h) => res.headers.get(h) ?? res.headers.get(h.toLowerCase()), undefined)
      : prHeader ? JSON.parse(atob(prHeader)) : null;

    if (!httpClient || !paymentRequired) {
      const text = await res.text();
      return {
        status: 402,
        payment_required: paymentRequired,
        hint: "No X402_PRIVATE_KEY configured — pay this endpoint per x402 protocol, then retry.",
        raw: text.slice(0, 2000),
      };
    }

    const payload = await httpClient.createPaymentPayload(paymentRequired);
    const sigHeaders = httpClient.encodePaymentSignatureHeader(payload);
    const retryInit = { ...init, headers: { ...init.headers, ...sigHeaders } };
    res = await fetch(url, retryInit);
    const settle = res.headers.get("payment-response") ?? res.headers.get("PAYMENT-RESPONSE");
    const text = await res.text();
    return { status: res.status, body: safeJson(text), payment_response: settle ? JSON.parse(atob(settle)) : null };
  }
  const text = await res.text();
  return { status: res.status, body: safeJson(text) };
}

function safeJson(t) {
  try { return JSON.parse(t); } catch { return t.slice(0, 4000); }
}

function buildUrl(base, path, query) {
  const u = new URL(base.replace(/\/+$/, "") + path);
  if (query && typeof query === "object") {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

// --- server ---
const server = new McpServer({ name: "x402-fleet", version: "0.1.0" });

server.registerTool(
  "x402_catalog",
  {
    description: "List all paid x402 API products (name, URL, price, endpoints).",
    inputSchema: {},
  },
  async () => {
    const products = await getCatalog();
    return { content: [{ type: "text", text: JSON.stringify({ products, payer: payer?.address ?? null, network: NETWORK }, null, 2) }] };
  }
);

async function registerProductTools() {
  const products = await getCatalog().catch(() => []);
  for (const p of products) {
    for (const ep of p.endpoints ?? []) {
      const toolName = `x402_${p.name}_${ep.method.toLowerCase()}_${ep.path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`.slice(0, 64);
      server.registerTool(
        toolName,
        {
          description: `${p.name} — ${p.description ?? ""} [${ep.method} ${ep.path}] $${p.price_usdc} USDC on ${p.network}. Example: ${ep.example ?? ""}`,
          inputSchema: {
            query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()
              .describe("Query parameters, e.g. {base:'USD', quote:'EUR'}"),
            body: z.record(z.string(), z.any()).optional()
              .describe("JSON body for POST/PUT/PATCH/DELETE"),
          },
        },
        async ({ query, body }) => {
          const method = ep.method;
          const hasBody = body !== undefined && ["POST", "PUT", "PATCH", "DELETE"].includes(method);
          const url = buildUrl(p.url, ep.path, query);
          try {
            const out = await paidFetch(url, { method, ...(hasBody ? { body } : {}) });
            return { content: [{ type: "text", text: JSON.stringify({ product: p.name, endpoint: `${method} ${ep.path}`, ...out }, null, 2) }] };
          } catch (e) {
            return { content: [{ type: "text", text: JSON.stringify({ product: p.name, endpoint: `${method} ${ep.path}`, error: String(e?.message ?? e) }) }], isError: true };
          }
        }
      );
    }
  }
}

await registerProductTools();
await server.connect(new StdioServerTransport());
console.error(`x402-mcp ready — ${payer ? `payer ${payer.address} (auto-pay ${NETWORK})` : "catalog mode (set X402_PRIVATE_KEY to auto-pay)"}`);
