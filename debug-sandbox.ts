import { WasiSandbox } from "./examples/demos/high-fidelity-demo/src/lib/wasi-sandbox.js";

async function run() {
    try {
        console.log("Running valid logic...");
        const payload = `
---BEGIN_LOGIC---
// Valid non-malicious logic
return { total: env.records.length };
---END_LOGIC---
`;
        const result = await WasiSandbox.execute(payload);
        console.log("Success:", result);
    } catch (e) {
        console.error("FAIL:", e);
    }
}

run();
