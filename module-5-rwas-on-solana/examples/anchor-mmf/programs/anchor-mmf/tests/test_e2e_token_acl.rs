//! End-to-end litesvm test of the sRFC-37 Token ACL integration.
//!
//! Loads the two MMF programs (built to `target/deploy`) plus the real,
//! deployed Token ACL and ABL gate programs (vendored `.so` fixtures), then
//! drives the full onboarding flow and asserts the runtime behavior:
//!
//!   1. a holder's ATA is frozen on creation and becomes thawed only after
//!      Token ACL `thaw_permissionless` (gated by the ABL allow list);
//!   2. `mint_mmf` succeeds once the ATA is thawed;
//!   3. a transfer within the rate-limit cap succeeds and one over the cap is
//!      rejected by the transfer hook with `RateLimitExceeded`;
//!   4. `force_transfer` through the maker/checker timelock bypasses the rate
//!      limit (a seizure is never throttled);
//!   5. an immediate, role-gated pause blocks all movement, and resume restores it;
//!   6. a client-side Token ACL freeze of a holder blocks transfers into it.
//!
//! All instructions are hand-built with `solana_instruction` so the test does
//! not depend on any program's generated client. Anchor instruction
//! discriminators are computed as `sha256("global:<name>")[..8]`.
//!
//! No role accounts are injected: `initialize` seeds the genesis roles (the
//! admin gets the operator roles, a second `responder` key gets
//! `ROLE_RESPONDER`). `force_transfer` runs the real maker/checker timelock
//! (propose, respond with the distinct responder, fast-forward past the delay,
//! execute); pause is immediate; and freezing a holder is a client-side Token
//! ACL call, since `mmf_admin` has no freeze instruction.

use litesvm::LiteSVM;
use sha2::{Digest, Sha256};
use solana_address::Address;
use solana_clock::Clock;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;

// ---- program ids -----------------------------------------------------------

const MMF_ADMIN: Address = Address::from_str_const("3Aenr8ahixrmMdGhivPQWwo4dZQqFSucSiW2ivUFb27e");
const HOOK: Address = Address::from_str_const("FPX37yHKMHXsJyYUgsjSrXts5ndGsS6pADM2Eok13LeX");
const TOKEN_ACL: Address = Address::from_str_const("TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP");
const GATE: Address = Address::from_str_const("GATEzzqxhJnsWF6vHRsgtixxSB8PaQdcqGEVTEHWiULz");

