use {
    anchor_lang::{
        Id, InstructionData, ToAccountMetas,
        solana_program::instruction::{AccountMeta, Instruction},
        system_program::ID as SYSTEM_PROGRAM_ID,
    },
    anchor_spl::{
        associated_token::{
            spl_associated_token_account,
            get_associated_token_address_with_program_id,
        },
        token_2022::{Token2022, spl_token_2022},
    },
    litesvm::LiteSVM,
    solana_keypair::{Address, Keypair},
    solana_message::{Message, VersionedMessage},
    solana_pubkey::Pubkey,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

pub fn setup() -> (LiteSVM, Keypair, Address) {
    let program_id = transfer_hook_frontier::id();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../../target/deploy/transfer_hook_frontier.so");
    svm.add_program(program_id, bytes).unwrap();

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();

    (svm, payer, program_id)
}

pub fn send_ix(svm: &mut LiteSVM, ix: Instruction, payer: &Keypair, signers: &[&Keypair]) {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    svm.send_transaction(tx).unwrap();
}

pub fn initialize_mint(svm: &mut LiteSVM, payer: &Keypair, mint: &Keypair, program_id: &Address) {
    let ix = Instruction::new_with_bytes(
        *program_id,
        &transfer_hook_frontier::instruction::InitializeMint {}.data(),
        transfer_hook_frontier::accounts::InitializeMint {
            payer: payer.pubkey(),
            mint: mint.pubkey(),
            system_program: SYSTEM_PROGRAM_ID,
            token_program: Token2022::id(),
        }.to_account_metas(None),
    );
    send_ix(svm, ix, payer, &[payer, mint]);
}

pub fn initialize_rate_limit(svm: &mut LiteSVM, payer: &Keypair, mint: &Keypair, program_id: &Address) {
    let rate_limit = Pubkey::find_program_address(
        &[b"rate_limit", mint.pubkey().as_ref(), payer.pubkey().as_ref()],
        program_id,
    ).0;

    let ix = Instruction::new_with_bytes(
        *program_id,
        &transfer_hook_frontier::instruction::Initialize {}.data(),
        transfer_hook_frontier::accounts::Initialize {
            payer: payer.pubkey(),
            mint: mint.pubkey(),
            rate_limit,
            system_program: SYSTEM_PROGRAM_ID,
        }.to_account_metas(None),
    );
    send_ix(svm, ix, payer, &[payer]);
}

pub fn initialize_extra_account_metas(svm: &mut LiteSVM, payer: &Keypair, mint: &Keypair, program_id: &Address) {
    let extra_account_meta_list = Pubkey::find_program_address(
        &[b"extra-account-metas", mint.pubkey().as_ref()],
        program_id,
    ).0;

    let ix = Instruction::new_with_bytes(
        *program_id,
        &transfer_hook_frontier::instruction::InitializeExtraAccountMetaList {}.data(),
        transfer_hook_frontier::accounts::InitializeExtraAccountMetaList {
            payer: payer.pubkey(),
            mint: mint.pubkey(),
            extra_account_meta_list,
            system_program: SYSTEM_PROGRAM_ID,
        }.to_account_metas(None),
    );
    send_ix(svm, ix, payer, &[payer]);
}

pub fn setup_mint_and_extra_metas(svm: &mut LiteSVM, payer: &Keypair, mint: &Keypair, program_id: &Address) {
    initialize_mint(svm, payer, mint, program_id);
    initialize_rate_limit(svm, payer, mint, program_id);
    initialize_extra_account_metas(svm, payer, mint, program_id);
}

pub fn create_ata(svm: &mut LiteSVM, payer: &Keypair, wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
    let ata = get_associated_token_address_with_program_id(wallet, mint, &Token2022::id());
    let ix = spl_associated_token_account::instruction::create_associated_token_account(
        &payer.pubkey(),
        wallet,
        mint,
        &Token2022::id(),
    );
    send_ix(svm, ix, payer, &[payer]);
    ata
}

pub fn mint_tokens(svm: &mut LiteSVM, payer: &Keypair, mint: &Pubkey, dest: &Pubkey, amount: u64) {
    let ix = spl_token_2022::instruction::mint_to(
        &Token2022::id(),
        mint,
        dest,
        &payer.pubkey(),
        &[],
        amount,
    ).unwrap();
    send_ix(svm, ix, payer, &[payer]);
}

pub fn build_transfer_with_hook_ix(
    source_ata: &Pubkey,
    dest_ata: &Pubkey,
    mint: &Pubkey,
    owner: &Pubkey,
    program_id: &Address,
    amount: u64,
    decimals: u8,
) -> Instruction {
    let mut ix = spl_token_2022::instruction::transfer_checked(
        &Token2022::id(),
        source_ata,
        mint,
        dest_ata,
        owner,
        &[],
        amount,
        decimals,
    ).unwrap();

    let extra_account_meta_list = Pubkey::find_program_address(
        &[b"extra-account-metas", mint.as_ref()],
        program_id,
    ).0;

    let rate_limit = Pubkey::find_program_address(
        &[b"rate_limit", mint.as_ref(), owner.as_ref()],
        program_id,
    ).0;

    ix.accounts.push(AccountMeta::new_readonly(*program_id, false));
    ix.accounts.push(AccountMeta::new_readonly(extra_account_meta_list, false));
    ix.accounts.push(AccountMeta::new(rate_limit, false));

    ix
}
