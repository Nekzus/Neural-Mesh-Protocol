/// <reference types="node" />
import { Buffer } from "node:buffer";
// @ts-ignore
import kyber from "crystals-kyber";

async function test() {
	try {
		console.log("Keys available in kyber:");
		console.log(Object.keys(kyber));

		// Generate keypair
		const pk_sk = kyber.KeyGen768();
		const pk = pk_sk[0];
		const sk = pk_sk[1];
		console.log("PK length:", pk.length);
		console.log("SK length:", sk.length);

		// Encapsulate
		const c_ss = kyber.Encrypt768(pk);
		const c = c_ss[0];
		const ss1 = c_ss[1];
		console.log("Ciphertext length:", c.length);
		console.log("SS1 (Encapsulator) length:", ss1.length);

		// Decapsulate
		const ss2 = kyber.Decrypt768(c, sk);
		console.log("SS2 (Decapsulator) length:", ss2.length);

		console.log("Matches?", Buffer.from(ss1).equals(Buffer.from(ss2)));
	} catch (e) {
		console.error(e);
	}
}
test();
