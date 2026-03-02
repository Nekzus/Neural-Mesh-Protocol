# Contributing to Neural Mesh Protocol (NMP)
*Para la versión en Español, ver la sección más abajo.*

Thank you for your interest in contributing to the Neural Mesh Protocol (NMP). We are building the successor to the Model Context Protocol (MCP) by shifting the paradigm from Context-Pulling to **Logic-on-Origin (LoO)**. 

To ensure the highest quality, military-grade security, and a cohesive developer experience, please adhere to the following guidelines.

## 1. Code of Conduct
By participating in this project, you agree to abide by our Code of Conduct. We expect all contributors to maintain a professional, respectful, and inclusive environment.

## 2. Core Philosophy: Logic-on-Origin (LoO)
NMP is built on the **Postulate of Origin (Logic-on-Origin)**. All contributions must respect the Zero-Trust architecture. 
- Agents send logic (WASM/JS); data never leaves the Origin Server without explicit, cryptographically verifiable intent.
- Ensure any new feature adheres to the Sandboxing (WASI/V8 Guardian AST) and Cryptographic validation (ZK-Receipts) principles.

## 3. Language Policy
- **Codebase (Strictly English)**: All source code (variables, functions, architectures), internal code comments, and technical specifications must be written in **English**.
- **Documentation & Community (Bilingual)**: High-level architectural documents (`GEMINI.md`, Issues, Discussions) and Community interactions may be conducted in **Spanish** or **English**.

## 4. Branching Strategy
We follow a structured branching model:
- `main`: Represents the stable, production-ready Tier-0 state.
- `development`: The active integration branch.
- Feature branches must branch off `development` and be named using the format `feature/<your-feature-name>`.
- Bugfix branches should be named `fix/<bug-name>`.

## 5. Pull Requests (PR)
- Submit PRs targeting the `development` branch.
- Include a clear, descriptive title and a comprehensive summary of the changes.
- Ensure all tests pass (`pnpm test` / `cargo test`). **Do not submit PRs with failing tests or lowered coverage.**
- Any new features must include their respective unit tests, demonstrating 100% reliability, especially concerning PII detection or logic sandboxing.

## 6. Security (PII & Zero-Trust)
- NMP operates with a **Zero-Tolerance** policy for Personal Identifiable Information (PII) leakage.
- Never hardcode secrets, tokens, or absolute local paths.
- If you touch the egress filters or AST validators, you must mathematically prove your changes via tests (e.g., Luhn validation, avoiding catastrophic backtracking).

## 7. Style Guidelines
- **TypeScript**: We use `Biome.js` for strict linting and formatting. Run `pnpm run check` and `pnpm run format` before committing.
- **Rust**: Use `rustfmt` and `clippy`. Ensure `cargo clippy -- -D warnings` passes without errors.

---

# Contribuir a Neural Mesh Protocol (NMP)

Gracias por tu interés en contribuir al Neural Mesh Protocol (NMP). Estamos construyendo el sucesor del Model Context Protocol (MCP) cambiando el paradigma de la Extracción de Contexto hacia el núcleo de **Logic-on-Origin (LoO)**.

Para garantizar la más alta calidad, seguridad de grado militar y una experiencia de desarrollo cohesiva, por favor adhiérete a las siguientes directrices.

## 1. Código de Conducta
Al participar en este proyecto, aceptas cumplir con nuestro Código de Conducta. Esperamos que todos los contribuidores mantengan un ambiente profesional, respetuoso e inclusivo.

## 2. Filosofía Central: Logic-on-Origin (LoO)
NMP está construido sobre el **Postulado de Origen (Logic-on-Origin)**. Todas las contribuciones deben respetar la arquitectura Zero-Trust.
- Los agentes envían lógica (WASM/JS); los datos nunca abandonan el Servidor de Origen sin una intención explícita y criptográficamente verificable.
- Asegúrate de que cualquier nueva característica se adhiera a los principios de Sandboxing (WASI/V8 Guardian AST) y validación criptográfica (ZK-Receipts).

## 3. Política de Idioma
- **Código Fuente (Estrictamente Inglés)**: Todo el código fuente (variables, funciones, arquitecturas), comentarios internos en el código y especificaciones técnicas en el repositorio deben escribirse en **Inglés**.
- **Documentación y Comunidad (Bilingüe)**: Los documentos arquitectónicos de alto nivel (`GEMINI.md`, Issues, Discusiones) y las interacciones de la comunidad pueden realizarse en **Español** o **Inglés**.

## 4. Estrategia de Ramas (Branching)
Seguimos un modelo estructurado:
- `main`: Representa el estado estable, listo para producción (Tier-0).
- `development`: La rama de integración activa.
- Las ramas de características deben partir de `development` y nombrarse con el formato `feature/<nombre-de-tu-feature>`.
- Las ramas de corrección de errores deben nombrarse `fix/<nombre-del-bug>`.

## 5. Pull Requests (PR)
- Envía tus PRs apuntando a la rama `development`.
- Incluye un título claro y descriptivo, y un resumen exhaustivo de los cambios.
- Asegúrate de que todas las pruebas pasen (`pnpm test` / `cargo test`). **No envíes PRs con pruebas fallando o cobertura disminuida.**
- Toda nueva funcionalidad debe incluir sus respectivas pruebas unitarias, demostrando 100% de fiabilidad, especialmente en lo relativo a la detección de PII o el sandboxing lógico.

## 6. Seguridad (PII y Zero-Trust)
- NMP opera con una política de **Cero Tolerancia** para fugas de Información Personal Identificable (PII).
- Nunca dejes secretos, tokens o rutas locales absolutas en el código.
- Si modificas los filtros de salida (egress) o los validadores AST, debes probar matemáticamente tus cambios mediante tests (ej. validación Luhn, evitar backtracking catastrófico).

## 7. Guías de Estilo
- **TypeScript**: Utilizamos `Biome.js` para linting estricto y formato. Ejecuta `pnpm run check` y `pnpm run format` antes de hacer commit.
- **Rust**: Usa `rustfmt` y `clippy`. Asegúrate de que `cargo clippy -- -D warnings` pase sin errores.
