/**
 * Mints a real SPL token on Solana MAINNET with on-chain metadata whose
 * `name`/`symbol` contain a literal double-quote character (plus the
 * AppleScript injection payload), purely to test whether that character
 * survives unmodified through MoonPay's token search/list API.
 *
 * SAFETY NOTES:
 *  - This costs real SOL (mint account rent + metadata account rent +
 *    tx fees). Typically well under $1-2 total at current rent/fee levels.
 *  - Use a dedicated throwaway wallet with only a small amount of SOL
 *    (e.g. 0.02-0.05 SOL is more than enough for rent + fees) — never
 *    your main wallet's private key.
 *  - This creates a permanent, public on-chain token. It has 0 supply
 *    behavior implications (we mint the smallest amount to self, no
 *    liquidity pool, no listing) — it is inert other than having
 *    queryable metadata.
 *
 * Usage (either one):
 *   export SOLANA_PRIVATE_KEY="<base58 private key of a funded throwaway wallet>"
 *   export SOLANA_MNEMONIC="<12/24 word BIP39 mnemonic, e.g. from `mp wallet export`>"
 *   node mint_quote_token.mjs
 */

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  createV1,
  mintV1,
  mplTokenMetadata,
  TokenStandard,
} from '@metaplex-foundation/mpl-token-metadata';
import { mplToolbox } from '@metaplex-foundation/mpl-toolbox';
import {
  generateSigner,
  keypairIdentity,
  percentAmount,
} from '@metaplex-foundation/umi';
import bs58 from 'bs58';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// The literal payload we want to prove survives the API round-trip.
// Kept short since on-chain metadata name/symbol have length limits
// (name <= 32 bytes, symbol <= 10 bytes in the standard Metaplex schema).
const TOKEN_NAME = 'A"B';       // minimal proof: does a bare quote survive?
const TOKEN_SYMBOL = 'Q"T';     // symbol field, separately, has a tighter length cap

async function main() {
  const pk = process.env.SOLANA_PRIVATE_KEY;
  const mnemonic = process.env.SOLANA_MNEMONIC;
  if (!pk && !mnemonic) {
    console.error('Set SOLANA_PRIVATE_KEY (base58) or SOLANA_MNEMONIC (BIP39 phrase) for a funded throwaway wallet.');
    process.exit(1);
  }

  const umi = createUmi(RPC_URL);

  let secretKey;
  if (mnemonic) {
    // Standard Solana derivation path, m/44'/501'/0'/0' — matches what
    // most Solana wallets (and `mp wallet export`) use for the default account.
    if (!bip39.validateMnemonic(mnemonic)) {
      console.error('SOLANA_MNEMONIC does not look like a valid BIP39 mnemonic.');
      process.exit(1);
    }
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const derived = derivePath("m/44'/501'/0'/0'", seed.toString('hex'));
    secretKey = umi.eddsa.createKeypairFromSeed(derived.key).secretKey;
  } else {
    secretKey = bs58.decode(pk);
  }

  const signer = umi.eddsa.createKeypairFromSecretKey(secretKey);
  umi.use(keypairIdentity(signer));
  umi.use(mplTokenMetadata());
  umi.use(mplToolbox());

  console.log('Using wallet:', signer.publicKey.toString());

  const mint = generateSigner(umi);

  console.log('Creating mint + metadata account...');
  await createV1(umi, {
    mint,
    authority: umi.identity,
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    uri: '', // no off-chain JSON needed for this test
    sellerFeeBasisPoints: percentAmount(0),
    tokenStandard: TokenStandard.Fungible,
    decimals: 0,
  }).sendAndConfirm(umi);

  console.log('Minting 1 unit to self...');
  await mintV1(umi, {
    mint: mint.publicKey,
    authority: umi.identity,
    amount: 1,
    tokenOwner: umi.identity.publicKey,
    tokenStandard: TokenStandard.Fungible,
  }).sendAndConfirm(umi);

  console.log('\nDone.');
  console.log('Mint address:', mint.publicKey.toString());
  const chainFlag = RPC_URL.includes('devnet') ? 'solana-devnet' : 'solana';
  console.log('\nNow check MoonPay:');
  console.log(`  mp --json token search --query "${mint.publicKey.toString()}" --chain ${chainFlag} | jq '.items[0].symbol, .items[0].name'`);
  console.log(`  mp --json token retrieve --token "${mint.publicKey.toString()}" --chain ${chainFlag} | jq '.symbol, .name'`);
  console.log('\nIt may take a few minutes (or longer) for MoonPay\'s indexer to pick up a brand-new mint.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
