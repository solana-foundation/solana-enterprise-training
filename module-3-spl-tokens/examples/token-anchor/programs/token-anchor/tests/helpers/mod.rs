/**
 * Helper functions for token-anchor tests.
 */

 use {
    anchor_lang::{
        InstructionData, ToAccountMetas,
        solana_program::instruction::Instruction,
        system_program::ID as SYSTEM_PROGRAM_ID,
    },
    anchor_spl::{
        associated_token::{
            get_associated_token_address_with_program_id,
        },
        token::ID as TOKEN_PROGRAM_ID,
        associated_token::ID as ASSOCIATED_TOKEN_PROGRAM_ID,
    },
    litesvm::LiteSVM,
    solana_keypair::{Address, Keypair},
    solana_signer::Signer,
};

pub fn setup() -> (LiteSVM, Keypair, Keypair, Address) {
    let program_id = token_anchor::id();
    let payer = Keypair::new();
    let mint = Keypair::new();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../../target/deploy/token_anchor.so");
    svm.add_program(program_id, bytes).unwrap();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    (svm, payer, mint, program_id)
}

pub fn get_initialize_instruction(payer: &Keypair, mint: &Keypair, program_id: Address) -> Instruction {
    Instruction::new_with_bytes(
        program_id,
        &token_anchor::instruction::InitToken{}.data(),
        token_anchor::accounts::InitToken{
            payer: payer.pubkey(),
            mint: mint.pubkey(),
            system_program: SYSTEM_PROGRAM_ID,
            token_program: TOKEN_PROGRAM_ID,
        }.to_account_metas(None),
    )
}

pub fn get_mint_instruction(authority: &Keypair, mint: &Keypair, destination: &Address,program_id: Address, amount: u64) -> Instruction {
    Instruction::new_with_bytes(
        program_id,
        &token_anchor::instruction::MintTokens{amount}.data(),
        token_anchor::accounts::MintTokens{
            mint_authority: authority.pubkey(),
            destination: *destination,
            destination_token_account: get_associated_token_address_with_program_id(destination, &mint.pubkey(), &TOKEN_PROGRAM_ID),
            mint: mint.pubkey(),
            system_program: SYSTEM_PROGRAM_ID,
            token_program: TOKEN_PROGRAM_ID,
            associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
        }.to_account_metas(None),
    )
}