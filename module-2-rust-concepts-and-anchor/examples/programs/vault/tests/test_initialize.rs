
use {
    anchor_lang::{InstructionData, ToAccountMetas, solana_program::instruction::Instruction, system_program::ID as SYSTEM_PROGRAM_ID}, 
    litesvm::LiteSVM, 
    solana_keypair::{Keypair, Address}, 
    solana_message::{Message, VersionedMessage}, 
    solana_signer::Signer, 
    solana_transaction::versioned::VersionedTransaction,
    solana_pubkey::Pubkey,

};

fn setup() -> (LiteSVM, Keypair, Address) {
    // Initialize the LiteSVM and add the vault program
    let program_id = vault::id();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/vault.so");
    svm.add_program(program_id, bytes).unwrap();

    // Airdrop some SOL to the payer to cover transaction fees and rent-exempt balance for the vault account
    // The amount of 1_000_000_000 lamports (1 SOL) is sufficient for this test, but you can adjust it as needed
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();

    // Return the initialized LiteSVM, the payer keypair, and the program ID for use in the test
    (svm, payer, program_id)
}

#[test]
fn test_initialize() {
    // Set up the LiteSVM, the payer, and the program ID for the vault program
    let (mut svm, payer, program_id) = setup();

    // Derive the vault account PDA using the same seeds as in the program
    let payer_binding = payer.pubkey();
    let vault_seeds = &[b"vault", payer_binding.as_ref()];
    let vault = Pubkey::find_program_address(vault_seeds, &program_id).0;

    // Derive the vault authority PDA using the same seeds as in the program
    let vault_authority_seeds = &[b"authority", vault.as_ref()];
    let vault_authority = Pubkey::find_program_address(vault_authority_seeds, &program_id).0;
    
    // Create the instruction to call the initialize function of the vault program
    // We need to specify the program ID, the instruction data (which is empty for the initialize function), and the accounts involved in the instruction
    let instruction = Instruction::new_with_bytes(
        program_id,
        &vault::instruction::Initialize {}.data(),
        vault::accounts::Initialize {
            user: payer.pubkey(),
            vault,
            vault_authority,
            system_program: SYSTEM_PROGRAM_ID
        }.to_account_metas(None),
    );

    // Create the transaction to call the initialize function
    // We need to specify the instruction, the payer as the signer, and the latest blockhash for the transaction
    // The latest blockhash retrieval is necessary to ensure the transaction is valid and can be processed by the network
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();

    // Send the transaction to the LiteSVM and check the result
    let res = svm.send_transaction(tx);
    assert!(res.is_ok());
}
