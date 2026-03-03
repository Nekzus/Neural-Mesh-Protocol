const vm = require("node:vm");

const recordsRaw = "[]";
const sandboxEnv = Object.create(null);
sandboxEnv.recordsRaw = recordsRaw;
const context = vm.createContext(sandboxEnv);

const compiledLogic = `
// Valid non-malicious logic
return { total: env.records.length };
`;

const wrappedLogic = `
(function() {
    try {
        const db = JSON.parse(recordsRaw);
        const env = { records: db };
        
        const __user_logic = function(env) {
            ${compiledLogic}
        };
        
        const userResult = __user_logic(env);
        if (userResult !== undefined) return userResult;
        
        return (typeof nmp_main === 'function') ? nmp_main(env) : "Execution completed successfully, but no data was returned by the script. Ensure you use 'return' at the end of your logic.";
    } catch(e) {
        return "RuntimeException: " + e.message;
    }
})();
`;

try {
    const r = vm.runInContext(wrappedLogic, context);
    console.log("SUCCESS:", r);
} catch (e) {
    console.error("FAIL:", e);
}