const TOKEN_2022: Address = Address::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ATA_PROGRAM: Address = Address::from_str_const("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM_PROGRAM: Address = Address::from_str_const("11111111111111111111111111111111");
const SYSVAR_RENT: Address = Address::from_str_const("SysvarRent111111111111111111111111111111111");

const ROLE_MINTER: [u8; 32] = *b"MMF__MINTER_ROLE________________";
const ROLE_PAUSER: [u8; 32] = *b"MMF__PAUSER_ROLE________________";
const ROLE_COMPLIANCE_DELEGATE: [u8; 32] = *b"MMF__COMPLIANCE_DELEGATE_ROLE___";
const ROLE_RESPONDER: [u8; 32] = *b"MMF__RESPONDER_ROLE_____________";

// MMF mint has 4 decimals; the hook's default cap is 1_000_000 base units.
const DECIMALS: u8 = 4;
const RATE_CAP: u64 = 1_000_000;

// Force actions are timelocked (see anchor-mmf constants.rs); pause is not.
const TIMELOCK_FORCE_ACTION: i64 = 24 * 60 * 60;

// TimeLockOperation borsh discriminant for ForceTransfer.
const OP_FORCE_TRANSFER: u8 = 5;

// ---- small helpers ---------------------------------------------------------

fn disc(namespace: &str, name: &str) -> [u8; 8] {
    let mut h = Sha256::new();
    h.update(format!("{namespace}:{name}").as_bytes());
    let out = h.finalize();
    let mut d = [0u8; 8];
    d.copy_from_slice(&out[..8]);
    d
}

fn ix_disc(name: &str) -> [u8; 8] {
    disc("global", name)
}

fn pda(seeds: &[&[u8]], program: &Address) -> (Address, u8) {
    Address::find_program_address(seeds, program)
}

fn ata(owner: &Address, mint: &Address) -> Address {
    pda(
        &[owner.as_ref(), TOKEN_2022.as_ref(), mint.as_ref()],
        &ATA_PROGRAM,
    )
    .0
}

fn send(
    svm: &mut LiteSVM,
    ixs: &[Instruction],
    payer: &Address,
    signers: &[&Keypair],
) -> litesvm::types::TransactionResult {
    let bh = svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(ixs, Some(payer), signers, bh);
    svm.send_transaction(tx)
}

/// Token-2022/SPL token account: state byte at offset 108 (1 = Initialized,
/// 2 = Frozen), amount (u64 LE) at offset 64.
fn token_state(svm: &LiteSVM, addr: &Address) -> u8 {
    svm.get_account(addr).expect("token account exists").data[108]
}
fn token_amount(svm: &LiteSVM, addr: &Address) -> u64 {
    let data = svm.get_account(addr).expect("token account exists").data;
    u64::from_le_bytes(data[64..72].try_into().unwrap())
}

// ---- onboarding building blocks --------------------------------------------

/// ABL `add_wallet` (disc 2) onto the allow list, signed by the list authority.
fn add_wallet(admin: &Address, list_config: &Address, holder: &Address) -> Instruction {
    let wallet_entry = pda(
        &[b"wallet_entry", list_config.as_ref(), holder.as_ref()],
        &GATE,
    )
    .0;
    Instruction {
        program_id: GATE,
        accounts: vec![
            AccountMeta::new_readonly(*admin, true), // list authority
            AccountMeta::new(*admin, true),          // payer
            AccountMeta::new(*list_config, false),
            AccountMeta::new_readonly(*holder, false),
            AccountMeta::new(wallet_entry, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
        ],
        data: vec![2],
    }
}

/// ATA program CreateIdempotent (data = [1]); the new ATA is frozen by default.
fn create_ata(payer: &Address, owner: &Address, mint: &Address) -> Instruction {
    Instruction {
        program_id: ATA_PROGRAM,
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(ata(owner, mint), false),
            AccountMeta::new_readonly(*owner, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
            AccountMeta::new_readonly(TOKEN_2022, false),
        ],
        data: vec![1],
    }
}

/// Token ACL `thaw_permissionless` (disc 6). Remaining accounts are
/// `[thaw_extra_metas, list_config, wallet_entry]`, matching the resolver in
/// `token-acl/interface/src/onchain.rs`.
fn thaw_permissionless(
    admin: &Address,
    mint: &Address,
    holder: &Address,
    list_config: &Address,
) -> Instruction {
    let token_account = ata(holder, mint);
    let flag = pda(&[b"FLAG_ACCOUNT", token_account.as_ref()], &TOKEN_ACL).0;
    let mint_config = pda(&[b"MINT_CONFIG", mint.as_ref()], &TOKEN_ACL).0;
    let thaw_extra_metas = pda(&[b"thaw_extra_account_metas", mint.as_ref()], &GATE).0;
    let wallet_entry = pda(
        &[b"wallet_entry", list_config.as_ref(), holder.as_ref()],
        &GATE,
    )
    .0;
    Instruction {
        program_id: TOKEN_ACL,
        accounts: vec![
            AccountMeta::new(*admin, true), // authority + payer (drained flag rent)
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(token_account, false),
            AccountMeta::new(flag, false),
            AccountMeta::new_readonly(*holder, false), // token account owner
            AccountMeta::new_readonly(mint_config, false),
            AccountMeta::new_readonly(TOKEN_2022, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
            AccountMeta::new_readonly(GATE, false),
            // remaining (forwarded to the gate)
            AccountMeta::new_readonly(thaw_extra_metas, false),
            AccountMeta::new_readonly(*list_config, false),
            AccountMeta::new_readonly(wallet_entry, false),
        ],
        data: vec![6],
    }
}

/// hook `initialize_rate_limit_ix` - per-(mint, owner) counter PDA.
fn init_rate_limit(payer: &Address, owner: &Address, mint: &Address) -> Instruction {
    let rate_limit = pda(
        &[b"mmf-rate-limit", mint.as_ref(), owner.as_ref()],
        &HOOK,
    )
    .0;
    Instruction {
        program_id: HOOK,
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(*owner, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(rate_limit, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
        ],
        data: ix_disc("initialize_rate_limit_ix").to_vec(),
    }
}

/// Token-2022 `transfer_checked` (instruction 12) with the hook's extra
/// accounts appended in the canonical resolver order:
/// `[rate_config, rate_limit, hook_program, extra_account_meta_list]`.
fn transfer_checked(
    mint: &Address,
    src_owner: &Address,
    src_ata: &Address,
    dst_ata: &Address,
    amount: u64,
) -> Instruction {
    let rate_config = pda(&[b"mmf-rate-config", mint.as_ref()], &HOOK).0;
    let rate_limit = pda(
        &[b"mmf-rate-limit", mint.as_ref(), src_owner.as_ref()],
        &HOOK,
    )
    .0;
    let ealist = pda(&[b"extra-account-metas", mint.as_ref()], &HOOK).0;

    let mut data = vec![12u8];
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(DECIMALS);

    Instruction {
        program_id: TOKEN_2022,
        accounts: vec![
            AccountMeta::new(*src_ata, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(*dst_ata, false),
            AccountMeta::new_readonly(*src_owner, true),
            // hook extras
            AccountMeta::new_readonly(rate_config, false),
            AccountMeta::new(rate_limit, false),
            AccountMeta::new_readonly(HOOK, false),
            AccountMeta::new_readonly(ealist, false),
        ],
        data,
    }
}

/// The `TimeLock` proposal PDA for a (proposer, seed) pair.
fn proposal_pda(proposer: &Address, seed: u64) -> Address {
    pda(&[&seed.to_le_bytes(), proposer.as_ref()], &MMF_ADMIN).0
}

/// `create_timelock_proposal(seed, operation, action_data)` - the maker step.
fn create_proposal(
    proposer: &Address,
    role: &Address,
    seed: u64,
    operation: u8,
    action_data: &[u8],
) -> Instruction {
    let mut data = ix_disc("create_timelock_proposal").to_vec();
    data.extend_from_slice(&seed.to_le_bytes());
    data.push(operation);
    data.extend_from_slice(&(action_data.len() as u32).to_le_bytes()); // Vec<u8> borsh len
    data.extend_from_slice(action_data);
    Instruction {
        program_id: MMF_ADMIN,
        accounts: vec![
            AccountMeta::new(*proposer, true),
            AccountMeta::new_readonly(*role, false),
            AccountMeta::new(proposal_pda(proposer, seed), false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
        ],
        data,
    }
}

/// `respond_timelock_proposal` - the checker step (responder != proposer).
fn respond(responder: &Address, role: &Address, timelock: &Address) -> Instruction {
    Instruction {
        program_id: MMF_ADMIN,
        accounts: vec![
            AccountMeta::new_readonly(*responder, true),
            AccountMeta::new_readonly(*role, false),
            AccountMeta::new(*timelock, false),
        ],
        data: ix_disc("respond_timelock_proposal").to_vec(),
    }
}

/// Fast-forward the Clock sysvar past a timelock delay. Also advances the
/// blockhash so a post-delay transaction can never collide (by signature) with
/// an identical pre-delay attempt that litesvm would otherwise dedup.
fn warp(svm: &mut LiteSVM, seconds: i64) {
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp += seconds;
    svm.set_sysvar(&clock);
    svm.expire_blockhash();
}

/// mmf_admin `set_paused` - immediate, role-gated (ROLE_PAUSER), no timelock.
/// Drives the Token-2022 Pausable extension.
fn set_paused(
    admin: &Address,
    config: &Address,
    pauser_role: &Address,
    mint: &Address,
    paused: bool,
) -> Instruction {
    let mut data = ix_disc("set_paused").to_vec();
    data.push(paused as u8);
    Instruction {
        program_id: MMF_ADMIN,
        accounts: vec![
            AccountMeta::new(*admin, true),                 // pauser
            AccountMeta::new(*config, false),               // config (mut)
            AccountMeta::new_readonly(*pauser_role, false), // role (PAUSER)
            AccountMeta::new(*mint, false),                 // mint (mut)
            AccountMeta::new_readonly(TOKEN_2022, false),
        ],
        data,
    }
}

/// Token ACL authority `Freeze` (disc 5) - the **client-side** compliance
/// freeze of a holder's token account. `mmf_admin` has no freeze instruction:
/// the mint's freeze authority was delegated to the Token ACL `MintConfig`, and
/// the recorded authority (here, `admin`) drives freeze/thaw directly. This
/// CPIs Token-2022 `FreezeAccount` signed by the `MintConfig` PDA.
fn freeze_via_token_acl(admin: &Address, mint: &Address, token_account: &Address) -> Instruction {
    let mint_config = pda(&[b"MINT_CONFIG", mint.as_ref()], &TOKEN_ACL).0;
    Instruction {
        program_id: TOKEN_ACL,
        accounts: vec![
            AccountMeta::new_readonly(*admin, true), // authority (MintConfig.freeze_authority)
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(*token_account, false),
            AccountMeta::new_readonly(mint_config, false),
            AccountMeta::new_readonly(TOKEN_2022, false),
        ],
        data: vec![5],
    }
}

/// mmf_admin `force_transfer` - executes an accepted ForceTransfer proposal.
/// Carries the transfer hook's accounts; the hook skips rate limiting for the
/// permanent delegate.
fn force_transfer(
    admin: &Address,
    config: &Address,
    compliance_role: &Address,
    mint: &Address,
    from_ata: &Address,
    to_ata: &Address,
    timelock: &Address,
    amount: u64,
) -> Instruction {
    let rate_config = pda(&[b"mmf-rate-config", mint.as_ref()], &HOOK).0;
    // Keyed on the permanent delegate (Config PDA): non-existent, the hook skips it.
    let rate_limit = pda(&[b"mmf-rate-limit", mint.as_ref(), config.as_ref()], &HOOK).0;
    let ealist = pda(&[b"extra-account-metas", mint.as_ref()], &HOOK).0;
    // `#[event_cpi]` on ForceTransfer appends these two accounts (the event
    // authority PDA and the program itself) for the AssetSeizure self-CPI.
    let event_authority = pda(&[b"__event_authority"], &MMF_ADMIN).0;
    let mut data = ix_disc("force_transfer").to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: MMF_ADMIN,
        accounts: vec![
            AccountMeta::new(*admin, true),                     // delegate
            AccountMeta::new_readonly(*config, false),
            AccountMeta::new_readonly(*compliance_role, false), // role (COMPLIANCE)
            AccountMeta::new(*timelock, false),                 // timelock (mut)
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(*from_ata, false),
            AccountMeta::new(*to_ata, false),
            AccountMeta::new_readonly(TOKEN_2022, false),
            AccountMeta::new_readonly(HOOK, false),            // transfer_hook_program
            AccountMeta::new_readonly(ealist, false),          // hook_extra_account_meta_list
            AccountMeta::new_readonly(rate_config, false),     // hook_rate_config
            AccountMeta::new(rate_limit, false),               // hook_rate_limit (mut)
            AccountMeta::new_readonly(event_authority, false), // event_authority (#[event_cpi])
            AccountMeta::new_readonly(MMF_ADMIN, false),       // program (#[event_cpi])
        ],
        data,
    }
}

#[test]
fn token_acl_end_to_end() {
    let mut svm = LiteSVM::new();
    let dir = format!("{}/..", env!("CARGO_MANIFEST_DIR"));
    svm.add_program_from_file(MMF_ADMIN, format!("{dir}/../target/deploy/mmf_admin.so"))
        .unwrap();
    svm.add_program_from_file(HOOK, format!("{dir}/../target/deploy/mmf_transfer_hook.so"))
        .unwrap();
    svm.add_program_from_file(TOKEN_ACL, format!("{dir}/anchor-mmf/tests/fixtures/token_acl.so"))
        .unwrap();
    svm.add_program_from_file(GATE, format!("{dir}/anchor-mmf/tests/fixtures/token_acl_gate_program.so"))
        .unwrap();

    let admin = Keypair::new();
    let responder = Keypair::new(); // genesis maker/checker checker
    let holder_a = Keypair::new();
    let holder_b = Keypair::new();
    let mint_kp = Keypair::new();
    for kp in [&admin, &responder, &holder_a, &holder_b] {
        svm.airdrop(&kp.pubkey(), 100_000_000_000).unwrap();
    }
    let mint = mint_kp.pubkey();
    let config = pda(&[b"mmf-config"], &MMF_ADMIN).0;

    // Genesis role PDAs, granted by `initialize`: admin holds the operator
    // roles (proposer side); responder holds ROLE_RESPONDER (checker side).
    let role = |role_id: &[u8; 32], grantee: &Address| {
        pda(&[b"mmf-role", role_id, grantee.as_ref()], &MMF_ADMIN).0
    };
    let admin_minter = role(&ROLE_MINTER, &admin.pubkey());
    let admin_pauser = role(&ROLE_PAUSER, &admin.pubkey());
    let admin_compliance = role(&ROLE_COMPLIANCE_DELEGATE, &admin.pubkey());
    let responder_role = role(&ROLE_RESPONDER, &responder.pubkey());

    // 1. Issuer bootstrap: default-frozen MMF mint + genesis roles.
    let initialize = Instruction {
        program_id: MMF_ADMIN,
        accounts: vec![
            AccountMeta::new(admin.pubkey(), true),
            AccountMeta::new(config, false),
            AccountMeta::new(mint, true),
            AccountMeta::new_readonly(responder.pubkey(), false),
            AccountMeta::new(admin_minter, false),
            AccountMeta::new(admin_pauser, false),
            AccountMeta::new(admin_compliance, false),
            AccountMeta::new(responder_role, false),
            AccountMeta::new_readonly(HOOK, false),
            AccountMeta::new_readonly(TOKEN_2022, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
            AccountMeta::new_readonly(SYSVAR_RENT, false),
        ],
        data: ix_disc("initialize").to_vec(),
    };
    send(&mut svm, &[initialize], &admin.pubkey(), &[&admin, &mint_kp])
        .expect("initialize");

    // 2. Hook setup: extra-account-meta list + per-mint rate config.
    let ealist = pda(&[b"extra-account-metas", mint.as_ref()], &HOOK).0;
    let init_ealist = Instruction {
        program_id: HOOK,
        accounts: vec![
            AccountMeta::new(admin.pubkey(), true),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new(ealist, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
        ],
        data: ix_disc("initialize_extra_account_meta_list_ix").to_vec(),
    };
    let rate_config = pda(&[b"mmf-rate-config", mint.as_ref()], &HOOK).0;
    let init_rate_config = Instruction {
        program_id: HOOK,
        accounts: vec![
            AccountMeta::new(admin.pubkey(), true),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new(rate_config, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
        ],
        data: ix_disc("initialize_rate_config_ix").to_vec(),
    };
    send(&mut svm, &[init_ealist, init_rate_config], &admin.pubkey(), &[&admin])
        .expect("hook setup");

    // 3. Hand the mint's freeze authority to Token ACL + enable thaw.
    let mint_config = pda(&[b"MINT_CONFIG", mint.as_ref()], &TOKEN_ACL).0;
    let mut cc_data = vec![0u8];
    cc_data.extend_from_slice(GATE.as_ref());
    let create_config = Instruction {
        program_id: TOKEN_ACL,
        accounts: vec![
            AccountMeta::new(admin.pubkey(), true),          // payer
            AccountMeta::new_readonly(admin.pubkey(), true), // authority (freeze auth)
            AccountMeta::new(mint, false),
            AccountMeta::new(mint_config, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
            AccountMeta::new_readonly(TOKEN_2022, false),
        ],
        data: cc_data,
    };
    let toggle = Instruction {
        program_id: TOKEN_ACL,
        accounts: vec![
            AccountMeta::new_readonly(admin.pubkey(), true),
            AccountMeta::new(mint_config, false),
        ],
        data: vec![8, 0, 1], // freeze = off, thaw = on
    };
    send(&mut svm, &[create_config, toggle], &admin.pubkey(), &[&admin])
        .expect("token acl create_config + toggle");

    // 4. Create an Allow-mode list and bind it to the mint for thaw.
    let seed = [7u8; 32];
    let list_config = pda(&[b"list_config", admin.pubkey().as_ref(), &seed], &GATE).0;
    let mut cl_data = vec![1u8, 0u8]; // disc=1, mode=0 (Allow)
    cl_data.extend_from_slice(&seed);
    let create_list = Instruction {
        program_id: GATE,
        accounts: vec![
            AccountMeta::new_readonly(admin.pubkey(), true),
            AccountMeta::new(admin.pubkey(), true),
            AccountMeta::new(list_config, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
        ],
        data: cl_data,
    };
    let thaw_extra_metas = pda(&[b"thaw_extra_account_metas", mint.as_ref()], &GATE).0;
    let setup_extra_metas = Instruction {
        program_id: GATE,
        accounts: vec![
            AccountMeta::new_readonly(admin.pubkey(), true), // freeze authority
            AccountMeta::new(admin.pubkey(), true),          // payer
            AccountMeta::new_readonly(mint_config, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new(thaw_extra_metas, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
            AccountMeta::new_readonly(list_config, false), // the list to apply
        ],
        data: vec![4],
    };
    send(&mut svm, &[create_list, setup_extra_metas], &admin.pubkey(), &[&admin])
        .expect("gate create_list + setup_extra_metas");

    // 5. Onboard both holders: allowlist -> create (frozen) ATA -> thaw.
    for holder in [&holder_a, &holder_b] {
        let h = holder.pubkey();
        let h_ata = ata(&h, &mint);

        send(&mut svm, &[add_wallet(&admin.pubkey(), &list_config, &h)], &admin.pubkey(), &[&admin])
            .expect("add_wallet");
        send(&mut svm, &[create_ata(&admin.pubkey(), &h, &mint)], &admin.pubkey(), &[&admin])
            .expect("create ATA");

        assert_eq!(token_state(&svm, &h_ata), 2, "ATA should be frozen on creation");

        send(&mut svm, &[thaw_permissionless(&admin.pubkey(), &mint, &h, &list_config)], &admin.pubkey(), &[&admin])
            .expect("thaw_permissionless");

        assert_eq!(token_state(&svm, &h_ata), 1, "ATA should be thawed after Token ACL thaw");
    }

    // Per-owner rate-limit counter for the sender.
    send(&mut svm, &[init_rate_limit(&admin.pubkey(), &holder_a.pubkey(), &mint)], &admin.pubkey(), &[&admin])
        .expect("init_rate_limit");

    // The admin already holds ROLE_MINTER from the genesis grant - no set_role
    // needed here.
    let role_pda = admin_minter;

    // 7. Mint MMF to holder A (now that the ATA is thawed).
    let a_ata = ata(&holder_a.pubkey(), &mint);
    let mint_amount = 2_000_000u64;
    let mut mint_data = ix_disc("mint_mmf").to_vec();
    mint_data.extend_from_slice(&mint_amount.to_le_bytes());
    let mint_mmf = Instruction {
        program_id: MMF_ADMIN,
        accounts: vec![
            AccountMeta::new_readonly(admin.pubkey(), true), // minter
            AccountMeta::new(admin.pubkey(), true),          // payer
            AccountMeta::new_readonly(config, false),
            AccountMeta::new_readonly(role_pda, false),
            AccountMeta::new(mint, false),
            AccountMeta::new_readonly(holder_a.pubkey(), false),
            AccountMeta::new(a_ata, false),
            AccountMeta::new_readonly(TOKEN_2022, false),
            AccountMeta::new_readonly(ATA_PROGRAM, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
        ],
        data: mint_data,
    };
    send(&mut svm, &[mint_mmf], &admin.pubkey(), &[&admin]).expect("mint_mmf");
    assert_eq!(token_amount(&svm, &a_ata), mint_amount, "A should hold the minted amount");

    // 8. Transfer A -> B within the cap: succeeds and moves tokens.
    let b_ata = ata(&holder_b.pubkey(), &mint);
    let under = RATE_CAP - 400_000; // 600_000
    send(
        &mut svm,
        &[transfer_checked(&mint, &holder_a.pubkey(), &a_ata, &b_ata, under)],
        &holder_a.pubkey(),
        &[&holder_a],
    )
    .expect("transfer within cap");
    assert_eq!(token_amount(&svm, &b_ata), under, "B should have received the under-cap transfer");

    // 9. A second transfer that pushes the window total over the cap is
    //    rejected by the hook. A still has plenty of balance, so this is a
    //    genuine rate-limit rejection, not insufficient funds. The amount
    //    differs from the first transfer so the two transactions do not share
    //    a signature (which litesvm would dedup).
    let over = 500_000u64; // 600_000 + 500_000 > 1_000_000 cap
    let res = send(
        &mut svm,
        &[transfer_checked(&mint, &holder_a.pubkey(), &a_ata, &b_ata, over)],
        &holder_a.pubkey(),
        &[&holder_a],
    );
    let err = res.expect_err("transfer over cap must fail");
    assert!(
        err.meta.logs.iter().any(|l| l.contains("RateLimitExceeded")),
        "expected RateLimitExceeded, got logs:\n{}",
        err.meta.logs.join("\n")
    );
    // B's balance is unchanged by the rejected transfer.
    assert_eq!(token_amount(&svm, &b_ata), under, "rejected transfer must not move tokens");

    // 10. Force transfer through the maker/checker timelock - and NOT rate
    //     limited. `seize` exceeds the per-window cap, so a normal transfer of
    //     this size would always be `RateLimitExceeded`; the force path bypasses
    //     the hook (the authority is the permanent delegate). Propose -> respond
    //     (distinct key) -> wait out the delay -> execute.
    let seize = RATE_CAP + 200_000; // 1_200_000 > cap, <= A's balance (1.4M)
    let ft_seed = 1u64;
    let ft_proposal = proposal_pda(&admin.pubkey(), ft_seed);
    let mut ft_action = Vec::new();
    ft_action.extend_from_slice(a_ata.as_ref());
    ft_action.extend_from_slice(b_ata.as_ref());
    ft_action.extend_from_slice(&seize.to_le_bytes());
    send(
        &mut svm,
        &[create_proposal(&admin.pubkey(), &admin_compliance, ft_seed, OP_FORCE_TRANSFER, &ft_action)],
        &admin.pubkey(),
        &[&admin],
    )
    .expect("propose force_transfer");
    send(&mut svm, &[respond(&responder.pubkey(), &responder_role, &ft_proposal)], &responder.pubkey(), &[&responder])
        .expect("respond force_transfer");
    // A force_transfer before the delay elapses must fail.
    assert!(
        send(
            &mut svm,
            &[force_transfer(&admin.pubkey(), &config, &admin_compliance, &mint, &a_ata, &b_ata, &ft_proposal, seize)],
            &admin.pubkey(),
            &[&admin],
        )
        .is_err(),
        "force_transfer must not execute before the timelock delay"
    );
    warp(&mut svm, TIMELOCK_FORCE_ACTION + 1);
    send(
        &mut svm,
        &[force_transfer(&admin.pubkey(), &config, &admin_compliance, &mint, &a_ata, &b_ata, &ft_proposal, seize)],
        &admin.pubkey(),
        &[&admin],
    )
    .expect("force_transfer must bypass the rate limit");
    assert_eq!(
        token_amount(&svm, &b_ata),
        under + seize,
        "force transfer should move tokens despite the cap"
    );

    // 11. Pause is immediate (role-gated, no timelock): it's the circuit
    //     breaker. Pause -> a transfer is blocked at the protocol level ->
    //     resume -> a transfer goes through again.
    send(&mut svm, &[set_paused(&admin.pubkey(), &config, &admin_pauser, &mint, true)], &admin.pubkey(), &[&admin])
        .expect("pause");
    let b_before = token_amount(&svm, &b_ata);
    let paused_try = send(
        &mut svm,
        &[transfer_checked(&mint, &holder_a.pubkey(), &a_ata, &b_ata, 50_000)],
        &holder_a.pubkey(),
        &[&holder_a],
    );
    assert!(paused_try.is_err(), "transfers must fail while paused");
    assert_eq!(token_amount(&svm, &b_ata), b_before, "paused transfer must not move tokens");

    send(&mut svm, &[set_paused(&admin.pubkey(), &config, &admin_pauser, &mint, false)], &admin.pubkey(), &[&admin])
        .expect("resume");
    send(
        &mut svm,
        &[transfer_checked(&mint, &holder_a.pubkey(), &a_ata, &b_ata, 60_000)],
        &holder_a.pubkey(),
        &[&holder_a],
    )
    .expect("transfer after resume");
    assert_eq!(token_amount(&svm, &b_ata), b_before + 60_000, "resumed transfer should move tokens");

    // 12. Compliance freeze of a holder - a CLIENT-SIDE action, not an
    //     mmf_admin instruction. The mint's freeze authority is the Token ACL
    //     `MintConfig`; the recorded authority (admin) drives Token ACL's
    //     `Freeze`. Freezing B's account then blocks any transfer into it.
    send(&mut svm, &[freeze_via_token_acl(&admin.pubkey(), &mint, &b_ata)], &admin.pubkey(), &[&admin])
        .expect("freeze holder B via Token ACL");
    assert_eq!(token_state(&svm, &b_ata), 2, "B's account should be frozen");

    let b_frozen_balance = token_amount(&svm, &b_ata);
    let frozen_try = send(
        &mut svm,
        &[transfer_checked(&mint, &holder_a.pubkey(), &a_ata, &b_ata, 10_000)],
        &holder_a.pubkey(),
        &[&holder_a],
    );
    assert!(frozen_try.is_err(), "transfer into a frozen account must fail");
    assert_eq!(token_amount(&svm, &b_ata), b_frozen_balance, "frozen account must not change");
}
