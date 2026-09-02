/**
 * LIOP Industrial Mock Dataset Generator
 *
 * Dynamically produces scaled datasets for Bank, Market, and Medical records
 * to support scale testing of Sandbox and Differential Privacy engines.
 */

// HFT Module re-exports (Phase 138)
export { generateHftSnapshot, generateStaticHftDataset } from "../hft/hft-dataset-generator.js";

export function generateBankDataset(scale: number): any[] {
	const holders = [
		"Elena Rodriguez",
		"Jameson Sterling",
		"Aiko Tanaka",
		"Mateo Silva",
		"Chloe Dupont",
		"Hans Müller",
		"Sofia Loren",
		"Yuki Sato",
		"Omar Farooq",
		"Maria Rossi",
	];
	const types = ["Checking", "Savings", "Investment"];
	const currencies = ["USD", "EUR", "JPY", "GBP"];
	const txDescriptions = [
		"ATM Withdrawal",
		"Payroll Deposit",
		"Interest Credit",
		"Stock Purchase",
		"Online Transfer",
		"Groceries",
		"Utility Bill",
	];
	const list: any[] = [];
	const statuses = ["CLEARED", "PENDING", "FLAGGED"] as const;
	const tiers = ["RETAIL", "PREMIUM", "WEALTH"] as const;

	// Always include the first 3 legacy records for compatibility
	list.push(
		{
			id: "ACC-9901",
			uuid: "acc-uuid-00000001-550e-8400-e29b-41d4a7164466",
			accountHolder: "Elena Rodriguez",
			accountType: "Checking",
			balance: 12450.75,
			currency: "USD",
			status: "CLEARED",
			openedAt: "2024-01-15T09:12:00.000Z",
			geoCoordinates: [51.5074, -0.1278], // London
			riskScore: 0.12,
			accountTier: "PREMIUM",
			isKycVerified: true,
			transactions: [
				{ txId: "TX-9901-1", timestamp: "2026-03-10T14:22:00.000Z", date: "2026-03-10", amount: -150.0, description: "ATM Withdrawal", category: "Cash", fee: 2.5, isInternational: false },
				{ txId: "TX-9901-2", timestamp: "2026-03-15T08:00:00.000Z", date: "2026-03-15", amount: 2500.0, description: "Payroll Deposit", category: "Income", fee: 0.0, isInternational: false },
			],
		},
		{
			id: "ACC-2210",
			uuid: "acc-uuid-00000002-550e-8400-e29b-41d4a7164466",
			accountHolder: "Jameson Sterling",
			accountType: "Savings",
			balance: 85600.2,
			currency: "USD",
			status: "CLEARED",
			openedAt: "2023-06-20T11:45:00.000Z",
			geoCoordinates: [40.7128, -74.006], // New York
			riskScore: 0.05,
			accountTier: "WEALTH",
			isKycVerified: true,
			transactions: [
				{ txId: "TX-2210-1", timestamp: "2026-02-01T00:01:00.000Z", date: "2026-02-01", amount: 500.0, description: "Interest Credit", category: "Interest", fee: 0.0, isInternational: false },
			],
		},
		{
			id: "ACC-5541",
			uuid: "acc-uuid-00000003-550e-8400-e29b-41d4a7164466",
			accountHolder: "Aiko Tanaka",
			accountType: "Investment",
			balance: 342100.0,
			currency: "JPY",
			status: "CLEARED",
			openedAt: "2022-11-04T15:30:00.000Z",
			geoCoordinates: [35.6762, 139.6503], // Tokyo
			riskScore: 0.18,
			accountTier: "WEALTH",
			isKycVerified: true,
			transactions: [
				{
					txId: "TX-5541-1",
					timestamp: "2026-03-20T10:15:00.000Z",
					date: "2026-03-20",
					amount: -50000.0,
					description: "Stock Purchase - NVDA",
					category: "Securities",
					fee: 15.0,
					isInternational: true,
				},
			],
		},
	);

	if (scale <= 1) return list;

	const targetCount = scale * 3;
	for (let i = 3; i < targetCount; i++) {
		const holder = holders[i % holders.length];
		const type = types[i % types.length];
		const currency = currencies[i % currencies.length];
		const balance = Number.parseFloat((Math.random() * 200000 + 100).toFixed(2));
		const status = statuses[i % statuses.length];
		const tier = tiers[i % tiers.length];
		const riskScore = Number.parseFloat(((i % 100) / 100).toFixed(2));
		const lat = 51.5074 + ((i % 50) - 25) * 0.05;
		const lon = -0.1278 + ((i % 50) - 25) * 0.05;

		const transactions: any[] = [];
		const txCount = (i % 3) + 1; // 1 to 3 transactions
		for (let t = 0; t < txCount; t++) {
			const txAmount = Number.parseFloat((Math.random() * 1000 - 500).toFixed(2));
			const date = `2026-03-${String(((t + i) % 28) + 1).padStart(2, "0")}`;
			const desc = txDescriptions[(t + i) % txDescriptions.length];
			transactions.push({
				txId: `TX-${1000 + i}-${t + 1}`,
				timestamp: `${date}T12:00:00.000Z`,
				date,
				amount: txAmount,
				description: desc,
				category: (t % 2 === 0) ? "Groceries" : "Online Transfer",
				fee: Number.parseFloat((Math.random() * 5).toFixed(2)),
				isInternational: i % 4 === 0,
			});
		}

		list.push({
			id: `ACC-${1000 + i}`,
			uuid: `acc-uuid-${i.toString(16).padStart(8, "0")}-550e-8400-e29b-41d4a7164466`,
			accountHolder: `${holder} #${i}`,
			accountType: type,
			balance,
			currency,
			status,
			openedAt: `202${(i % 5) + 1}-0${(i % 9) + 1}-15T10:00:00.000Z`,
			geoCoordinates: [Number.parseFloat(lat.toFixed(4)), Number.parseFloat(lon.toFixed(4))],
			riskScore,
			accountTier: tier,
			isKycVerified: i % 10 !== 0,
			transactions,
		});
	}
	return list;
}

