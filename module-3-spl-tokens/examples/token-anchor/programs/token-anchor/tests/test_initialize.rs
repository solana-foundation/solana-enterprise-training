mod helpers;

use {
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

#[test]
fn test_initialize() {
    let (mut svm, payer, mint, program_id) = helpers::setup();
    
    let init_mint_instruction = helpers::get_initialize_instruction(&payer, &mint, program_id);

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[init_mint_instruction], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer, mint]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());
}
