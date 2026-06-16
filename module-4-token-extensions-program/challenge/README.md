# Module 4 Challenge: Compliance-Grade Token Design

You have seen two compliance architectures in this module:

- **mosaic-stablecoin** - sRFC-37 in deny-list mode: accounts start active, the issuer freezes bad actors.
- **anchor-transfer-hook** - a transfer hook enforcing a per-holder rate limit on every transfer.

Your challenge is to combine and extend these patterns.

## Part 1 - Tiered rate limits (core)

Extend the `anchor-transfer-hook` program so that the rate limit is no longer a single hardcoded `MAX_AMOUNT`:

1. Add a per-mint `RateLimitConfig` account (admin-controlled) holding `max_amount` and `window` (seconds). The hook must read its limits from this account instead of the constant.
2. Add an `update_config` instruction, callable only by the config authority, to tune both values.
3. Add a per-holder **exemption flag**: the authority can mark a holder (e.g. a market maker) as exempt, and the hook skips the limit check for them.

Requirements:

- All new state goes in `src/state/`, one type per file; instructions one per file under `src/instructions/`, wired into `lib.rs` - match the existing layout.
- Keep the fixed-window semantics and saturating arithmetic from the example. Do not reintroduce the sliding-window bug (re-read the comment on `RateLimit::update` to see why).
- Unit-test the pure logic in the state files (`cargo test`, no validator). Cover at least: config-driven limits, exemption bypass, and window reset.

## Part 2 - Choose the right ACL mode (design exercise)

Write a short design note (`DESIGN.md`, half a page) for this scenario: your company is issuing a **tokenized corporate bond** to institutional investors in two jurisdictions, each with its own KYC regime.

Answer:

1. Deny list or allowlist - which sRFC-37 mode, and why?
2. Where does jurisdiction logic live: in the Gate Program, in the hook, or off-chain? Justify the trade-off using the Token ACL vs. Transfer Hooks table from the module README.
3. Which other Token-2022 extensions would you enable at mint creation, and which authority holds each one? (Remember: extensions cannot be added after the mint exists.)

## Stretch goals

- Make the rate limit window roll over **pro rata**: instead of a full reset, carry over `amount_transferred * (time_remaining / window)` into the new window.
- Add a `cooldown` mode to the config: after a holder hits the cap, reject transfers until a configurable penalty period after `window_start + window` has elapsed.
- Wire the hook up to a mint that also has the **pausable** extension and verify (in a LiteSVM test) that pause and rate limiting compose correctly.

## Hints

- Module 5's `anchor-mmf` example contains a production-shaped version of the per-mint config pattern (`RateLimitConfig` + `RateLimit`) - peek only after attempting Part 1.
- `ExtraAccountMetaList` must include every account your hook reads. If you add a config account, the transfer will fail with a missing-account error until you register it there too.
- Decide what happens to in-flight windows when the admin lowers `max_amount` below a holder's current `amount_transferred`. There is no single right answer, but your tests must document the behavior you chose.
