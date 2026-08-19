/**
 * 01-create-tbill.ts - Create the tokenized T-bill fund share.
 *
 * One mint, four Token-2022 extensions, zero custom programs:
 *
 *   - DefaultAccountState = Frozen  -> every new token account starts frozen;
 *     investors must be explicitly onboarded (thawed). This is the same
 *     allowlist model as sRFC-37 Token ACL, expressed as pure mint config.
 *   - PermanentDelegate             -> the issuer can move or burn any
 *     holder's tokens (court order, sanctions, redemption).
 *   - MetadataPointer + TokenMetadata -> name, symbol and a prospectus URI
 *     stored on the mint itself.
 *   - ScaledUiAmount                -> a NAV multiplier: raw balances never
 *     change, but every wallet displays balance x multiplier. Daily accrual
 *     without rebasing.
 *
 * On Ethereum each of these is bespoke Solidity; here they are fields
 * written at mint creation.
 */

import { generateKeyPairSigner, some } from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  AccountState,
  TOKEN_2022_PROGRAM_ADDRESS,
  getInitializeDefaultAccountStateInstruction,
  getInitializeMetadataPointerInstruction,
  getInitializeMintInstruction,
  getInitializePermanentDelegateInstruction,
  getInitializeScaledUiAmountMintInstruction,
  getInitializeTokenMetadataInstruction,
  getMintSize,
} from "@solana-program/token-2022";
import { DECIMALS, ensureFunded, loadIssuer, rpc, sendInstructions, writeState } from "./helpers.js";

const NAME = "US Treasury Bill Fund Share";
const SYMBOL = "TBIL";
const URI = "https://example.com/tbil/prospectus.json";

const issuer = await loadIssuer();
console.log(`Issuer (mint authority, freeze authority, permanent delegate): ${issuer.address}`);
await ensureFunded(issuer.address);

const mint = await generateKeyPairSigner();
console.log(`Mint: ${mint.address}`);

// ---------------------------------------------------------------------------
// Size and rent: the account is created with space for the fixed extensions;
// TokenMetadata is variable-length and added post-init, paid from the mint's
// lamports - so we fund rent for the full size up front.
// ---------------------------------------------------------------------------

const fixedExtensions = [
  { __kind: "DefaultAccountState", state: AccountState.Frozen },
  { __kind: "PermanentDelegate", delegate: issuer.address },
  { __kind: "MetadataPointer", authority: some(issuer.address), metadataAddress: some(mint.address) },
  {
    __kind: "ScaledUiAmountConfig",
    authority: issuer.address,
    multiplier: 1.0,
    newMultiplierEffectiveTimestamp: 0n,
    newMultiplier: 1.0,
  },
] as const;

const fixedSpace = BigInt(getMintSize([...fixedExtensions]));
const fullSpace = BigInt(
  getMintSize([
    ...fixedExtensions,
    {
      __kind: "TokenMetadata",
      updateAuthority: some(issuer.address),
      mint: mint.address,
      name: NAME,
      symbol: SYMBOL,
      uri: URI,
      additionalMetadata: new Map<string, string>(),
    },
  ]),
);
const rent = await rpc.getMinimumBalanceForRentExemption(fullSpace).send();

// ---------------------------------------------------------------------------
// One atomic transaction: create account, configure extensions, init mint,
// then write the metadata.
// ---------------------------------------------------------------------------

await sendInstructions(issuer, [
  getCreateAccountInstruction({
    payer: issuer,
    newAccount: mint,
    space: fixedSpace,
    lamports: rent,
    programAddress: TOKEN_2022_PROGRAM_ADDRESS,
  }),
  // Extension config must come before initializeMint.
  getInitializeDefaultAccountStateInstruction({ mint: mint.address, state: AccountState.Frozen }),
  getInitializePermanentDelegateInstruction({ mint: mint.address, delegate: issuer.address }),
  getInitializeMetadataPointerInstruction({
    mint: mint.address,
    authority: some(issuer.address),
    metadataAddress: some(mint.address), // metadata lives on the mint itself
  }),
  getInitializeScaledUiAmountMintInstruction({
    mint: mint.address,
    authority: some(issuer.address),
    multiplier: 1.0, // NAV starts at 1.0000
  }),
  getInitializeMintInstruction({
    mint: mint.address,
    decimals: DECIMALS,
    mintAuthority: issuer.address,
    freezeAuthority: issuer.address,
  }),
  // TokenMetadata is written after the mint exists.
  getInitializeTokenMetadataInstruction({
    metadata: mint.address,
    updateAuthority: issuer.address,
    mint: mint.address,
    mintAuthority: issuer,
    name: NAME,
    symbol: SYMBOL,
    uri: URI,
  }),
]);

writeState({ mint: mint.address });
console.log(`Created ${SYMBOL} (${NAME})`);
console.log("New token accounts start FROZEN - investors must be onboarded before they can hold it.");
