# Changelog

All notable changes to this project will be documented in this file. See
[Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# 1.0.0-alpha.1 (2026-03-05)


### Bug Fixes

* align package version with v1.0.0-alpha.2 and synchronize tags ([2bab264](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/2bab264194470a04cd5e17def9fb469cf3809042))
* **docs:** refine text positioning, verify spelling, and confirm mobile rendering optimizations in logic-on-origin svgs ([41db052](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/41db05278bf3a56a17dd20c2964ad7917ef503f2))
* **docs:** repair broken dark svg rendering and align text layers symmetrically across both logic-on-origin diagrams ([059e744](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/059e7440e9de564cf19f877b8503ecedc665f2a5))
* **docs:** replace animateMotion with SMIL animate transforms for better image tag compatibility in Mintlify ([106ef5f](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/106ef5fd83c97a90adfd348a722ba2462146b78a))
* **docs:** replace SMIL animate with CSS keyframes for 100% Mintlify img compatibility ([8fdea51](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/8fdea5188b083c2d80e670e5558335bdf62e1c96))
* logic output serialization returns proper json rather than object string primitive in wasi sandbox ([770dce7](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/770dce7eb1298eca3c0f4a379bd951d30eb99f9c))
* resolve EPRERELEASEBRANCHES semantic-release config conflict ([7e87496](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/7e87496710d8c85dbc0ec1800f95c97661d9b7b2))
* resolve linting and formatting errors in TS SDK ([046b09b](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/046b09be973e67576075df4ef7cfbaaddb380b1c))
* **sdk:** resolve TypeScript compilation errors in demos and bridge tests ([58cc2d7](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/58cc2d7e13a24c143f9ac0f9f513f60e3692c0e9))
* **sdk:** updated z.record strictness to match latest zod schema version parity ([e981fd4](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/e981fd4bbe1fd253f2913d80f9a0a787700cce3b))


### Features

* **docs:** implement multi-language support (i18n) for Mintlify documentation [English/Spanish] ([1e1c188](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/1e1c1888192d5086e89bbfd0e9f2a93c36c62b80))
* implement Military Grade PII Shield (Luhn, Safe Words, NIST boundaries) (Phase 34) ([a610538](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/a610538a96551c5f67e788bdab4582a24fd12638))
* implement native sdk defensive serialization for logic-on-origin tool returns ([dbe764a](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/dbe764a288713256c91e7b2a45fc8d7962a3ab03))
* implement native sdk pii protection (the shield core) and refactor demo ([1c055b2](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/1c055b2de336a3acc264bdc7a130f2ffe1bf7c72))
* implement professional multi-layer PII engine (Phase 33) ([62f8257](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/62f825744d08216eb443de37042c18bd9c6a81a6))
* **nmp-core:** Init Cargo workspace and nmp_core.proto definition ([c2bf566](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/c2bf5663caafd23366e125d949e03d396a521140))
* **nmp:** complete Logic-on-Origin WebAssembly Push paradigm implementation ([71a2aef](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/71a2aef0dd4b7055460a5d0f863ce3d723cf23ab))
* **nmp:** implemented phase 2 sdk bridge and phase 3 streaming push watchdogs ([95eb77e](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/95eb77e9047d3f3ddfce9ab6a39895561925eda7))
* phase 45 - perfect parity audit remediation (integrated workers, kyber, node:vm) ([9711cb5](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/9711cb56df56db975134ea1264eb7c76c9400069))
* **rust-app:** empower nmp-server with ZK-SNARKs and TEE physical enclaves architecture ([25052fa](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/25052faf75c5dba664278efc572222d5109ebbd5))
* **sdk:** Cleanup console logs and dummy PQC mocks for Tier-0 rc ([f4d53d5](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/f4d53d530bccf192e81ea96df64ce23538a92ae5))
* **sdk:** Enforce Dynamic Return Structure (i18n) for LLM prompts ([9448827](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/94488274ab7448118c3bf60e00ca07877fb98174))
* **sdk:** Implement full MCP parity with NmpServer, Client, Bridge and 100% test coverage ([7e97db1](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/7e97db138c4069f89e426130341772c24a53a367))
* **sdk:** implement native zk-receipt verification in bridge and client ([ec5f53d](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/ec5f53d35578c0577a8ded2261ce7a5cbfffbb9e))
* **sdk:** Implement Phase 3 native P2P, gRPC, and WASI execution in Node.js ([c61ae58](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/c61ae587887b5b58cf12429388b2322099f4fa49))
* **sdk:** Implement Zero-Shot Autonomy for NMP Server Logic-on-Origin. Add system prompt 'nmp_blind_analyst' and Educative Shield middleware to tool registration. Update bridge for prompt handling. Fix wasi-sandbox env variable exposure. ([455a755](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/455a755a61f6e61bbc8a6dfbfc700b0f876c98ca))
* **sdk:** inject dynamic PII forbidden keys into Zero-Shot Payload instruction ([dd75e1b](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/dd75e1be05d3bea0ad98c501baa4c68483533fb6))
* **sdk:** inject explicit 'return' statement warning in Zero-Shot middleware ([07b9394](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/07b93947dc135042b5fa802f6eb7b26c8dc01c89))
* **sdk:** migrate examples to fully containerized sub-packages utilizing pnpm workspaces for true modularity mimicking MCP ecosystem ([6ca41d6](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/6ca41d69442e8c754f6e968773cf6789bc165f9d))
* **sdk:** NMP Phase 19 - Universal MCP Bridge, Egress Filter & Zero-Shot Schema Discovery ([fd5b811](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/fd5b811abcc507e62e5508d9b389ccfd4d26b5e1))
* **sdk:** relax blind analyst return constraints to allow flexible generic logic payloads ([b87d92a](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/b87d92a97c94e50578c0cef63da7305ff34e1d4d))
* **sdk:** Restore native logging and implement zero-trust logic-execution tests ([2497228](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/249722860ef1621814d294bbb5717e2a802ed8d5))
* **sdk:** Tier-0 Crypto Parity with Kyber768 & AES-256-GCM ([829eccf](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/829eccf621ab75844008d23a8f446ed5ab6d0ee5))
* **sdk:** Vanguard Enterprise Architecture (PQC, TCP, ZK, Guardian-TS & Piscina Worker Pool) ([125cb94](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/125cb943d475363fcbb90c0cdca21c67e7b1c9ed))
* **security:** Implement Hybrid PQC (Kyber768), AES-GCM, and TEE Stubs for Phase 4 Zero-Trust Architecture ([dd06fb5](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/dd06fb53a2a7ae66f2fde4420f1de5198e9945ff))
* **security:** integrate zero-time ast guardian and libp2p kademlia dht caching ([2135346](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/21353463e6e0942ab30efbeb94a8e88a79dced2b))

# 1.0.0-alpha.1 (2026-03-05)


### Bug Fixes

* align package version with v1.0.0-alpha.2 and synchronize tags ([2bab264](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/2bab264194470a04cd5e17def9fb469cf3809042))
* **docs:** refine text positioning, verify spelling, and confirm mobile rendering optimizations in logic-on-origin svgs ([41db052](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/41db05278bf3a56a17dd20c2964ad7917ef503f2))
* **docs:** repair broken dark svg rendering and align text layers symmetrically across both logic-on-origin diagrams ([059e744](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/059e7440e9de564cf19f877b8503ecedc665f2a5))
* **docs:** replace animateMotion with SMIL animate transforms for better image tag compatibility in Mintlify ([106ef5f](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/106ef5fd83c97a90adfd348a722ba2462146b78a))
* **docs:** replace SMIL animate with CSS keyframes for 100% Mintlify img compatibility ([8fdea51](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/8fdea5188b083c2d80e670e5558335bdf62e1c96))
* logic output serialization returns proper json rather than object string primitive in wasi sandbox ([770dce7](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/770dce7eb1298eca3c0f4a379bd951d30eb99f9c))
* resolve EPRERELEASEBRANCHES semantic-release config conflict ([7e87496](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/7e87496710d8c85dbc0ec1800f95c97661d9b7b2))
* resolve linting and formatting errors in TS SDK ([046b09b](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/046b09be973e67576075df4ef7cfbaaddb380b1c))
* **sdk:** resolve TypeScript compilation errors in demos and bridge tests ([58cc2d7](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/58cc2d7e13a24c143f9ac0f9f513f60e3692c0e9))
* **sdk:** updated z.record strictness to match latest zod schema version parity ([e981fd4](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/e981fd4bbe1fd253f2913d80f9a0a787700cce3b))


### Features

* **docs:** implement multi-language support (i18n) for Mintlify documentation [English/Spanish] ([1e1c188](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/1e1c1888192d5086e89bbfd0e9f2a93c36c62b80))
* implement Military Grade PII Shield (Luhn, Safe Words, NIST boundaries) (Phase 34) ([a610538](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/a610538a96551c5f67e788bdab4582a24fd12638))
* implement native sdk defensive serialization for logic-on-origin tool returns ([dbe764a](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/dbe764a288713256c91e7b2a45fc8d7962a3ab03))
* implement native sdk pii protection (the shield core) and refactor demo ([1c055b2](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/1c055b2de336a3acc264bdc7a130f2ffe1bf7c72))
* implement professional multi-layer PII engine (Phase 33) ([62f8257](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/62f825744d08216eb443de37042c18bd9c6a81a6))
* **nmp-core:** Init Cargo workspace and nmp_core.proto definition ([c2bf566](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/c2bf5663caafd23366e125d949e03d396a521140))
* **nmp:** complete Logic-on-Origin WebAssembly Push paradigm implementation ([71a2aef](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/71a2aef0dd4b7055460a5d0f863ce3d723cf23ab))
* **nmp:** implemented phase 2 sdk bridge and phase 3 streaming push watchdogs ([95eb77e](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/95eb77e9047d3f3ddfce9ab6a39895561925eda7))
* phase 45 - perfect parity audit remediation (integrated workers, kyber, node:vm) ([9711cb5](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/9711cb56df56db975134ea1264eb7c76c9400069))
* **rust-app:** empower nmp-server with ZK-SNARKs and TEE physical enclaves architecture ([25052fa](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/25052faf75c5dba664278efc572222d5109ebbd5))
* **sdk:** Cleanup console logs and dummy PQC mocks for Tier-0 rc ([f4d53d5](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/f4d53d530bccf192e81ea96df64ce23538a92ae5))
* **sdk:** Enforce Dynamic Return Structure (i18n) for LLM prompts ([9448827](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/94488274ab7448118c3bf60e00ca07877fb98174))
* **sdk:** Implement full MCP parity with NmpServer, Client, Bridge and 100% test coverage ([7e97db1](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/7e97db138c4069f89e426130341772c24a53a367))
* **sdk:** implement native zk-receipt verification in bridge and client ([ec5f53d](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/ec5f53d35578c0577a8ded2261ce7a5cbfffbb9e))
* **sdk:** Implement Phase 3 native P2P, gRPC, and WASI execution in Node.js ([c61ae58](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/c61ae587887b5b58cf12429388b2322099f4fa49))
* **sdk:** Implement Zero-Shot Autonomy for NMP Server Logic-on-Origin. Add system prompt 'nmp_blind_analyst' and Educative Shield middleware to tool registration. Update bridge for prompt handling. Fix wasi-sandbox env variable exposure. ([455a755](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/455a755a61f6e61bbc8a6dfbfc700b0f876c98ca))
* **sdk:** inject dynamic PII forbidden keys into Zero-Shot Payload instruction ([dd75e1b](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/dd75e1be05d3bea0ad98c501baa4c68483533fb6))
* **sdk:** inject explicit 'return' statement warning in Zero-Shot middleware ([07b9394](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/07b93947dc135042b5fa802f6eb7b26c8dc01c89))
* **sdk:** migrate examples to fully containerized sub-packages utilizing pnpm workspaces for true modularity mimicking MCP ecosystem ([6ca41d6](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/6ca41d69442e8c754f6e968773cf6789bc165f9d))
* **sdk:** NMP Phase 19 - Universal MCP Bridge, Egress Filter & Zero-Shot Schema Discovery ([fd5b811](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/fd5b811abcc507e62e5508d9b389ccfd4d26b5e1))
* **sdk:** relax blind analyst return constraints to allow flexible generic logic payloads ([b87d92a](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/b87d92a97c94e50578c0cef63da7305ff34e1d4d))
* **sdk:** Restore native logging and implement zero-trust logic-execution tests ([2497228](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/249722860ef1621814d294bbb5717e2a802ed8d5))
* **sdk:** Tier-0 Crypto Parity with Kyber768 & AES-256-GCM ([829eccf](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/829eccf621ab75844008d23a8f446ed5ab6d0ee5))
* **sdk:** Vanguard Enterprise Architecture (PQC, TCP, ZK, Guardian-TS & Piscina Worker Pool) ([125cb94](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/125cb943d475363fcbb90c0cdca21c67e7b1c9ed))
* **security:** Implement Hybrid PQC (Kyber768), AES-GCM, and TEE Stubs for Phase 4 Zero-Trust Architecture ([dd06fb5](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/dd06fb53a2a7ae66f2fde4420f1de5198e9945ff))
* **security:** integrate zero-time ast guardian and libp2p kademlia dht caching ([2135346](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/21353463e6e0942ab30efbeb94a8e88a79dced2b))

# [1.0.0-alpha.2](https://github.com/Nekzus/Neural-Mesh-Protocol/compare/v1.0.0-alpha.1...v1.0.0-alpha.2) (2026-03-05)


### Bug Fixes

* patch NPM semantic release deployment bypassing provenance ([b65fc16](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/b65fc16bb0d275d9cee2425d5432cb32939de211))

# 1.0.0-alpha.1 (2026-03-05)


### Bug Fixes

* **docs:** refine text positioning, verify spelling, and confirm mobile rendering optimizations in logic-on-origin svgs ([353ea43](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/353ea430674bce6d7346e92013cd0544a684dd7a))
* **docs:** repair broken dark svg rendering and align text layers symmetrically across both logic-on-origin diagrams ([6c9e633](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/6c9e633d2b8e2841e4aac8f087cac70642b065c9))
* **docs:** replace animateMotion with SMIL animate transforms for better image tag compatibility in Mintlify ([1de6800](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/1de680031d50005696f52e6bc3360e773c7bdcd9))
* **docs:** replace SMIL animate with CSS keyframes for 100% Mintlify img compatibility ([f322754](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/f3227547934e3f53456ab9e903035006094c59e6))
* logic output serialization returns proper json rather than object string primitive in wasi sandbox ([68bf922](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/68bf922e7714d364b58978f7a0c267dc042bfc19))
* **sdk:** resolve TypeScript compilation errors in demos and bridge tests ([716c513](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/716c5136a0fda6571b62835fe0e846513f4a2445))
* **sdk:** updated z.record strictness to match latest zod schema version parity ([e981fd4](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/e981fd4bbe1fd253f2913d80f9a0a787700cce3b))


### Features

* **docs:** implement multi-language support (i18n) for Mintlify documentation [English/Spanish] ([b892a3f](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/b892a3f8ef1286e1e75519390bab2da4b61d5f60))
* implement Military Grade PII Shield (Luhn, Safe Words, NIST boundaries) (Phase 34) ([7188d2a](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/7188d2ac8d69ec7c89f158e8c6c2aa0a883e66d4))
* implement native sdk defensive serialization for logic-on-origin tool returns ([b8b9763](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/b8b97639c8e547c26f948a7f4e006a695b7b68f5))
* implement native sdk pii protection (the shield core) and refactor demo ([1ade946](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/1ade946d6dd6608102829c66e0dc2b316fc64dd9))
* implement professional multi-layer PII engine (Phase 33) ([119acbf](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/119acbf570727e89eebdeebc833beab547a56103))
* **nmp-core:** Init Cargo workspace and nmp_core.proto definition ([c2bf566](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/c2bf5663caafd23366e125d949e03d396a521140))
* **nmp:** complete Logic-on-Origin WebAssembly Push paradigm implementation ([71a2aef](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/71a2aef0dd4b7055460a5d0f863ce3d723cf23ab))
* **nmp:** implemented phase 2 sdk bridge and phase 3 streaming push watchdogs ([95eb77e](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/95eb77e9047d3f3ddfce9ab6a39895561925eda7))
* phase 45 - industry tier-0 parity reached (integrated workers, kyber, isolates) ([7e9b4c7](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/7e9b4c7bcc6e7b9d414ab2411484b4e57894925c))
* phase 45 - perfect parity audit remediation (integrated workers, kyber, node:vm) ([596ac28](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/596ac281d627e5995673d7f277ef74a61d965b54))
* **rust-app:** empower nmp-server with ZK-SNARKs and TEE physical enclaves architecture ([92fd21e](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/92fd21e2eadcaa8865d6dd9f1299db9393d18266))
* **sdk:** Cleanup console logs and dummy PQC mocks for Tier-0 rc ([f87c302](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/f87c30249d62e296bf3b67d8f151153ac4816a87))
* **sdk:** Enforce Dynamic Return Structure (i18n) for LLM prompts ([bbfb7c7](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/bbfb7c7534845c957a78b45b14b734efa385cee3))
* **sdk:** Implement full MCP parity with NmpServer, Client, Bridge and 100% test coverage ([7e97db1](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/7e97db138c4069f89e426130341772c24a53a367))
* **sdk:** implement native zk-receipt verification in bridge and client ([0274682](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/027468294ca36458b6e2ff7bc60f50f1c4634d13))
* **sdk:** Implement Phase 3 native P2P, gRPC, and WASI execution in Node.js ([aed03c7](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/aed03c7d4d1fb2eccb0169ca53ac6db9a0752b83))
* **sdk:** Implement Zero-Shot Autonomy for NMP Server Logic-on-Origin. Add system prompt 'nmp_blind_analyst' and Educative Shield middleware to tool registration. Update bridge for prompt handling. Fix wasi-sandbox env variable exposure. ([fc9c608](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/fc9c608b0d27ce6346ff73a94d6cfe1d3fd82385))
* **sdk:** inject dynamic PII forbidden keys into Zero-Shot Payload instruction ([a8a3a8c](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/a8a3a8cf740bab4b07c9a08d8adfd9bfb2d9fab7))
* **sdk:** inject explicit 'return' statement warning in Zero-Shot middleware ([739ad4a](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/739ad4ae96a75e9c1bba4711ebae108440670331))
* **sdk:** migrate examples to fully containerized sub-packages utilizing pnpm workspaces for true modularity mimicking MCP ecosystem ([6ca41d6](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/6ca41d69442e8c754f6e968773cf6789bc165f9d))
* **sdk:** NMP Phase 19 - Universal MCP Bridge, Egress Filter & Zero-Shot Schema Discovery ([88de4cd](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/88de4cd16511439c31c36545288e8f3bf7ec39ee))
* **sdk:** relax blind analyst return constraints to allow flexible generic logic payloads ([b26d134](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/b26d134c1d514511260c882f3b50f0f733bcce19))
* **sdk:** Restore native logging and implement zero-trust logic-execution tests ([85e1c8c](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/85e1c8c478e580a407f6518be784b0f356533b00))
* **sdk:** Tier-0 Crypto Parity with Kyber768 & AES-256-GCM ([693fff5](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/693fff5c940ad65325c0195ea166d53ceaeeab0b))
* **sdk:** Vanguard Enterprise Architecture (PQC, TCP, ZK, Guardian-TS & Piscina Worker Pool) ([e64c60c](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/e64c60c337771d1a3df1952b330043abdb42e21f))
* **security:** Implement Hybrid PQC (Kyber768), AES-GCM, and TEE Stubs for Phase 4 Zero-Trust Architecture ([dd06fb5](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/dd06fb53a2a7ae66f2fde4420f1de5198e9945ff))
* **security:** integrate zero-time ast guardian and libp2p kademlia dht caching ([2135346](https://github.com/Nekzus/Neural-Mesh-Protocol/commit/21353463e6e0942ab30efbeb94a8e88a79dced2b))
