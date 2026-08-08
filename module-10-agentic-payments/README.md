# Module 10: Agentic Payments

## Learning Objectives

- Explain why autonomous AI agents need programmatic payment rails and why traditional payment infrastructure cannot serve them
- Describe the x402 protocol: its origin in HTTP 402 "Payment Required," its flow, and its stateless design
- Walk through a complete x402 payment exchange: request, 402 challenge, signed payment, verification, settlement, and response
- Understand the role of facilitators and the trade-offs of using one versus self-managed verification
- Implement a minimal x402 server that verifies and settles SPL token payments
- Implement a minimal x402 client that constructs, signs, and submits payment proofs
- Contrast x402 with MPP (Machine Payments Protocol) and explain how payment channels reduce n payments to two on-chain transactions
- Evaluate the x402 tooling ecosystem (Corbits, MCPay, PayAI, Coinbase reference implementation, ACK, A2A)
- Identify enterprise use cases: API metering, MCP server monetization, agent-to-agent commerce, and pay-per-use data services

## Topics Covered

- Why agentic payments: the autonomy gap
- The friction problem: accounts, API keys, and broken flow
- Why Solana: sub-cent fees and sub-second finality
- The x402 protocol
- The x402 flow, step by step
- Facilitators: what they abstract and what they cost
- Server-side implementation
- Client-side implementation
- Verification and security considerations
- pay.sh: payments for HTTP agents and CLI tools; MPP and payment channels
- The x402 tooling ecosystem
- Enterprise use cases

## Prerequisite

Completed Module 7 (Payments on Solana) or equivalent familiarity with SPL token transfers, ATAs, transaction construction, and commitment levels.

## Slides

