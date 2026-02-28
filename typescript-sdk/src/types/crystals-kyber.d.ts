declare module "crystals-kyber" {
    /**
     * Encrypts a shared secret using a Kyber768 public key
     * @param publicKey The 1184-byte public key
     * @returns A tuple of `[ciphertext, sharedSecret]`
     */
    export function Encrypt768(publicKey: Uint8Array): [Uint8Array, Uint8Array];

    /**
     * Decrypts a shared secret using a Kyber768 private key
     * @param ciphertext The 1088-byte encapsulated ciphertext
     * @param privateKey The 2400-byte private key
     * @returns The decapsulated shared secret
     */
    export function Decrypt768(ciphertext: Uint8Array, privateKey: Uint8Array): Uint8Array;

    /**
     * Generates a Kyber768 keypair
     * @returns A tuple of `[publicKey, privateKey]`
     */
    export function KeyGen768(): [Uint8Array, Uint8Array];
}
