mod helpers;

use { 
    solana_keypair::Keypair, solana_message::{Message, VersionedMessage}, solana_signer::Signer, solana_transaction::versioned::VersionedTransaction
};

#[test]
fn test_mint() {
    let (mut svm, payer, mint, program_id) = helpers::setup();
    
    let init_instruction = helpers::get_initialize_instruction(&payer, &mint, program_id);

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[init_instruction], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer, &mint]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());

    let destination = Keypair::new().pubkey();
    let mint_instruction = helpers::get_mint_instruction(&payer, &mint, &destination, program_id, 1_000_000);

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[mint_instruction], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());
}
