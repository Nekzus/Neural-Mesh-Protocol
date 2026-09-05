// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * LIOP NER Content Scanner (The Shield V3 — Named Entity Recognition Layer)
 *
 * Lightweight NER scanner using `compromise` NLP for detecting
 * person names, places, and organizations in free-text output values.
 *
 * This layer operates AFTER the regex-based PII scanner and
 * catches entities that lack a deterministic format pattern
 * (e.g., "Evelyn Reed" cannot be detected by regex).
 *
 * Architecture: opt-in per-server via `enableNerScanning: true`.
 * Performance: ~10ms for typical SDK output sizes (< 10KB).
 *
 * @see https://github.com/spencermountain/compromise
 */
// Types for compromise (minimal)
type NlpDoc = {
	people: () => { out: (type: string) => string[] };
	places: () => { out: (type: string) => string[] };
	organizations: () => { out: (type: string) => string[] };
};
type NlpStatic = ((text: string) => NlpDoc) & {
	addWords: (words: Record<string, string>) => void;
};

/**
 * Medical/pharmaceutical vocabulary safelist.
 * These terms are tagged as #Medication to prevent the NER
 * from misclassifying them as person/organization names.
 * Extends progressively — add terms as false positives arise.
 */
const MEDICAL_VOCABULARY: Record<string, string> = {
	aspirin: "Medication",
	lisinopril: "Medication",
	metformin: "Medication",
	amlodipine: "Medication",
	atorvastatin: "Medication",
	omeprazole: "Medication",
	losartan: "Medication",
	simvastatin: "Medication",
	levothyroxine: "Medication",
	ibuprofen: "Medication",
	acetaminophen: "Medication",
	amoxicillin: "Medication",
	ciprofloxacin: "Medication",
	prednisone: "Medication",
	warfarin: "Medication",
	insulin: "Medication",
	hydrochlorothiazide: "Medication",
	gabapentin: "Medication",
	albuterol: "Medication",
	pantoprazole: "Medication",
	// Generic clinical terms
	hypertension: "Condition",
	diabetes: "Condition",
	bronchitis: "Condition",
	pneumonia: "Condition",
	asthma: "Condition",
};

/** Single named entity detected by the NER scanner. */
export interface NerEntity {
	type: "person" | "place" | "organization";
	text: string;
}

/** Result of an NER scan operation. */
export interface NerScanResult {
	detected: boolean;
	entities: NerEntity[];
}

// Minimum string length to attempt NER analysis.
// Shorter strings are unlikely to contain meaningful named entities.
const MIN_TEXT_LENGTH = 4;

// Pattern to identify strings that are purely numeric/symbolic (skip NER)
const NON_TEXT_PATTERN = /^[\d\s.,:;!?()[\]{}<>@#$%^&*+=|\\/"'`~_-]+$/;

/**
 * Scans text content for named entities that may represent PII.
 * Uses `compromise/three` for person, place, and organization detection.
 *
 * Designed for egress filtering — optimized for recall over precision
 * to ensure sensitive data does not leak through aliased output keys.
 */
export class NerScanner {
	private static nlp: NlpStatic | null = null;

	/**
	 * Lazy loads the compromise library only when needed.
	 */
	private async getNlp(): Promise<NlpStatic> {
		if (!NerScanner.nlp) {
			// biome-ignore lint/suspicious/noExplicitAny: dynamic import of optional dependency
			const mod = (await import("compromise/three")) as any;
			// compromise export can vary depending on bundling
			NerScanner.nlp = (mod.default || mod) as NlpStatic;
			NerScanner.nlp.addWords(MEDICAL_VOCABULARY);
		}
		return NerScanner.nlp;
	}

	/**
	 * Scans a single string value for named entities.
	 * Returns detected entities if the text contains recognizable PII.
	 */
	async scan(text: string): Promise<NerScanResult> {
		if (text.length < MIN_TEXT_LENGTH || NON_TEXT_PATTERN.test(text)) {
			return { detected: false, entities: [] };
		}

		const nlp = await this.getNlp();
		const doc = nlp(text);
		const entities: NerEntity[] = [];

		const people = doc.people().out("array");
		for (const person of people) {
			const trimmed = person.trim();
			if (trimmed.length >= MIN_TEXT_LENGTH) {
				entities.push({ type: "person", text: trimmed });
			}
		}

		const places = doc.places().out("array");
		for (const place of places) {
			const trimmed = place.trim();
			if (trimmed.length >= MIN_TEXT_LENGTH) {
				entities.push({ type: "place", text: trimmed });
			}
		}

		const orgs = doc.organizations().out("array");
		for (const org of orgs) {
			const trimmed = org.trim();
			if (trimmed.length >= MIN_TEXT_LENGTH) {
				entities.push({ type: "organization", text: trimmed });
			}
		}

		return {
			detected: entities.length > 0,
			entities,
		};
	}

	/**
	 * Recursively scans all string values within an object/array.
	 * Stops at the first detection for performance (fail-fast).
	 */
	async scanDeep(
		input: unknown,
		seen = new WeakSet<object>(),
	): Promise<NerScanResult> {
		if (input === null || input === undefined) {
			return { detected: false, entities: [] };
		}

		if (typeof input === "string") {
			return this.scan(input);
		}

		if (typeof input === "object") {
			if (seen.has(input as object)) {
				return { detected: false, entities: [] };
			}
			seen.add(input as object);

			const values = Array.isArray(input)
				? input
				: Object.values(input as Record<string, unknown>);

			const allEntities: NerEntity[] = [];

			for (const value of values) {
				const result = await this.scanDeep(value, seen);
				if (result.detected) {
					allEntities.push(...result.entities);
					// Fail-fast: return immediately on first person detection
					if (result.entities.some((e) => e.type === "person")) {
						return { detected: true, entities: allEntities };
					}
				}
			}

			return {
				detected: allEntities.length > 0,
				entities: allEntities,
			};
		}

		return { detected: false, entities: [] };
	}
}
