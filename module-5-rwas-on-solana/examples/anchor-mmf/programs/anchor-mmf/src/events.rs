use anchor_lang::prelude::*;

/// Durable audit record for every operator-driven seizure - emitted by both
/// `force_transfer` and `force_burn`.
///
/// It is emitted with `emit_cpi!`, so the payload is written to the
/// transaction's inner-instruction data rather than the truncatable log
/// buffer, where an indexer can read it reliably. The event stream, together
/// with the canonical ledger, is the system of record: this program keeps no
/// on-chain mirror of the seizure history (no counter, no hash chain), so the
/// compliance/audit pipeline is expected to ingest these events off-chain.
///
/// A regulated issuer needs to evidence, after the fact, who seized what, from
/// whom, how much, and under which accepted maker/checker proposal.
#[event]
pub struct AssetSeizure {
    /// MMF mint the seizure acted on.
    pub mint: Pubkey,
    /// Holder token account the funds were taken from.
    pub from_ata: Pubkey,
    /// Destination token account for a forced transfer; `None` for a burn.
    pub to_ata: Option<Pubkey>,
    /// Base units transferred or burned.
    pub amount: u64,
    /// Whether this was a forced transfer or a forced burn.
    pub kind: SeizureKind,
    /// Signer that executed the action - the compliance delegate.
    pub authority: Pubkey,
    /// The accepted `TimeLock` proposal PDA this seizure executed against.
    pub timelock: Pubkey,
    /// Block time at which the seizure executed.
    pub timestamp: i64,
}

/// Discriminates the two seizure actions carried by `AssetSeizure`, so an
/// indexer can filter without inspecting `to_ata`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum SeizureKind {
    Transfer,
    Burn,
}

/// Durable audit record for daily NAV writes. Emitted with `emit_cpi!` so
/// the payload lands in inner-instruction data and an indexer can ingest it
/// without scraping the truncatable log buffer.
///
/// The InterestBearingMint rate is what Token-2022 applies in
/// `amount_to_ui_amount`, so the off-chain reconciliation pipeline reconstructs
/// the daily share price from this event stream rather than reading the mint
/// account every day.
#[event]
pub struct NavRateUpdated {
    /// MMF mint whose InterestBearingMint extension was updated.
    pub mint: Pubkey,
    /// New rate in basis points, signed. Negative values represent a loss to
    /// the fund and are allowed for end-of-life wind-down or unrealized
    /// impairment scenarios.
    pub new_rate_bps: i16,
    /// Signer that posted the new rate - the rate authority.
    pub authority: Pubkey,
    /// Block time at which the new rate was written.
    pub timestamp: i64,
}

/// Durable audit record for a cancelled timelock proposal. Emitted with
/// `emit_cpi!` so an indexer can reliably attribute the cancel (proposer-
/// initiated vs admin-override) without scraping the log buffer.
#[event]
pub struct TimelockProposalCancelled {
    /// The cancelled `TimeLock` proposal PDA.
    pub proposal: Pubkey,
    /// Original proposer of the now-cancelled proposal.
    pub proposer: Pubkey,
    /// Signer that performed the cancel.
    pub signer: Pubkey,
    /// True if the cancel was the admin override path rather than the
    /// proposer cancelling their own proposal.
    pub admin_override: bool,
    /// Block time at which the cancel landed.
    pub timestamp: i64,
}
