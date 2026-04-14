
use {
    anchor_lang::{InstructionData, ToAccountMetas, solana_program::instruction::Instruction, system_program::ID as SYSTEM_PROGRAM_ID}, 
    anchor_spl::{associated_token::get_associated_token_address_with_program_id, token::ID as TOKEN_PROGRAM_ID, associated_token::ID as ASSOCIATED_TOKEN_PROGRAM_ID}, 
    litesvm::LiteSVM, 
    solana_keypair::Keypair, 
    solana_message::{Message, VersionedMessage}, 
    solana_signer::Signer, 
    solana_transaction::versioned::VersionedTransaction,
};

fn setup() -> (LiteSVM, Keypair, Keypair) {
    let program_id = token_anchor::id();
    let payer = Keypair::new();
    let mint = Keypair::new();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/token_anchor.so");
    svm.add_program(program_id, bytes).unwrap();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    (svm, payer, mint)
}

#[test]
fn test_initialize() {
    let program_id = token_anchor::id();
    let (mut svm, payer, mint) = setup();

    let destination = Keypair::new();
    let detination_ata = get_associated_token_address_with_program_id(&destination.pubkey(), &mint.pubkey(), &TOKEN_PROGRAM_ID);
    
    let init_instruction = Instruction::new_with_bytes(
        program_id,
        &token_anchor::instruction::InitToken{}.data(),
        token_anchor::accounts::InitToken{
            payer: payer.pubkey(),
            mint: mint.pubkey(),
            system_program: SYSTEM_PROGRAM_ID,
            token_program: TOKEN_PROGRAM_ID,
        }.to_account_metas(None),
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[init_instruction], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer, &mint]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());

    let mint_instruction = Instruction::new_with_bytes(
        program_id,
        &token_anchor::instruction::MintTokens{amount: 1_000_000}.data(),
        token_anchor::accounts::MintTokens{
            mint_authority: payer.pubkey(),
            destination: destination.pubkey(),
            destination_token_account: detination_ata,
            mint: mint.pubkey(),
            system_program: SYSTEM_PROGRAM_ID,
            token_program: TOKEN_PROGRAM_ID,
            associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
        }.to_account_metas(None),
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[mint_instruction], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());
}