export function generateMarketDataset(scale: number): any[] {
	const list: any[] = [];
	list.push(
		{
			ticker: "NXS",
			companyName: "Nekzus Digital",
			price: 442.1,
			change: "+1.2%",
			volume: "1.2M",
			peRatio: 28.5,
			marketCap: "$42B",
		},
		{
			ticker: "LIOP",
			companyName: "Protocol Foundries",
			price: 89.45,
			change: "+5.7%",
			volume: "850K",
			peRatio: null,
			marketCap: "$8.9B",
		},
		{
			ticker: "WASM",
			companyName: "Sandbox Systems",
			price: 156.2,
			change: "-0.4%",
			volume: "2.1M",
			peRatio: 12.3,
			marketCap: "$15B",
		},
	);

	if (scale <= 1) return list;

	const targetCount = scale * 3;
	const tickers = [
		"AAPL",
		"MSFT",
		"GOOGL",
		"AMZN",
		"META",
		"TSLA",
		"NVDA",
		"AMD",
		"NFLX",
		"INTC",
	];
	const companies = [
		"Apple Inc.",
		"Microsoft Corp.",
		"Alphabet Inc.",
		"Amazon.com Inc.",
		"Meta Platforms",
		"Tesla Inc.",
		"Nvidia Corp.",
		"Advanced Micro Devices",
		"Netflix Inc.",
		"Intel Corp.",
	];

	for (let i = 3; i < targetCount; i++) {
		const ticker = tickers[i % tickers.length];
		const company = companies[i % companies.length];
		const price = Number.parseFloat((Math.random() * 900 + 10).toFixed(2));
		const changeNum = Number.parseFloat((Math.random() * 10 - 5).toFixed(2));
		const change = `${changeNum >= 0 ? "+" : ""}${changeNum}%`;
		const volume = `${(Math.random() * 5 + 0.1).toFixed(1)}M`;
		const peRatio =
			i % 5 === 0
				? null
				: Number.parseFloat((Math.random() * 40 + 5).toFixed(1));
		const marketCap = `$${(Math.random() * 500 + 1).toFixed(1)}B`;

		list.push({
			ticker: `${ticker}-${i}`,
			companyName: `${company} #${i}`,
			price,
			change,
			volume,
			peRatio,
			marketCap,
		});
	}
	return list;
}

