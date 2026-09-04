async function test() {
	const tools = [
		{
			tool: "Analyze_HFT_Market_Data",
			logic: "@LIOP{wasi_v1,Hft}\nconst ticks = env.records;\nreturn { count: ticks.length };\n@END",
		},
		{
			tool: "Analyze_Synthetic_Bank_Transactions",
			logic: "@LIOP{wasi_v1,Bank}\nconst records = env.records;\nreturn { count: records.length };\n@END",
		},
		{
			tool: "Analyze_Synthetic_Medical_Records",
			logic: "@LIOP{wasi_v1,Vault}\nconst records = env.records;\nreturn { count: records.length };\n@END",
		},
		{
			tool: "Analyze_IoT_Sensor_Data",
			logic: "@LIOP{wasi_v1,Edge}\nconst records = env.records;\nreturn { count: records.length };\n@END",
		},
		{
			tool: "BLG_Inspect_Enclave_Perimeter",
			logic: "@LIOP{wasi_v1,BLG}\nreturn { test: true };\n@END",
		},
	];

	for (const t of tools) {
		console.log(`[TEST] Testing ${t.tool}...`);
		for (let i = 0; i < 5; i++) {
			try {
				const res = await fetch("http://localhost:3000/api/execute", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(t),
				});
				const text = await res.text();
				const hasError = text.includes('"type":"error"');
				if (hasError) {
					const errLine = text.split("\n").find((l) => l.includes('"type":"error"'));
					console.error(`  FAIL [${i}]: ${errLine}`);
				} else {
					process.stdout.write(`  PASS [${i}] `);
				}
			} catch (err: unknown) {
				console.error(`  FETCH_ERR [${i}]: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
		console.log("\n");
	}
}

test().catch(console.error);
