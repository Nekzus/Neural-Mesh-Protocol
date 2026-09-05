# Contributing to Logic-Injection-on-Origin Protocol (LIOP)
*Para la versión en Español, ver la sección más abajo.*

Thank you for your interest in contributing to the Logic-Injection-on-Origin Protocol (LIOP). We are building the high-performance sovereign compute mesh that complements application-level agent protocols (such as MCP) by shifting distributed data computation from Context-Pulling to **Logic-Injection-on-Origin (LIO)**.

To ensure the highest architectural quality, military-grade Zero-Trust security, and a predictable open-source lifecycle, please adhere to the following contribution guidelines.

---

## 1. Code of Conduct
By participating in this project, you agree to abide by our Code of Conduct. All contributors are expected to maintain a professional, technical, respectful, and inclusive environment.

## 2. Constitutional Foundation & The LEP Process
LIOP is governed by the [Origin Manifesto](MANIFESTO.md) and its 7 immutable Design Principles:
- **Constitutional Supremacy**: All contributions, features, and protocol extensions must strictly adhere to the 7 Design Principles (Data Sovereignty, Zero-Trust by Default, Aggregation-First, Cryptographic Verifiability, Quantum Resilience, Minimal Footprint, and Ecosystem Coexistence). Proposals that violate data sovereignty or aggregation guarantees are rejected by design.
- **LIOP Enhancement Proposals (LEPs)**: Protocol enhancements, new gRPC services, cryptographic primitives, or transport extensions are proposed as LEPs submitted via Pull Request targeting the `protocol/` directory to update the [Protocol Specification](protocol/SPECIFICATION.md).

## 3. Core Philosophy: Logic-Injection-on-Origin (LIO)
LIOP is built on the **Postulate of Origin (LIO)**. All contributions must respect the Zero-Trust architecture:
- Agents send logic (WASM/JS); data never leaves the Origin Server without explicit, cryptographically verifiable aggregation.
- Ensure any new feature adheres to the Sandboxing (WASI/V8 Guardian AST) and Cryptographic validation (ZK-Receipts, ML-KEM-768, ML-DSA-65) principles.

## 4. Language Policy
- **Codebase (Strictly English)**: All source code (variable names, functions, architectures), internal code comments, and technical specifications must be written in **English**.
- **Community & Planning (Bilingual)**: High-level architectural documents (`GEMINI.md`, internal planning), Issues, and Discussions may be conducted in **Spanish** or **English**.

## 5. Canonical 3-Channel Branching Strategy
We maintain a strict 3-channel release topology:
- `main`: Represents the stable, production-ready Tier-0 state (`latest` on npm).
- `beta`: Represents the staging and feature-freeze channel (`@beta` on npm).
- `alpha`: Represents the active development channel (`@alpha` on npm).

### Branching Rules:
1. All new feature branches must branch off `alpha` using the format `feature/<descriptive-name>`.
2. Bug fix branches should be named `fix/<bug-name>`.
3. Submit Pull Requests targeting the **`alpha`** branch for active development, or **`beta`** for stabilization fixes.

## 6. Developer Certificate of Origin (DCO 1.1) & Mandatory GPG Commit Signing
To ensure full compliance with Section 5 of the Apache License 2.0 and establish clear intellectual property provenance, LIOP requires all contributions to be certified under the **Developer Certificate of Origin (DCO), Version 1.1**, and signed cryptographically with GPG:

```bash
git commit -s -S -m "feat(scope): descriptive commit message"
```

The `-s` flag automatically appends the required `Signed-off-by: Your Name <your.email@example.com>` trailer. By signing off your commit, you certify the following statement:

