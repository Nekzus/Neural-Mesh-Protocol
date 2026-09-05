// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestClient, waitForDiscovery, buildEnvelope, extractText } from "./_client-helpers.js";
import { LiopClient } from "../../src/client/index.js";
import { log } from "../../src/utils/logger.js";

describe("12-client-sdk-e2e: Native Client SDK P2P Mesh Execution", () => {
  let client: LiopClient;

  beforeAll(async () => {
    client = await createTestClient();
    // Wait for Kademlia DHT to discover at least 3 tools (Bank, Vault, Oracle)
    await waitForDiscovery(client, 3, 60000);
  }, 70000);

  afterAll(async () => {
    if (client) {
      log.info("[E2E-Test] Closing test client...");
      await client.close();
    }
  });

  it("should list discovered tools through the native client", async () => {
    const tools = await client.discoverTools();
    expect(tools.length).toBeGreaterThanOrEqual(3);
    const names = tools.map(t => t.name);
    expect(names).toContain("Analyze_Synthetic_Bank_Transactions");
    expect(names).toContain("Analyze_Synthetic_Medical_Records");
    expect(names).toContain("Analyze_HFT_Market_Data");
  });

  it("should execute bank aggregation through direct PQC gRPC client path", async () => {
    const logic = `
const records = env.records;
return {
  total: records.length,
  hasBalances: records.some(r => r.balance > 0)
};
    `;
    const envelope = buildEnvelope(logic, "DirectBankAggregation");
    
    log.info("[E2E-Test] Invoking Bank with LiopClient...");
    const result = await client.callTool(
      { name: "Analyze_Synthetic_Bank_Transactions", arguments: {} },
      Buffer.from(envelope)
    );

    expect(result).toBeDefined();
    expect(result.isError).not.toBe(true);
    const text = extractText(result);
    expect(text).toContain("total");
    expect(text).toContain("hasBalances");
  });

  it("should execute oracle HFT market data average calculation", async () => {
    const logic = `
const ticks = env.records;
return {
  ticksCount: ticks.length,
  hasValidPrices: ticks.every(t => t.bestBid > 0 && t.bestAsk > t.bestBid)
};
    `;
    const envelope = buildEnvelope(logic, "DirectHftAnalysis");

    log.info("[E2E-Test] Invoking Oracle with LiopClient...");
    const result = await client.callTool(
      { name: "Analyze_HFT_Market_Data", arguments: {} },
      Buffer.from(envelope)
    );

    expect(result).toBeDefined();
    expect(result.isError).not.toBe(true);
    const text = extractText(result);
    expect(text).toContain("ticksCount");
    expect(text).toContain("hasValidPrices");
  });

  it("should execute vault patient diagnosis stats mapping", async () => {
    const logic = `
const patients = env.records;
return {
  patientsCount: patients.length,
  avgAge: Math.round(patients.reduce((a, p) => a + p.age, 0) / patients.length)
};
    `;
    const envelope = buildEnvelope(logic, "DirectMedicalStats");

    log.info("[E2E-Test] Invoking Vault with LiopClient...");
    const result = await client.callTool(
      { name: "Analyze_Synthetic_Medical_Records", arguments: {} },
      Buffer.from(envelope)
    );

    expect(result).toBeDefined();
    expect(result.isError).not.toBe(true);
    const text = extractText(result);
    expect(text).toContain("patientsCount");
    expect(text).toContain("avgAge");
  });

  it("should block PII data exfiltration with Egress Shield", async () => {
    const logic = `
const records = env.records;
// Adversarial attempt to exfiltrate account owner information (PII)
return {
  leak: records.map(r => ({ owner: r.ownerName, token: r.ownerId }))
};
    `;
    const envelope = buildEnvelope(logic, "AdversarialPiiExfiltration");

    log.info("[E2E-Test] Invoking Bank adversarial tool with LiopClient...");
    const result = await client.callTool(
      { name: "Analyze_Synthetic_Bank_Transactions", arguments: {} },
      Buffer.from(envelope)
    );

    expect(result).toBeDefined();
    // Must report error due to Egress Shield enforcement (Differential Privacy / PiiShield)
    expect(result.isError).toBe(true);
    const text = extractText(result);
    expect(text.toLowerCase()).toContain("block");
  });
});
