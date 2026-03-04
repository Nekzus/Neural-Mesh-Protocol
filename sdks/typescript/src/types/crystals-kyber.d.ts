declare module "crystals-kyber" {
	export function KeyGen768(): [Uint8Array, Uint8Array];
	export function Encrypt768(pk: Uint8Array): [Uint8Array, Uint8Array];
	export function Decrypt768(ct: Uint8Array, sk: Uint8Array): Uint8Array;
}
