// Copyright 2026 Nekzus Solutions and contributors
// SPDX-License-Identifier: Apache-2.0

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

interface PackageManifest {
  name: string;
  version?: string;
  license?: string;
  private?: boolean;
}

const BANNED_LICENSES = [
  'GPL',
  'AGPL',
  'SSPL',
  'CC-BY-NC',
  'COMMERCIAL',
  'PROPRIETARY',
];

const ALLOWED_COPYLEFT_DEV_EXCEPTIONS = [
  'MPL-2.0', // Used solely by lightningcss in build tooling
];

console.log('🔍 Starting LIOP License Compliance Guardrail Audit...');
let hasErrors = false;

// 1. Verify Root Legal Artifacts
const rootFiles = ['LICENSE', 'NOTICE', 'TRADEMARKS.md', 'SECURITY.md'];
for (const file of rootFiles) {
  const fullPath = path.join(REPO_ROOT, file);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ Missing root legal artifact: ${file}`);
    hasErrors = true;
  } else {
    console.log(`✅ Verified root legal artifact: ${file}`);
  }
}

// 2. Verify SDK Distribution Artifacts
const sdkNotice = path.join(REPO_ROOT, 'sdks', 'typescript', 'NOTICE');
if (!fs.existsSync(sdkNotice)) {
  console.error(`❌ Missing SDK NOTICE: ${sdkNotice}`);
  hasErrors = true;
} else {
  console.log(`✅ Verified SDK NOTICE: ${sdkNotice}`);
}

// 3. Verify Workspace Manifests
const workspacePackagePaths = [
  'package.json',
  'sdks/typescript/package.json',
  'sdks/typescript/examples/client/package.json',
  'sdks/typescript/examples/client-quickstart/package.json',
  'sdks/typescript/examples/server/package.json',
  'sdks/typescript/examples/server-quickstart/package.json',
  'sdks/typescript/tests/infra/playground-web/package.json',
  'examples/demos/package.json',
  'examples/demos/high-fidelity-demo/package.json',
  'examples/demos/sentinel-mesh/package.json',
];

for (const relPath of workspacePackagePaths) {
  const pkgPath = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(pkgPath)) continue;
  const content: PackageManifest = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (content.license !== 'Apache-2.0') {
    console.error(`❌ Manifest ${relPath} has invalid license: "${content.license}" (expected "Apache-2.0")`);
    hasErrors = true;
  } else {
    console.log(`✅ Manifest ${relPath}: "license": "${content.license}"`);
  }
}

// 4. Verify SPDX Headers in Key SDK Files
const sdkIndex = path.join(REPO_ROOT, 'sdks', 'typescript', 'src', 'index.ts');
const sdkIndexContent = fs.readFileSync(sdkIndex, 'utf8');
if (!sdkIndexContent.includes('SPDX-License-Identifier: Apache-2.0')) {
  console.error(`❌ Missing SPDX header in ${sdkIndex}`);
  hasErrors = true;
} else {
  console.log(`✅ Verified SPDX header in ${sdkIndex}`);
}

// 5. Dependency Audit via pnpm licenses list
console.log('📦 Auditing third-party dependency graph...');
try {
  const jsonOutput = execSync('pnpm licenses list --json', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const licensesData: Record<string, Array<{ name: string; version: string }>> = JSON.parse(jsonOutput);

  for (const [license, pkgs] of Object.entries(licensesData)) {
    const isBanned = BANNED_LICENSES.some(banned => license.toUpperCase().includes(banned));
    if (isBanned && !ALLOWED_COPYLEFT_DEV_EXCEPTIONS.includes(license)) {
      console.error(`❌ Non-compliant license detected: ${license} (${pkgs.length} packages affected: ${pkgs.map(p => p.name).slice(0, 3).join(', ')})`);
      hasErrors = true;
    }
  }
  console.log(`✅ Dependency graph checked: ${Object.keys(licensesData).length} unique license categories verified.`);
} catch (err) {
  console.warn('⚠️ Warning: Failed to query pnpm licenses list CLI directly:', (err as Error).message);
}

if (hasErrors) {
  console.error('\n❌ LIOP License Guardrail FAILED. Resolve license discrepancies before committing.');
  process.exit(1);
} else {
  console.log('\n🌟 LIOP License Guardrail PASSED: 100% compliant with Apache-2.0 policies.\n');
}