> **Developer Certificate of Origin 1.1**
> By making a contribution to this project, I certify that:
> (a) The contribution was created in whole or in part by me and I have the right to submit it under the open source license indicated in the file; or
> (b) The contribution is based upon previous work that, to the best of my knowledge, is covered under an appropriate open source license and I have the right under that license to submit that work with modifications, whether created in whole or in part by me, under the same open source license; or
> (c) The contribution was provided directly to me by some other person who certified (a), (b) or (c) and I have not modified it; and
> (d) In the case of each of (a), (b), or (c), I understand and agree that this project and the contribution are public and that a record of the contribution (including all personal information I submit with it, including my sign-off) is maintained indefinitely and may be redistributed consistent with this project or the open source license(s) involved.

Commits without GPG signatures (`-S`) and valid DCO sign-offs (`-s`) will be rejected by CI security checks.

## 7. Pull Request Requirements
- Use the official Pull Request template (`.github/pull_request_template.md`).
- Ensure all automated checks pass locally before submission:
  - `pnpm install --frozen-lockfile` (0 lockfile errors).
  - `pnpm run check` (BiomeJS formatting and linting).
  - `pnpm test` / `cargo test` (100% test pass rate).
- All new functionality must include corresponding unit and/or integration tests.

## 8. Security (PII & Zero-Trust)
- LIOP enforces a **Zero-Tolerance** policy for Personal Identifiable Information (PII) leakage.
- Never hardcode credentials, secrets, or absolute local paths.
- For security vulnerabilities, sandbox escapes, or cryptographic weaknesses, use [Private Security Advisories](https://github.com/Nekzus/LIOP/security/advisories/new) instead of public issues.

---

# Contribuir a Logic-Injection-on-Origin Protocol (LIOP)

Gracias por tu interés en contribuir al Logic-Injection-on-Origin Protocol (LIOP). Estamos construyendo la malla de cómputo soberano de alto rendimiento que complementa a los protocolos de agentes a nivel de aplicación (como MCP), transformando el cómputo de datos distribuidos desde la Extracción de Contexto hacia **Logic-Injection-on-Origin (LIO)**.

Para garantizar la más alta calidad arquitectónica, seguridad Zero-Trust de grado militar y un ciclo de vida predecible, por favor adhiérete a las siguientes directrices.

---

## 1. Código de Conducta
Al participar en este proyecto, aceptas cumplir con nuestro Código de Conducta. Esperamos que todos los contribuidores mantengan un ambiente profesional, técnico, respetuoso e inclusivo.

## 2. Base Constitucional y Proceso LEP
LIOP se rige por el [Manifiesto de Origen](MANIFESTO_ES.md) y sus 7 Principios de Diseño inmutables:
- **Supremacía Constitucional**: Toda contribución, característica o extensión debe adherirse estrictamente a los 7 Principios de Diseño (Soberanía de Datos, Zero-Trust por Defecto, Agregación Primero, Verificabilidad Criptográfica, Resiliencia Cuántica, Huella Mínima y Convivencia de Ecosistema). Aquellas que vulneren la soberanía o la agregación son rechazadas por diseño.
- **Propuestas de Mejora de LIOP (LEPs)**: Las mejoras arquitectónicas, nuevos servicios gRPC, primitivas criptográficas o extensiones de transporte se proponen mediante LEPs enviadas por Pull Request al directorio `protocol/` para actualizar la [Especificación del Protocolo](protocol/SPECIFICATION.md).

## 3. Filosofía Central: Logic-Injection-on-Origin (LIO)
LIOP está construido sobre el **Postulado de Origen (LIO)**. Todas las contribuciones deben respetar la arquitectura Zero-Trust:
- Los agentes envían lógica (WASM/JS); los datos nunca abandonan el Servidor de Origen sin una agregación explícita y criptográficamente verificable.
- Asegúrate de que cualquier nueva característica se adhiera a los principios de Sandboxing (WASI/V8 Guardian AST) y validación criptográfica (ZK-Receipts, ML-KEM-768, ML-DSA-65).

## 4. Política de Idioma
- **Código Fuente (Estrictamente Inglés)**: Todo el código fuente (variables, funciones, arquitecturas), comentarios internos en el código y especificaciones técnicas deben escribirse en **Inglés**.
- **Comunidad y Planificación (Bilingual)**: Los documentos arquitectónicos de alto nivel (`GEMINI.md`, planificación interna), Issues y Discusiones pueden realizarse en **Español** o **Inglés**.

## 5. Estrategia Canónica de 3 Ramas
Mantenemos una topología estricta de 3 canales de release:
- `main`: Representa el estado estable de producción (`latest` en npm).
- `beta`: Representa el canal de staging y congelamiento de características (`@beta` en npm).
- `alpha`: Representa el canal de desarrollo activo (`@alpha` en npm).

### Reglas de Ramificación:
1. Toda nueva rama de característica debe partir de `alpha` con el formato `feature/<nombre-descriptivo>`.
2. Las ramas de corrección de errores deben nombrarse `fix/<nombre-del-bug>`.
3. Envía tus Pull Requests apuntando a la rama **`alpha`** para desarrollo activo, o a **`beta`** para estabilización.

## 6. Certificado de Origen del Desarrollador (DCO 1.1) y Firma GPG Obligatoria
Para asegurar el pleno cumplimiento con la Sección 5 de la Licencia Apache 2.0 y garantizar la titularidad legítima de la propiedad intelectual aportada, LIOP exige que todas las contribuciones sean certificadas bajo el **Developer Certificate of Origin (DCO), Versión 1.1**, y firmadas criptográficamente con GPG:

```bash
git commit -s -S -m "feat(scope): mensaje descriptivo del commit"
```

El banderín `-s` añade automáticamente la línea `Signed-off-by: Tu Nombre <tu.email@ejemplo.com>`. Al firmar tu commit con sign-off, certificas la siguiente declaración formal:

> **Developer Certificate of Origin 1.1**
> Al realizar una contribución a este proyecto, certifico que:
> (a) La contribución fue creada total o parcialmente por mí y tengo el derecho de presentarla bajo la licencia de código abierto indicada en el archivo; o
> (b) La contribución se basa en trabajos previos que, a mi leal saber y entender, están cubiertos por una licencia de código abierto apropiada y tengo el derecho de presentar dicho trabajo con modificaciones bajo la misma licencia; o
> (c) La contribución me fue proporcionada directamente por otra persona que certificó (a), (b) o (c) y no la he modificado; y
> (d) En el caso de (a), (b) o (c), entiendo y acepto que este proyecto y la contribución son públicos, y que un registro de la contribución (incluyendo mi sign-off) se mantendrá indefinidamente y podrá ser redistribuido de manera consistente con este proyecto o las licencias de código abierto involucradas.

Los commits que carezcan de firma criptográfica GPG (`-S`) o del sign-off DCO (`-s`) serán rechazados automáticamente por los controles de seguridad en CI.

## 7. Requisitos de Pull Requests
- Utiliza la plantilla oficial de Pull Request (`.github/pull_request_template.md`).
- Asegúrate de que todas las pruebas y validaciones pasen localmente antes de enviar:
  - `pnpm install --frozen-lockfile` (0 errores de lockfile).
  - `pnpm run check` (BiomeJS linting y formateo).
  - `pnpm test` / `cargo test` (100% de tests aprobados).
- Toda nueva funcionalidad debe incluir sus pruebas unitarias y/o de integración correspondientes.

## 8. Seguridad (PII y Zero-Trust)
- LIOP opera con una política de **Cero Tolerancia** para fugas de Información Personal Identificable (PII).
- Nunca incluyas credenciales, secretos o rutas locales absolutas.
- Para vulnerabilidades de seguridad, escapes de sandbox o debilidades criptográficas, utiliza las [Asesorías Privadas de Seguridad](https://github.com/Nekzus/LIOP/security/advisories/new) en lugar de issues públicos.
