use anchor_lang::prelude::*;

/// Durable audit record for every operator-driven seizure - emitted by both
/// `force_transfer` and `force_burn`, on both the timelocked and the
/// emergency (break-glass) path.
///
/// It is emitted with `emit_cpi!`, so the payload is written to the
/// transaction's inner-instruction data rather than the truncatable log
/// buffer, where an indexer can read it reliably. The event stream, together
/// with the canonical ledger, is the system of record: this program keeps no
/// on-chain mirror of the seizure history (no counter, no hash chain), so the
/// compliance/audit pipeline is expected to ingest these events off-chain.
///
/// A regulated issuer needs to evidence, after the fact, who seized what, from
/// whom, how much, and under which authority - especially for the emergency
/// path, which otherwise leaves only an ephemeral `msg!` log.
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
    /// Signer that executed the action - the compliance delegate on the
    /// normal path, or the emergency authority on the break-glass path.
    pub authority: Pubkey,
    /// True if executed via the emergency (no-timelock) path; false if it
    /// went through an accepted maker/checker timelock.
    pub emergency: bool,
    /// The accepted `TimeLock` proposal PDA on the normal path; `None` on the
    /// emergency path, where there is no prior proposal to reference.
    pub timelock: Option<Pubkey>,
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