export function generateMedicalDataset(scale: number): any[] {
	const list: any[] = [];
	const admissionStatuses = ["INPATIENT", "OUTPATIENT", "DISCHARGED"] as const;

	list.push(
		{
			id: "PAT-7721",
			uuid: "pat-uuid-00000001-440e-9400-e29b-41d4a7164477",
			name: "Evelyn Reed",
			age: 42,
			bloodType: "O+",
			diagnosis: "Hypertension",
			admissionStatus: "OUTPATIENT",
			registeredAt: "2026-01-15T08:30:00.000Z",
			lastVisit: "2026-01-15",
			medications: ["Lisinopril", "Amlodipine"],
			vitals: { systolic: 142, diastolic: 92, heartRate: 76, tempCelsius: 36.6, spo2: 98 },
			labResults: { fastingGlucoseMgDl: 98, hba1cPercent: 5.4, totalCholesterolMgDl: 215 },
			clinicalRiskScore: 0.35,
		},
		{
			id: "PAT-1092",
			uuid: "pat-uuid-00000002-440e-9400-e29b-41d4a7164477",
			name: "Marcus Thorne",
			age: 58,
			bloodType: "A-",
			diagnosis: "Type 2 Diabetes",
			admissionStatus: "OUTPATIENT",
			registeredAt: "2026-02-20T10:15:00.000Z",
			lastVisit: "2026-02-20",
			medications: ["Metformin", "Glipizide"],
			vitals: { systolic: 130, diastolic: 84, heartRate: 72, tempCelsius: 36.8, spo2: 97 },
			labResults: { fastingGlucoseMgDl: 165, hba1cPercent: 7.8, totalCholesterolMgDl: 228 },
			clinicalRiskScore: 0.68,
		},
		{
			id: "PAT-4432",
			uuid: "pat-uuid-00000003-440e-9400-e29b-41d4a7164477",
			name: "Sarah Chen",
			age: 29,
			bloodType: "B+",
			diagnosis: "Acute Bronchitis",
			admissionStatus: "DISCHARGED",
			registeredAt: "2026-03-05T14:45:00.000Z",
			lastVisit: "2026-03-05",
			medications: ["Albuterol", "Amoxicillin"],
			vitals: { systolic: 118, diastolic: 75, heartRate: 88, tempCelsius: 37.8, spo2: 95 },
			labResults: { fastingGlucoseMgDl: 89, hba1cPercent: 4.9, totalCholesterolMgDl: 172 },
			clinicalRiskScore: 0.22,
		},
		{
			id: "PAT-8819",
			uuid: "pat-uuid-00000004-440e-9400-e29b-41d4a7164477",
			name: "Julian Vane",
			age: 65,
			bloodType: "AB+",
			diagnosis: "Osteoarthritis",
			admissionStatus: "OUTPATIENT",
			registeredAt: "2025-12-10T11:20:00.000Z",
			lastVisit: "2025-12-10",
			medications: ["Celecoxib", "Glucosamine"],
			vitals: { systolic: 138, diastolic: 88, heartRate: 68, tempCelsius: 36.5, spo2: 99 },
			labResults: { fastingGlucoseMgDl: 104, hba1cPercent: 5.6, totalCholesterolMgDl: 240 },
			clinicalRiskScore: 0.45,
		},
		{
			id: "PAT-9901",
			uuid: "pat-uuid-00000005-440e-9400-e29b-41d4a7164477",
			name: "Elena Rodriguez",
			age: 35,
			bloodType: "O-",
			diagnosis: "Hypertension",
			admissionStatus: "OUTPATIENT",
			registeredAt: "2026-03-25T09:00:00.000Z",
			lastVisit: "2026-03-25",
			medications: ["Metoprolol"],
			vitals: { systolic: 145, diastolic: 95, heartRate: 80, tempCelsius: 36.7, spo2: 98 },
			labResults: { fastingGlucoseMgDl: 92, hba1cPercent: 5.1, totalCholesterolMgDl: 198 },
			clinicalRiskScore: 0.40,
		},
	);

	if (scale <= 1) return list;

	const targetCount = scale * 5;
	const names = [
		"Evelyn Reed",
		"Marcus Thorne",
		"Sarah Chen",
		"Julian Vane",
		"Elena Rodriguez",
		"David Miller",
		"Emma Watson",
		"Lucas Grey",
		"Olivia Smith",
		"James Ward",
	];
	const bloodTypes = ["O+", "A-", "B+", "AB+", "O-", "A+", "B-", "AB-"];
	const diagnoses = [
		"Hypertension",
		"Type 2 Diabetes",
		"Acute Bronchitis",
		"Osteoarthritis",
		"Asthma",
		"Allergic Rhinitis",
		"Gastroesophageal Reflux",
	];
	const medicationsList = [
		["Lisinopril", "Amlodipine"],
		["Metformin", "Glipizide"],
		["Albuterol", "Amoxicillin"],
		["Celecoxib", "Glucosamine"],
		["Metoprolol"],
		["Fluticasone", "Montelukast"],
		["Omeprazole", "Famotidine"],
	];

	for (let i = 5; i < targetCount; i++) {
		const name = names[i % names.length];
		const age = (i % 70) + 18; // 18 to 87
		const bloodType = bloodTypes[i % bloodTypes.length];
		const diagnosis = diagnoses[i % diagnoses.length];
		const lastVisit = `2026-02-${String((i % 28) + 1).padStart(2, "0")}`;
		const medications = medicationsList[i % medicationsList.length];
		const admissionStatus = admissionStatuses[i % admissionStatuses.length];
		const systolic = 110 + (i % 50);
		const diastolic = 70 + (i % 30);
		const heartRate = 60 + (i % 40);
		const glucose = 75 + (i % 110);
		const hba1c = Number.parseFloat((4.5 + ((i % 50) / 10)).toFixed(1));
		const riskScore = Number.parseFloat((((i % 90) + 5) / 100).toFixed(2));

		list.push({
			id: `PAT-${8000 + i}`,
			uuid: `pat-uuid-${i.toString(16).padStart(8, "0")}-440e-9400-e29b-41d4a7164477`,
			name: `${name} #${i}`,
			age,
			bloodType,
			diagnosis,
			admissionStatus,
			registeredAt: `202${(i % 5) + 1}-0${(i % 9) + 1}-10T08:00:00.000Z`,
			lastVisit,
			medications,
			vitals: {
				systolic,
				diastolic,
				heartRate,
				tempCelsius: Number.parseFloat((36.4 + ((i % 15) / 10)).toFixed(1)),
				spo2: 95 + (i % 5),
			},
			labResults: {
				fastingGlucoseMgDl: glucose,
				hba1cPercent: hba1c,
				totalCholesterolMgDl: 150 + (i % 100),
			},
			clinicalRiskScore: riskScore,
		});
	}
	return list;
}
