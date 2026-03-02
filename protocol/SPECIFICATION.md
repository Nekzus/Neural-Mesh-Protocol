# Neural Mesh Protocol (NMP) Specification
> © 2026 Mauricio Ortega aka. Nekzus & Organización Nekzus Solutions.
> The **Neural Mesh Protocol (NMP) Specification** is licensed under the [Creative Commons Attribution 4.0 International License (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).
> **Attribution Required / Atribución Requerida:** Any use, adaptation, or distribution of these architectural concepts must explicitly attribute **Mauricio Ortega (Nekzus)** and **Nekzus Solutions**, and include an official link to this project.

*(English version below / Versión en español a continuación)*

---

## 🇬🇧 English

### 1. Introduction
The Neural Mesh Protocol (NMP) is a decentralized, high-performance binary transport mesh engineered for robust Machine-to-Machine (M2M) artificial intelligence communication. It replaces the classical Context-Pulling architecture of typical Agent networks with the **Logic-on-Origin (LoO)** paradigm.

### 2. The Logic-on-Origin (LoO) Postulate
**Postulate of Origin (Execution Core):** Data must never be pulled to intelligence. Intelligence must be pushed to the data.

An NMP Agent interacting with an explicit NMP Server pushes executable logic (in the form of microscopic `.wasm` modules or dynamically transpiled algorithms). The server securely executes this logic within a strict sandbox and returns only the aggregated mathematical results or filtered lists, mathematically negating the possibility of unintentional PII (Personally Identifiable Information) exfiltration due to large-context extraction.

### 3. Topographical Architecture

#### 3.1 Network Layer (libp2p & Mesh Networking)
- NMP operates atop a decentralized `libp2p` overlay.
- Servers (Data Nodes) bind to TCP/QUIC ports and advertise themselves as long-running daemons.
- Clients (Agent Injectors) connect ad-hoc.
- NMP completely eliminates centralized brokering or hubs.

#### 3.2 Transport & Multiplexing
- Connections use Multiplexing via Yamux or Mplex, allowing hundreds of concurrent `Logic-on-Origin` injections to occur over a single opened TCP socket without Head-Of-Line Blocking.

#### 3.3 RPC Layer (Tonic / gRPC)
- Raw binary payloads are encapsulated in strict Protobuf definitions (`.proto`).
- The entire NMP interaction relies on Protocol Buffers transmitted over HTTP/2 via Tonic, dropping JSON-RPC overhead natively.

### 4. Cryptographic Security (The Shield)

#### 4.1 Post-Quantum Key Encapsulation
- At initialization, connections instantiate a Post-Quantum Handshake. NMP employs **ML-KEM-768 (Kyber)** to negotiate shared secrets securely against quantum-computing decrypt attacks ("Harvest Now, Decrypt Later" protection).

#### 4.2 Symmetric Payload Sealing
- The agreed Post-Quantum symmetric secret acts as the cipher for `AES-256-GCM`, enveloping the entirety of the execution payload inside a zero-trust capsule.

#### 4.3 Computational Integrity (ZK-SNARKs)
- Host environments may generate Zero-Knowledge Receipts using the `risc0-zkvm` integration. The receipt cryptographically guarantees that the output provided exactly matches the execution of the requested logic *and* the dataset, without revealing the dataset.

### 5. Execution Core (The Sandbox)

#### 5.1 WASI Instantiation
- Injected logic is deployed into a bare-metal `Wasmtime` Virtual Machine implementing the WebAssembly System Interface (WASI).
- No direct network or host filesystem capabilities are allowed by default (`wasi_snapshot_preview1` strict limits).

#### 5.2 Zero-Time AST Guardian
- Before a payload enters the Wasmtime Engine, NMP evaluates its Abstract Syntax Tree (AST). It destructs payloads attempting to import forbidden JS/C++ system modules outside of the NMP specification.

#### 5.3 Military-Grade PII Defense
- The NMP SDK injects a Tier-1 PII Shield at the Egress stage. Employs Luhn Algorithm matching for credits cards, precise NIST-compliant boundaries (`\b`), and specific whitelist semantic checks (Safe Words) to ensure no raw identifiers escape the Origin node.

### 6. Zero-Shot Autonomy (Self-Healing AI)
NMP features built-in self-instructing middleware. Should an Agent attempt a JSON-RPC interaction over MCP legacy adapters, but violate the Logic-on-Origin protocol structure (e.g., pulling raw data instead of pushing a module), NMP intercepts the request, blocks it, and returns a cognitive plaintext instruction manual to the Agent so it can rewrite its own intent.

---

## 🇪🇸 Español

### 1. Introducción
El Neural Mesh Protocol (NMP) es una red de transporte binario de alto rendimiento y descentralizada, diseñada para una comunicación robusta de Inteligencia Artificial Máquina-a-Máquina (M2M). Reemplaza la arquitectura clásica de "Context-Pulling" típica de las redes de Agentes con el paradigma **Logic-on-Origin (LoO)**.

### 2. El Postulado Logic-on-Origin (LoO)
**Postulado de Origen (Núcleo de Ejecución):** Los datos nunca deben ser extraídos hacia la inteligencia. La inteligencia debe ser enviada hacia los datos.

Un Agente NMP interactuando con un Servidor explícito NMP inyecta una lógica ejecutable (en forma de microscópicos módulos `.wasm` o algoritmos transpilados dinámicamente). El servidor ejecuta de forma segura esta lógica dentro de un estricto sandbox y retorna únicamente resultados matemáticos agregados o listas filtradas, negando matemáticamente la posibilidad de exfiltración involuntaria de PII (Información de Identidad Personal) a causa de extracciones masivas de contexto.

### 3. Arquitectura Topográfica

#### 3.1 Capa de Red (libp2p & Malla de Red)
- NMP opera sobre una arquitectura superpuesta descentralizada de `libp2p`.
- Los Servidores (Data Nodes) escuchan en puertos TCP/QUIC y se anuncian como demonios de larga duración.
- Los Clientes (Inyectores Agentes) se conectan de forma ad-hoc.
- NMP erradica por completo hubs o puntos de conexión centralizados.

#### 3.2 Transporte y Multiplexación
- Las conexiones utilizan multiplexación vía Yamux o Mplex, permitiendo cientos de inyecciones `Logic-on-Origin` concurrentes sobre un solo socket TCP sin sufrir Bloqueos de Cabecera (Head-Of-Line Blocking).

#### 3.3 Capa RPC (Tonic / gRPC)
- Los payloads binarios crudos se encapsulan en definiciones estrictas de Protobuf (`.proto`).
- Toda la interacción NMP se basa en Protocol Buffers transmitidos sobre HTTP/2 mediante Tonic, desechando el sobrecoste de JSON-RPC de forma nativa.

### 4. Seguridad Criptográfica (El Escudo)

#### 4.1 Encapsulamiento de Claves Post-Cuánticas
- En su inicio, las conexiones instancian un apretón de manos Post-Cuánticos. NMP emplea **ML-KEM-768 (Kyber)** para negociar secretos compartidos de manera segura contra ataques de descifrado informático cuántico, protegiendo contra "Harvest Now, Decrypt Later".

#### 4.2 Sellado Simétrico del Payload
- El secreto Post-Cuántic simétrico acordado se emplea como cifrado para `AES-256-GCM`, envolviendo el payload de ejecución entero dentro de una cápsula zero-trust.

#### 4.3 Integridad Computacional (ZK-SNARKs)
- Los entornos anfitriones pueden generar Recibos de Cero Conocimiento (ZK-Receipts) empleando la integración `risc0-zkvm`. El recibo garantiza criptográficamente que la salida proveída concuerda exactamente con la ejecución de la lógica solicitada *y* el conjunto de datos, sin revelar el conjunto de datos por sí mismo.

### 5. Núcleo de Ejecución (El Sandbox)

#### 5.1 Instanciación WASI
- La lógica inyectada se despliega en una Máquina Virtual `Wasmtime` implementando la interfaz WebAssembly System Interface (WASI).
- No hay ninguna capacidad de Sistema o de Red permitida por defecto (`wasi_snapshot_preview1` strictly limits).

#### 5.2 Guardián AST Cero-Tiempo
- Previo a que un payload sea inyectado en Wasmtime Engine, NMP analiza su Árbol de Sintaxis Abstracto (AST). Aniquila payloads que pretendan importar módulos del sistema fuera de las restricciones de la especificacion de NMP.

#### 5.3 Defensa PII de Grado Militar
- El NMP SDK inyecta un escudo PII Tier-1 en la fase de Egreso. Emplea el Algoritmo Luhn para asimilar validaciones de tarjetas de crédito, precisiones límites compatibles con NIST (`\b`), y revisiones semánticas especificas de listas de permitidos (Safe Words) para garantizar que jamás el nodo origen sufra exfiltración de PII cruda.

### 6. Autonomía Zero-Shot (Self-Healing AI)
NMP implementa un middleware de auto-instrucción integrado. Si un Agente intenta interactuar mediante solicitudes JSON-RPC por encima de un puente adaptativo tradicional MCP, violando en su defecto el paradigma Logic-on-Origin (ej, pedir descargar datos brutos en lugar de proveer y alojar lógica WebAssembly), NMP intercepta la request, la deniega de facto, y devuelve en su lugar manual cognitivos legibles a texto a manera que el Agente pueda auto-corregir dinamicamente su propia aproximación o intensión.