[Agentic Payments — Slides](https://docs.google.com/presentation/d/1TTCR3CfC8Cvq0sTLubwqeI2V2Vw7DM162bTZp76ht88/edit?usp=sharing)

## Example

[x402 on Devnet](examples/x402-devnet/) — minimal x402 server + client with the full verification pipeline and JWT session improvement. Also serves as the hands-on lab solution.

---

## 1. Why agentic payments: the autonomy gap

AI agents are increasingly autonomous in their workflows: writing code, fetching data, provisioning resources, calling external services. But there is a gap in that autonomy: **payment**. An agent can discover the perfect API for its task, but if that API costs money, the agent stops and a human takes over.

To operate fully independently, agents need a way to make micropayments for services programmatically, in real time, at minimal cost. Traditional payment rails cannot do this:

- **Card networks** are built for human-initiated, high-value transactions. Fees of $0.30 + 2.9% make a $0.001 API call absurd.
- **Account-based billing** (subscriptions, API keys, invoicing) requires human onboarding: forms, KYC, dashboards, key management.
- **Settlement latency** of days means providers must extend credit to unknown counterparties — a non-starter for anonymous agents.

Solana's sub-cent fees and sub-second finality make machine-to-machine micropayments technically and economically viable for the first time.

## 2. The friction problem

Consider a developer using an LLM to build an application that needs data from a paid API. Today, the workflow looks like this:

1. Stop the workflow
2. Research API providers
3. Select a provider
4. Create an account
5. Add a payment method
6. Generate an API key
7. Copy the key into the environment
8. Resume the workflow

This friction breaks flow state. For a human developer it is an annoyance; for an AI-assisted workflow it is a **blocker** — the agent cannot complete steps 3 through 7 on its own.

With agentic payments, the agent makes the request, pays for it, and continues:

- **No accounts.** The payment itself is the authentication.
- **No API keys.** Nothing to provision, store, rotate, or leak.
- **No manual intervention.** The full loop is programmatic.

For an enterprise, this inverts the integration model: instead of negotiating contracts and provisioning credentials for every downstream service an agent might use, the agent carries a funded wallet and pays per request, with every payment auditable on-chain.

## 3. Why Solana

The economics of micropayments only work if the payment rail costs less than the thing being paid for. For a $0.001 API call:

| Requirement | Solana property |
|-------------|-----------------|
| Fees far below the payment amount | Base fee ~ $0.0003; total cost fractions of a cent |
| Settlement fast enough for a request/response cycle | Sub-second confirmation; ~400 ms slots |
| No counterparty credit risk | Payment settles on-chain before content is served |
| Stablecoin denomination | USDC and other SPL tokens are first-class |
| Programmatic verification | Any server can verify a transfer with one RPC call |

These are the same properties covered in Module 7 for institutional payments — agentic payments simply push them to their logical extreme: payments so small and so frequent that no human could ever be in the loop.

## 4. The x402 protocol

Agentic payments need a way for clients and servers to negotiate payment terms over standard web infrastructure, without disrupting traditional web interfaces. The micropayment space is still nascent, but the [x402 protocol](https://www.x402.org/) has emerged as an early standard with strong ecosystem support.

x402 uses HTTP's **402 "Payment Required"** status code — reserved in the HTTP specification since HTTP/1.1, but never practical until blockchain settlement made machine-payable requests viable.

**Core protocol idea:** use plain HTTP.

1. A client hits a URL
2. The server replies `402 Payment Required` with a JSON **PaymentRequirements** object
3. The client pays and retries with an `X-PAYMENT` header
4. The server verifies and settles the payment
5. The server responds `200 OK` with the content

**Key properties:**

- **Stateless.** No sessions, no accounts, no API keys, no OAuth.
- **Standard HTTP.** Works with any HTTP client, proxy, or middleware stack.
- **Chain-agnostic by design;** on Solana it supports any SPL token the server accepts.
- **Spec building blocks:** the `PaymentRequirements` structure, the base64-encoded `X-PAYMENT` header, the optional `X-PAYMENT-RESPONSE` header on success, and an optional facilitator API (`/verify`, `/settle`, `/supported`). The current concrete payment scheme is `exact` (pay a specific amount); others such as `upto` are proposed.

## 5. The x402 flow, step by step

```
Client                        Server                     Facilitator / Chain
  |                             |                              |
  |  GET /costly-data           |                              |
  |---------------------------->|                              |
  |  402 + PaymentRequirements  |                              |
  |<----------------------------|                              |
  |                             |                              |
  |  [construct + sign payment] |                              |
  |                             |                              |
  |  GET /costly-data           |                              |
  |  X-PAYMENT: <base64 proof>  |                              |
  |---------------------------->|  verify + settle             |
  |                             |----------------------------->|
  |                             |  settlement confirmed        |
  |                             |<-----------------------------|
  |  200 OK + content           |                              |
  |<----------------------------|                              |
```

The client makes a request, receives a 402 with payment terms, then retries with a signed payment. The server delegates verification and settlement to a **facilitator** — an optional intermediary that handles the on-chain transaction submission. Once the facilitator confirms settlement, the server returns the requested content.

This separation lets API providers accept payments **without managing any on-chain infrastructure directly** — the same "abstraction of blockchain complexity" pattern seen with fee payer services in Module 7.

## 6. Facilitators: what they abstract and what they cost

A facilitator sits between the resource server and the chain. The server sends it the client's payment proof; the facilitator verifies it, submits the transaction, confirms settlement, and reports back.

**What a facilitator gives you:**

- No RPC infrastructure, keypair management, or transaction-submission logic on the resource server
- Some facilitators (e.g., PayAI) sponsor transaction fees entirely
- A single integration point for supporting multiple chains or tokens

**What it costs you:**

- **A single point of failure.** If the facilitator's wallet runs out of funds or its service degrades, your paid endpoints stop working.
- **A trust dependency.** You rely on the facilitator's verification being correct.
- **A potential fee layer** on top of network fees.

The facilitator is completely optional — a server can implement its own verification logic in a few dozen lines (Section 9). Enterprise deployments should weigh the operational simplicity of a facilitator against the dependency it introduces, exactly like any other critical third-party service.

## 7. Server-side implementation

With the x402 middleware for Express, protecting an endpoint is declarative — pricing, network, and recipient are configured per route:

```typescript
app.use(
  paymentMiddleware(
    {
      "GET /costly-data": {
        accepts: [
          {
            scheme: "exact",
            price: "$0.001",
            network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
            payTo: svmAddress
          }
        ],
        description: "Costly data",
        mimeType: "application/json"
      }
    },
    new x402ResourceServer(facilitatorClient).register(
      "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      new ExactSvmScheme()
    )
  )
);

app.get("/costly-data", (req, res) => {
  res.send({ report: { data: "costly data" } });
});
```

The middleware automatically handles the 402 response with payment requirements, payment verification, transaction submission via the facilitator, and settlement confirmation. The business logic in the route handler stays completely payment-unaware.

Coinbase's reference implementation follows the same pattern with per-route pricing:

```typescript
app.use(
  paymentMiddleware(RECIPIENT, {
    "GET /premium": { price: "$0.0001", network: "solana-devnet" },
    "GET /expensive": { price: "$0.001", network: "solana-devnet" }
  })
);
```

## 8. Client-side implementation

On the client side, the pattern is to wrap `fetch` with a payment handler. When a 402 comes back, the handler constructs the payment, signs it with the local wallet, and retries — transparently to the calling code:

```typescript
import { createPaymentHandler } from "@faremeter/payment-solana/exact";
import { wrap } from "@faremeter/fetch";

const wallet = {
  network,
  publicKey: keypair.publicKey,
  updateTransaction: async (tx: VersionedTransaction) => {
    tx.sign([keypair]);
    return tx;
  }
};

const handler = createPaymentHandler(wallet, usdcMint, connection);
const fetchWithPayer = wrap(fetch, { handlers: [handler] });

// Call the API - payment happens automatically
const response = await fetchWithPayer("https://helius.api.corbits.dev", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBlockHeight" })
});
```

The payment proof itself is a base64-encoded JSON object in the `X-PAYMENT` header:

```typescript
const paymentProof = {
  x402Version: 1,
  scheme: "exact",
  network: "solana-mainnet",
  payload: {
    serializedTransaction: serializedTx   // signed, not yet submitted
  }
};
```

Note the design: the client **signs but does not submit** the transaction. The server (or its facilitator) broadcasts it. This gives the server control over when settlement happens relative to serving the content.

## 9. Verification and security considerations

A server that verifies payments itself (no facilitator) must treat the client-provided transaction as **untrusted input**. The reference verification flow:

1. **Decode and introspect the transaction.** Parse the `X-PAYMENT` header, deserialize the transaction, and find the SPL token transfer instruction. Verify the destination is your token account and the amount meets the price. Do not trust any field the client claims — decode the actual instruction bytes.

2. **Simulate before submitting.** Run `simulateTransaction` first. A transaction that fails simulation should be rejected with a 402, not submitted.

3. **Submit and confirm.** Broadcast the raw transaction and wait for `confirmed` commitment. The chain automatically rejects duplicate signatures, which prevents the same signed payment from being replayed.

4. **Verify balance changes from transaction metadata.** After confirmation, fetch the transaction and check `preTokenBalances` / `postTokenBalances` for your recipient token account. The amount actually received is the ground truth — not the instruction contents.

**Additional considerations for production:**

- Consider returning a short-lived JWT after payment so clients can reuse access briefly without paying per request
- Keep server keys in environment variables, never in code
- A Solana-specific variant exists where the client submits the transaction itself (with a memo) and sends only the signature for verification — this survives connection loss between payment and content delivery, but deviates from the x402 standard flow
- Choose commitment levels using the Module 7 framework: `confirmed` for serving content, `finalized` for anything triggering irreversible off-chain actions

## 10. pay.sh: payments for HTTP agents and CLI tools

[pay.sh](https://pay.sh) is a payment layer for HTTP agents and command-line tools. The `pay` CLI wraps tools like `curl`, `codex`, and `claude` so they can call paid APIs without provider accounts or API keys. When an API returns an MPP or x402 `402 Payment Required` challenge, `pay` asks the local wallet to approve signing.

```bash
# Install
brew install pay              # or: npm install -g @solana/pay

# Verify
pay --version

# Set up and top up a wallet
pay setup
```

This is the developer-experience layer of agentic payments: any existing CLI tool becomes payment-capable without modification.

### MPP: the Machine Payments Protocol

x402 is not the only live payment standard on Solana. **MPP (Machine Payments Protocol)** is the second protocol the `pay` CLI supports, and the two coexist deliberately:

- **x402** expresses the challenge through the `402 Payment Required` status code and the `X-PAYMENT` header.
- **MPP** expresses the challenge through the standard **`WWW-Authenticate`** header and retries with an **authorization credential** — the same negotiation shape HTTP already uses for authentication, applied to payment. The specification lives at [paymentauth.org](https://paymentauth.org/draft-solana-charge-00.html/) as `draft-solana-charge`.

In practice, a client like `pay` does not care which protocol a server speaks: it detects the challenge type, prepares the stablecoin transaction, requests local wallet approval, and retries with the right proof format. You can exercise an MPP challenge against the public debugger:

```bash
# Without pay - you get the challenge
curl https://debugger.pay.sh/mpp/quote/AAPL

# With pay - the challenge is handled and the response returned
pay curl https://debugger.pay.sh/mpp/quote/AAPL
```

The takeaway for architects: the challenge-negotiation layer is still standardizing (x402, MPP, and Google's AP2 all target the same gap), but they converge on the same fundamentals — HTTP-native negotiation, stablecoin settlement on Solana, and wallet-authorized signing. Server-side verification logic (Section 9) is largely protocol-independent.

### Payment channels: one settlement for many payments

Per-request on-chain settlement has a floor: every request costs one transaction fee and one confirmation round-trip. For **metered, streamed, or very-high-frequency** payments — per-token LLM billing, per-second streaming, thousands of calls in a session — even sub-cent fees and sub-second finality become the bottleneck.

The Solana Foundation's [payment-channels](https://github.com/solana-foundation/payment-channels) program is the primitive that removes that floor: **unidirectional payment channels** where one `open` and one `settle` replace a transaction per payment. It is a small Pinocchio program over SPL Token / Token-2022, live on mainnet ([`CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX`](https://explorer.solana.com/address/CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX)).

**How it works:**

1. **`open`** — the payer escrows a deposit into a channel PDA. This is the spending ceiling.
2. **Off-chain vouchers** — the payer signs Ed25519 vouchers authorizing **cumulative** spend. A newer voucher supersedes older ones, and the program never settles more than the deposit. No transaction, no fee, no latency per payment.
3. **`settle`** — the merchant advances the on-chain settled amount from a signed voucher.
4. **`distribute`** — pays the payee (and any split recipients), refunds the unspent remainder to the payer, and closes the escrow.
5. **`reclaim`** — deallocates the channel and recovers 100% of its rent. A closed channel leaves nothing on chain.

Closing is either cooperative (`settle_and_seal` in one step) or forced (`request_close` starts a grace period, then `seal`), so a disappearing counterparty cannot lock funds.

**This is the settlement layer behind two pay.sh primitives:**

| Primitive | Pattern |
|-----------|---------|
| x402 `upto` | A single metered call: escrow a ceiling, the operator settles one voucher for the *actual* amount consumed and refunds the rest |
| MPP `session` | A streamed channel: many cumulative vouchers during the session, settled once when the session idle-closes |

**The enterprise framing:** channels change the cost model from *O(n) transactions for n payments* to *O(1)*. An agent streaming inference from a paid model signs a voucher per chunk at zero marginal cost, and exactly two on-chain transactions bracket the entire session. Combined with the x402/MPP negotiation layer, this makes true per-token and per-second pricing operationally viable.

## 11. The x402 tooling ecosystem

The space is evolving quickly; this table reflects the current landscape:

| SDK / Project | Solana support | Notes |
|---------------|----------------|-------|
| [Corbits](https://corbits.dev/) | Yes | Solana-first x402 implementation; pay-per-RPC example |
| [MCPay.tech](https://mcpay.tech/) | Yes | Pay-per-request for MCP servers — monetize agent tools |
| [PayAI](https://payai.network/) | Yes | x402 facilitator with Solana support; currently sponsors transaction fees |
| [Coinbase x402](https://github.com/coinbase/x402) | Yes | Reference implementation; TypeScript client + server, 6 SVM test scenarios |
| [ACK](https://github.com/agentcommercekit/ack) | In progress | Agent Commerce Kit — adds verifiable agent identity (W3C DIDs/VCs) and compliance-ready payment receipts |
| [x402scan](https://x402scan.com/) | Explorer | Ecosystem analytics: volumes, merchants, endpoints |

**ACK deserves enterprise attention:** it layers verifiable agent identity and cryptographically secure receipts (as Verifiable Credentials) on top of x402 — addressing the identity and compliance questions that a bare payment protocol leaves open. For regulated entities asking "which agent paid, on whose behalf, and can we prove it?", this is the emerging answer.

## 12. Enterprise use cases

**AI and agent commerce:**
- Pay-per-inference LLM access, image generation, model API calls
- MCP server monetization — charge per tool invocation or data query
- Agent-to-agent payments — autonomous agents transacting for services and data
- Premium training data sold per query

**Developer services:**
- API metering: pay per RPC call, database query, or compute unit
- Serverless function billing per execution

**Data and analytics:**
- Real-time market data priced per quote or per tick
- IoT / DePIN sensor readings sold per reading

**Content and media:**
- Micro-paywalled articles, per-minute streaming, one-time file downloads

The common thread: **pricing granularity that subscriptions cannot express**. A subscription is a blunt instrument priced for the average consumer; x402 prices each request at its marginal value. For enterprises this cuts both ways — as a *provider*, it monetizes APIs without a billing department; as a *consumer*, it lets agent fleets access thousands of services with a single funded wallet and a complete on-chain audit trail.

---

## Hands-on lab

Build a minimal x402 flow on devnet, without a facilitator, to internalize the protocol mechanics.

- **Starting point:** the [native example repo](https://github.com/Woody4618/x402-solana-examples) — a minimal Express server and Node client with no x402 SDK dependencies
- **Flow:**
  1. Run the server and client as-is; trace the full flow (quote → sign → X-PAYMENT → verify → settle → content) in the logs
  2. Modify the server to require a different SPL token and price
  3. Add the JWT improvement: after a verified payment, return a token granting 5 minutes of access without further payments
- **Checkpoints:**
  1. Why does the client signs but does not submit the transaction?
  2. Why verify the transfer instruction bytes rather than trusting client-provided fields?
  3. Why should you simulate before submitting?
  4. When would you need to add a facilitator, and what new failure mode that introduces?

**Solution:** [examples/x402-devnet/](examples/x402-devnet/) — complete server + client with the full verification pipeline, the JWT session improvement, and checkpoint answers in its README.

Note: the example code is unaudited demonstration code — the lab is about protocol mechanics, not production hardening.

---

## Additional resources

- [Agentic Payments — Solana Docs](https://solana.com/docs/payments/agentic-payments) — Source material for this module.
- [Introduction to x402](https://solana.com/developers/guides/getstarted/intro-to-x402) — Protocol fundamentals, SDK landscape, and the native example walkthrough.
- [Build with Kora](https://solana.com/developers/guides/getstarted/build-a-x402-facilitator) — Implement gasless x402 payments using Kora's signing infrastructure.
- [x402.org](https://www.x402.org/) — The protocol specification.
- [x402 GitHub (Coinbase)](https://github.com/coinbase/x402) — Reference implementation.
- [x402scan](https://x402scan.com/) — Ecosystem explorer and analytics.
- [pay.sh docs](https://pay.sh/docs) — CLI payment layer installation and usage.
- [MPP specification (draft-solana-charge)](https://paymentauth.org/draft-solana-charge-00.html/) — The Machine Payments Protocol.
- [payment-channels (Solana Foundation)](https://github.com/solana-foundation/payment-channels) — Unidirectional payment channels: the on-chain settlement layer behind x402 `upto` and MPP `session`.
- [pay CLI (GitHub)](https://github.com/solana-foundation/pay) — Source for the `pay` CLI, MCP server, and payment debugger.
