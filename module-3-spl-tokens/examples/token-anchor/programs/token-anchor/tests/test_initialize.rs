
use {
    anchor_lang::{solana_program::instruction::Instruction, InstructionData, ToAccountMetas, system_program::ID as SYSTEM_PROGRAM_ID},
    anchor_spl::token::ID as TOKEN_PROGRAM_ID,
    litesvm::LiteSVM,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_keypair::Keypair,
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
    
    let instruction = Instruction::new_with_bytes(
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
    let msg = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer, mint]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());
}
