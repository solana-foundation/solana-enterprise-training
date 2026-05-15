use anchor_lang::{
    solana_program::instruction::Instruction, AccountDeserialize, InstructionData, ToAccountMetas,
};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_program_option::COption;
use solana_program_pack::Pack;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;
use spl_associated_token_account_interface::address::get_associated_token_address;
use spl_token_interface::{
    state::{Account as TokenAccount, AccountState, Mint},
    ID as TOKEN_PROGRAM_ID,
};

fn setup_mint(svm: &mut LiteSVM, mint: &Keypair, authority: &Pubkey, decimals: u8) {
    let state = Mint {
        mint_authority: COption::Some(*authority),
        supply: 0,
        decimals,
        is_initialized: true,
        freeze_authority: COption::None,
    };
    let mut data = [0u8; Mint::LEN];
    Mint::pack(state, &mut data).unwrap();
    svm.set_account(
        mint.pubkey(),
        Account {
            lamports: 1_000_000_000,
            data: data.to_vec(),
            owner: TOKEN_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

fn setup_token_account(
    svm: &mut LiteSVM,
    address: Pubkey,
    mint: Pubkey,
    owner: Pubkey,
    amount: u64,
) {
    let state = TokenAccount {
        mint,
        owner,
        amount,
        delegate: COption::None,
        state: AccountState::Initialized,
        is_native: COption::None,
        delegated_amount: 0,
        close_authority: COption::None,
    };
    let mut data = [0u8; TokenAccount::LEN];
    TokenAccount::pack(state, &mut data).unwrap();
    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data: data.to_vec(),
            owner: TOKEN_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

#[test]
fn test_make() {
    let program_id = escrow::id();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/escrow.so");
    svm.add_program(program_id, bytes).unwrap();

    let maker = Keypair::new();
    let mint_a = Keypair::new();
    let mint_b = Keypair::new();

    let maker_pk = maker.pubkey();
    let mint_a_pk = mint_a.pubkey();
    let mint_b_pk = mint_b.pubkey();

    svm.airdrop(&maker_pk, 10_000_000_000).unwrap();

    setup_mint(&mut svm, &mint_a, &maker_pk, 6);
    setup_mint(&mut svm, &mint_b, &maker_pk, 6);

    let seed: u16 = 42;
    let amount_a: u64 = 1_000_000;
    let amount_b: u64 = 500_000;

    // Pre-create maker's ATA for mint_a with the tokens to be deposited
    let maker_ata_a = get_associated_token_address(&maker_pk, &mint_a_pk);
    setup_token_account(&mut svm, maker_ata_a, mint_a_pk, maker_pk, amount_a);

    // Derive escrow PDA and vault ATA (vault is created by the instruction, not pre-created)
    let (escrow_pda, _bump) = Pubkey::find_program_address(
        &[b"escrow", maker_pk.as_ref(), &seed.to_le_bytes()],
        &program_id,
    );
    let vault_a = get_associated_token_address(&escrow_pda, &mint_a_pk);

    let instruction = Instruction::new_with_bytes(
        program_id,
        &escrow::instruction::Make {
            seed,
            amount_a,
            amount_b,
        }
        .data(),
        escrow::accounts::Make {
            maker: maker_pk,
            mint_a: mint_a_pk,
            mint_b: mint_b_pk,
            escrow: escrow_pda,
            maker_ata_a,
            vault_a,
            system_program: anchor_lang::system_program::ID,
            token_program: TOKEN_PROGRAM_ID,
            associated_token_program: spl_associated_token_account_interface::program::ID,
        }
        .to_account_metas(None),
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[instruction], Some(&maker_pk), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[maker]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "make transaction failed: {:?}", res.err());

    // Verify vault received amount_a tokens and is owned by the escrow PDA
    let vault_account = svm.get_account(&vault_a).unwrap();
    let vault_token = TokenAccount::unpack(&vault_account.data).unwrap();
    assert_eq!(vault_token.amount, amount_a);
    assert_eq!(vault_token.mint, mint_a_pk);
    assert_eq!(vault_token.owner, escrow_pda);

    // Verify escrow account was populated correctly
    let escrow_raw = svm.get_account(&escrow_pda).unwrap();
    let escrow_state =
        escrow::Escrow::try_deserialize(&mut escrow_raw.data.as_slice()).unwrap();
    assert_eq!(escrow_state.maker, maker_pk);
    assert_eq!(escrow_state.mint_a, mint_a_pk);
    assert_eq!(escrow_state.mint_b, mint_b_pk);
    assert_eq!(escrow_state.amount_a, amount_a);
    assert_eq!(escrow_state.amount_b, amount_b);
}
