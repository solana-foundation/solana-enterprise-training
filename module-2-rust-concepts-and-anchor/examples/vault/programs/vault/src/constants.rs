use anchor_lang::prelude::*;

#[constant]
pub const SEED: &str = "anchor";

#[constant]
pub const VAULT_SEED: &[u8] = b"vault"; //This is the seed used for deriving the vault account PDA. It should be a byte slice, and it can be any string or byte array that you choose. In this case, we use "vault" as the seed for simplicity.

#[constant]
pub const VAULT_AUTHORITY_SEED: &[u8] = b"authority"; //This is the seed used for deriving the vault authority account PDA. It should also be a byte slice, and it can be any string or byte array that you choose. In this case, we use "authority" as the seed for simplicity.