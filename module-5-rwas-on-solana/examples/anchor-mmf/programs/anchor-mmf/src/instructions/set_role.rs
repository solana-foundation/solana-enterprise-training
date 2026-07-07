use anchor_lang::prelude::*;

use crate::{
    constants::{ANCHOR_DISCRIMINATOR_SIZE, CONFIG_SEED, ROLE_SEED, TIMELOCK_SET_ROLE},
    error::MmfError,
    state::{Config, Role, TimeLock, TimeLockOperation, TimeLockStatus},
};

/// Grant or revoke a role. Equivalent to `AccessControlFacetTimelockable`
/// on the Ethereum Diamond.
///
/// Always timelocked: only the program admin can execute, and the `timelock`
/// must be an `Accepted` `SetRole` proposal with the `TIMELOCK_SET_ROLE` delay
/// elapsed and matching parameters. There is no emergency bypass - the initial
/// roles are seeded by `initialize`, and every later change goes through the
/// maker/checker timelock.
///
/// The PDA is `init_if_needed` so a grantee can be revoked
/// (`granted=false`) and re-granted later without paying rent twice.
#[derive(Accounts)]
#[instruction(role: [u8; 32])]
pub struct SetRole<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ MmfError::NotAdmin,
    )]
    pub config: Account<'info, Config>,

    /// CHECK: plain pubkey — we don't dereference it, we just encode it
    /// into the PDA seeds.
    pub grantee: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = admin,
        space = ANCHOR_DISCRIMINATOR_SIZE + Role::INIT_SPACE,
        seeds = [ROLE_SEED, role.as_ref(), grantee.key().as_ref()],
        bump,
    )]
    pub role_account: Account<'info, Role>,

    #[account(mut)]
    pub timelock: Account<'info, TimeLock>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<SetRole>, role: [u8; 32], granted: bool) -> Result<()> {
    let timelock = &mut ctx.accounts.timelock;

    require!(
        timelock.operation == TimeLockOperation::SetRole,
        MmfError::TimelockMismatch
    );
    require!(
        timelock.status == TimeLockStatus::Accepted,
        MmfError::TimelockNotReady
    );

    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= timelock.timestamp + TIMELOCK_SET_ROLE,
        MmfError::TimelockNotReady
    );

    // Bind execution to the accepted proposal: the role, grantee, and
    // grant/revoke direction must match what was approved.
    let expected = TimeLock::encode_set_role(&role, &ctx.accounts.grantee.key(), granted);
    timelock.verify_action_data(&expected)?;

    timelock.status = TimeLockStatus::Executed;
    timelock.executer = Some(ctx.accounts.admin.key());

    ctx.accounts.role_account.set_inner(Role {
        role: role,
        grantee: ctx.accounts.grantee.key(),
        granted: granted,
        bump: ctx.bumps.role_account,
    });

    msg!(
        "role {} {} for {}",
        hex::encode(role),
        if granted { "granted" } else { "revoked" },
        ctx.accounts.role_account.grantee
    );
    Ok(())
}

// Tiny hex helper so we don't pull in the `hex` crate just for a log line.
mod hex {
    pub fn encode(bytes: [u8; 32]) -> String {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let mut s = String::with_capacity(64);
        for b in bytes {
            s.push(HEX[(b >> 4) as usize] as char);
            s.push(HEX[(b & 0x0f) as usize] as char);
        }
        s
    }
}
