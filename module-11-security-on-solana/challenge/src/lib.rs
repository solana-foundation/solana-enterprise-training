// Staking Vault - AUDIT CHALLENGE (Module 11)
//
// This program contains SEVEN planted checklist vulnerabilities. See SOLUTION.md
// after attempting the audit. Any omment is intentionally neutral; they do
// not flag the bugs.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("Stk1111111111111111111111111111111111111111");

#[program]
pub mod staking_vault {
    use super::*;

    pub fn initialize_pool(ctx: Context<InitializePool>, reward_rate: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.admin = ctx.accounts.admin.key();
        pool.vault = ctx.accounts.vault.key();
        pool.reward_rate = reward_rate;
        pool.total_staked = 0;
        pool.bump = ctx.bumps.pool;
        Ok(())
    }

    pub fn initialize_stake(ctx: Context<InitializeStake>) -> Result<()> {
        let stake = &mut ctx.accounts.stake;
        stake.owner = ctx.accounts.owner.key();
        stake.pool = ctx.accounts.pool.key();
        stake.amount = 0;
        stake.last_update = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        let cpi = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_token.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        );
        token::transfer(cpi, amount)?;

        let stake = &mut ctx.accounts.stake;
        stake.amount += amount;
        ctx.accounts.pool.total_staked += amount;
        Ok(())
    }

    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        let stake = &mut ctx.accounts.stake;
        let pool = &ctx.accounts.pool;

        // reward = amount * reward_rate / 10000, over the staked period
        let now = Clock::get()?.unix_timestamp;
        let elapsed = (now - stake.last_update) as u64;
        let reward = amount * pool.reward_rate / 10000 * elapsed;

        let total_out = amount + reward;
        let seeds = &[b"pool".as_ref(), &[pool.bump]];
        let signer = &[&seeds[..]];
        let cpi = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user_token.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            },
            signer,
        );
        token::transfer(cpi, total_out)?;

        stake.amount -= amount;
        stake.last_update = now;
        Ok(())
    }

    pub fn set_reward_rate(ctx: Context<SetRewardRate>, new_rate: u64) -> Result<()> {
        ctx.accounts.pool.reward_rate = new_rate;
        Ok(())
    }

    pub fn close_stake(ctx: Context<CloseStake>) -> Result<()> {
        // Return rent lamports to the owner.
        let stake_lamports = ctx.accounts.stake.to_account_info().lamports();
        **ctx.accounts.stake.to_account_info().try_borrow_mut_lamports()? -= stake_lamports;
        **ctx.accounts.owner.to_account_info().try_borrow_mut_lamports()? += stake_lamports;
        Ok(())
    }
}

#[account]
pub struct Pool {
    pub admin: Pubkey,
    pub vault: Pubkey,
    pub reward_rate: u64,
    pub total_staked: u64,
    pub bump: u8,
}

#[account]
pub struct Stake {
    pub owner: Pubkey,
    pub pool: Pubkey,
    pub amount: u64,
    pub last_update: i64,
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(init, payer = admin, space = 8 + 32 + 32 + 8 + 8 + 1, seeds = [b"pool"], bump)]
    pub pool: Account<'info, Pool>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub vault: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeStake<'info> {
    #[account(init, payer = owner, space = 8 + 32 + 32 + 8 + 8)]
    pub stake: Account<'info, Stake>,
    pub pool: Account<'info, Pool>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub stake: Account<'info, Stake>,
    #[account(mut)]
    pub pool: Account<'info, Pool>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_token: Account<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut)]
    pub stake: Account<'info, Stake>,
    #[account(mut)]
    pub pool: Account<'info, Pool>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_token: Account<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SetRewardRate<'info> {
    #[account(mut)]
    pub pool: Account<'info, Pool>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct CloseStake<'info> {
    #[account(mut)]
    pub stake: Account<'info, Stake>,
    #[account(mut)]
    pub owner: Signer<'info>,
}
