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
//!      rejected by the transfer hook with `RateLimitExceeded`.
//!
//! All instructions are hand-built with `solana_instruction` so the test does
//! not depend on any program's generated client. Anchor instruction/account
//! discriminators are computed as `sha256("<ns>:<name>")[..8]`. The role
//! system has a bootstrapping gap (granting the first role needs a pre-existing
//! role), which is orthogonal to what this test exercises, so the granted
//! `ROLE_MINTER` PDA is injected directly into the SVM.

use litesvm::LiteSVM;
use sha2::{Digest, Sha256};
use solana_account::Account;
use solana_address::Address;
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

// MMF mint has 4 decimals; the hook's default cap is 1_000_000 base units.
const DECIMALS: u8 = 4;
const RATE_CAP: u64 = 1_000_000;

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
    let holder_a = Keypair::new();
    let holder_b = Keypair::new();
    let mint_kp = Keypair::new();
    for kp in [&admin, &holder_a, &holder_b] {
        svm.airdrop(&kp.pubkey(), 100_000_000_000).unwrap();
    }
    let mint = mint_kp.pubkey();
    let config = pda(&[b"mmf-config"], &MMF_ADMIN).0;

    // 1. Issuer bootstrap: create the default-frozen MMF mint.
    let initialize = Instruction {
        program_id: MMF_ADMIN,
        accounts: vec![
            AccountMeta::new(admin.pubkey(), true),
            AccountMeta::new(config, false),
            AccountMeta::new(mint, true),
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

    // 6. Inject a granted ROLE_MINTER PDA for the admin (bypasses role bootstrap).
    let (role_pda, role_bump) = pda(
        &[b"mmf-role", &ROLE_MINTER, admin.pubkey().as_ref()],
        &MMF_ADMIN,
    );
    let mut role_data = disc("account", "Role").to_vec();
    role_data.extend_from_slice(&ROLE_MINTER);
    role_data.extend_from_slice(admin.pubkey().as_ref());
    role_data.push(1); // granted
    role_data.push(role_bump);
    svm.set_account(
        role_pda,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(role_data.len()),
            data: role_data,
            owner: MMF_ADMIN,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

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
}
