# Protocolo Logic-Injection-on-Origin (LIOP)
# Guía y Faro Canónico de Topología de Red: La Arquitectura de Malla Soberana en Tres Niveles

> **Estado del Documento:** Estándar Arquitectónico y Guía Faro (The Lighthouse Blueprint)  
> **Clasificación:** Arquitectura Técnica de Protocolo / Ingeniería de Redes y Gobernanza  
> **Audiencia Objetivo:** Arquitectos de Sistemas, Ingenieros de Redes, CISOs/CIOs Corporativos, Desarrolladores del Protocolo  
> **Ratificado por:** Organización Nekzus Solutions  
> **Primera Ratificación:** Septiembre 2026 | **Versión del Protocolo:** 2.5+  

---

## 1. Resumen Ejecutivo y Dilema Fundamental

### El Dilema Arquitectónico Central
Al proyectar el despliegue del Protocolo Logic-Injection-on-Origin (LIOP) a escala planetaria surge la interrogante crítica:
> *"¿Debe utilizarse el protocolo mediante una única malla pública a nivel mundial que interconecte a todos los nodos del planeta (al estilo de la DHT pública de IPFS o BitTorrent Mainline), o de forma seccionada y privada mediante redes aisladas?"*

### El Dictamen Arquitectónico
**Ni una sola malla plana global e indiscriminada, ni silos privados totalmente desconectados son viables por sí solos.**

Una malla plana global única introduce fallas de seguridad catastróficas (ataques Sybil, envenenamiento de tablas de enrutamiento Kademlia, correlación de metadatos de tráfico e infracciones severas de soberanía de datos bajo GDPR y HIPAA). Por otro lado, mallas privadas estrictamente aisladas fragmentan el ecosistema en islas cerradas e incomunicadas, anulando el potencial transformador de LIOP como estándar abierto Máquina-a-Máquina (M2M) para agentes de IA autónomos.

**LIOP adopta oficialmente la Arquitectura de Malla Soberana Federada en Tres Niveles (Tri-Tier Sovereign Mesh Architecture)**, un modelo que replica con rigor la arquitectura fundamental que hace funcionar a la Internet global:

```
┌─────────────────────────────────────────────────────────────────────────┐
│             NIVEL 3: DORSAL PÚBLICA GLOBAL DE DESCUBRIMIENTO            │
│   (DHT Pública, Supernodos Bootstrap Anycast, Descubrimiento Abierto)   │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Intercambio Federado de Capacidades (FCX)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│          NIVEL 2: MALLAS FEDERADAS SECTORIALES DE CONSORCIO             │
│   (Investigación Médica, Telemetría Interbancaria, Cadena de Suministro)│
│    mTLS Mutuo / OAuth 2.1 RFC 8707 / Listas de Confianza ML-DSA-65      │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Frontera LIO de Inyección de Lógica
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│          NIVEL 1: ENCLAVES SOBERANOS INTRA-ORGANIZACIONALES             │
│     (Subredes Privadas Zero-Trust, Claves Swarm PSK, Bases de Datos)    │
│      DATOS EN REPOSO — CERO ACCESO EXTERNO DIRECTO — SANDBOX WASI       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Auditoría Técnica de las Topologías Extremas

Para fundamentar por qué la arquitectura en tres niveles es obligatoria, se auditan las causas matemáticas, físicas y regulatorias del fracaso de los dos enfoques extremos.

### 2.1 Modo de Falla A: Malla Global Plana Única (Descentralización Ingenua)

En este modelo, cada nodo LIOP del planeta se une a una única DHT Kademlia no estructurada (`/ipfs/kad/1.0.0` o `/liop/kad/1.0.0`), compartiendo el mismo espacio de claves XOR de 256 bits.

```
[Nodo Hospitalario] <───(DHT Plana Única)───> [Par Anónimo Malicioso]
    (Frankfurt)                                 (Actor Hostil)
```

#### Vulnerabilidades Críticas:
1. **Ataques Sybil y Eclipse en Tablas de Enrutamiento:**
   - En una DHT Kademlia abierta sin prueba de trabajo ni staking financiero, un atacante puede generar millones de identidades Ed25519 cuyos hashes SHA-256 colisionen en cercanía XOR con el `PeerId` o los CIDs de un nodo objetivo.
   - Al copar los $k$-buckets de los nodos vecinos, el atacante puede descartar paquetes de enrutamiento (blackholing), interceptar llamadas lógicas o redirigir peticiones a nodos falsos.
2. **Fuga de Metadatos y Destrucción del Límite Soberano:**
   - Aunque los datos crudos jamás salgan del sandbox (garantía de WASI y Guardian AST), **los metadatos del cómputo son en sí mismos información confidencial**.
   - Un actor que monitoree las llamadas DHT `FIND_NODE` y `PROVIDE` puede deducir:
     - Qué hospital específico está procesando biomarcadores oncológicos.
     - El volumen y la frecuencia de consultas analíticas de una entidad bancaria.
     - La topología de red, direcciones multiaddr públicas y horarios de operación de infraestructuras críticas.
   - Bajo el RGPD europeo (Artículo 44) y la regla de seguridad HIPAA (§ 164.312), exponer rutas de red y metadatos operacionales a nodos internacionales anónimos genera responsabilidad civil y penal inmediata.
3. **Explosión de Latencia Kademlia en WAN Multi-Salto:**
   - Una resolución Kademlia requiere $\alpha \cdot \log(N)$ saltos de red. En una red global de 5,000,000 de nodos dispersos intercontinentalmente (Sídney $\to$ Frankfurt $\to$ São Paulo $\to$ Tokio), la latencia de descubrimiento asciende a $3,000 \text{ ms} - 8,000 \text{ ms}$, haciendo inviable el cómputo en tiempo real.
4. **Envenenamiento y Saturación por Churn:**
   - La volatilidad de nodos en el borde (conexiones y desconexiones constantes) desata tormentas de paquetes para mantener los $k$-buckets, saturando interfaces de red locales.

---

### 2.2 Modo de Falla B: Silos Privados Aislados (El Jardín Amurallado)

En este modelo, cada empresa opera un despliegue cerrado con claves pre-compartidas (`pnet` / `/key/swarm/psk/1.0.0`). El Nodo A del Banco 1 solo puede comunicarse con el Nodo B del Banco 1.

```
┌──────────────────┐               ┌──────────────────┐
│   Silo Banco 1   │   SIN PUENTE  │   Silo Banco 2   │
│  (PSK Aislado)   │ <═══════════> │  (PSK Aislado)   │
└──────────────────┘               └──────────────────┘
```

#### Deficiencias Críticas:
1. **Extinción del Ecosistema de Agentes Autónomos:**
   - Los agentes de IA (en Cursor, Claude Desktop o clústeres cloud) no pueden descubrir ni orquestar análisis inter-institucionales.
2. **Duplicación de Costos de Integración:**
   - Auditorías conjuntas (ej. evaluar el riesgo sistémico de liquidez entre 50 bancos) requerirían configurar 50 VPNs punto a punto independientes, reviviendo la pesadilla de integración que LIOP vino a erradicar.
3. **Pérdida del Efecto Red:**
   - El protocolo queda reducido a una librería interna de RPC con sandbox, perdiendo su naturaleza de red descentralizada.

---

## 3. La Solución Canónica: Malla Soberana Estratificada en Tres Niveles

Internet triunfó porque no forzó una red plana, sino que federó redes autónomas mediante **Sistemas Autónomos (AS)**, **Protocolo de Pasarela Fronteriza (BGP)** y **Zonas Desmilitarizadas (DMZ)**. LIOP traslada estos principios probados al cómputo criptográfico descentralizado.

### 3.1 Nivel 1: Enclave Soberano Intra-Organizacional (El Santuario de Datos)
- **Propósito:** Alojar los datos físicos propietarios y ejecutar el cómputo en aislamiento total.
- **Límites de Red:** Confinado a subredes privadas internas (`10.0.0.0/8`, `172.16.0.0/12`) o interfaces loopback. Sin IP pública, sin puertos de entrada WAN abiertos.
- **Transporte Mesh:** Instancias locales de `libp2p` configuradas con Swarm Key privada (`pnet`), sin difusión mDNS hacia interfaces externas y con protocolo DHT local `/liop/lan/kad/1.0.0`.
- **Aislamiento de Cómputo:** El `WasiSandbox` corre adyacente a la base de datos de origen (PostgreSQL, ClickHouse, PACS médicos). Acepta micro-módulos WASM **únicamente desde el Gateway Soberano de Borde interno**.
- **Garantía:** Los registros crudos residen en memoria/disco dentro de este enclave; son procesados por WASI, agregados, sellados con un ZK-Receipt y enviados al Gateway.

### 3.2 Nivel 2: Mallas Federadas de Consorcio Sectorial (Peering Basado en Confianza)
- **Propósito:** Permitir computación segura multipartita e inteligencia colectiva entre organizaciones soberanas de un sector regulado sin centralizar la custodia.
- **Sectores Clave:**
  - *Defensa Financiera Global:* Detección interbancaria de fraude, prevención de lavado de dinero (AML) y auditorías de liquidación transfronteriza.
  - *Salud e Investigación Clínica:* Ensayos oncológicos multi-hospitalarios que cumplen simultáneamente con HIPAA (EE. UU.), RGPD (UE) y regulaciones locales.
  - *Energía e Infraestructura Crítica:* Análisis de estabilidad de red eléctrica en tiempo real entre operadores independientes.
- **Identidad y Membresía:**
  - Nodos identificados con certificados **ML-DSA-65 (FIPS 204)** registrados en el Manifiesto Génesis del Consorcio.
  - mTLS mutuo con recarga en caliente de certificados (`CertManager`) anclados a la CA raíz del consorcio.
- **Espacio DHT:** Kademlia independiente con protocolo aislado: `/liop/consortium/<sector>/kad/1.0.0`.
- **Tokens y Alcance:** OAuth 2.1 M2M conforme a **RFC 8707** con claim de recurso `urn:liop:mesh:consortium`.

### 3.3 Nivel 3: Dorsal Pública Global de Descubrimiento (La Malla a Escala de Internet)
- **Propósito:** Ofrecer discoverabilidad planetaria para datos públicos, modelos abiertos, oráculos de mercado y Gateways de Borde de organizaciones.
- **Supernodos Bootstrap:** Operados por la fundación del protocolo e instituciones custodias en clusters distribuidos con enrutamiento BGP Anycast (US-East, EU-Central, AP-Southeast).
- **Direccionamiento Bootstrap:** Multiaddrs canónicos integrados en el SDK con soporte de DNSLink y DNS-over-HTTPS (`/dns4/seed-us.liop.network/...`).
- **Enrutamiento Público:** DHT global estándar `/liop/global/kad/2.0.0`. Los CIDs publicados corresponden a **Descriptores Públicos de Capacidad**, jamás a datos sensibles.
- **Acceso:** Cualquier agente de IA del mundo puede interrogar la Dorsal para localizar proveedores de cómputo soberano.

---

## 4. El Componente Crítico: El Gateway Soberano de Borde (BLG)

El **Border LIO Gateway (BLG)** o `LiopHybridGateway` es la pieza maestra que conecta el Nivel 3 y Nivel 2 con el Nivel 1. Opera como firewall de protocolo, proxy inverso de Capa 7 y frontera de verificación Zero-Trust.

```
       RED WAN NO CONFIABLE / SEMI-CONFIABLE (Nivel 3 / Nivel 2)
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│                BORDER LIO GATEWAY (BLG)                          │
│                                                                  │
│  [Ingreso de Red]                                                │
│   ├── Multiplexación: HTTP/2 (gRPC) y HTTP/1.1 (gRPC-Web / MCP)   │
│   ├── Validación OAuth 2.1 RFC 8707 (Resource & Scope Check)     │
│   └── Limitador de Tasa Token-Bucket OWASP API4 O(1)             │
│                                                                  │
│  [Escudos de Inspección Previa de Ingress]                       │
│   ├── Handshake Post-Cuántica ML-KEM-768 (Derivación de Secreto) │
│   ├── Verificador de Firmas ML-DSA-65                            │
│   ├── Guardian AST en Tiempo Cero (Inspección estricta de imports)│
│   └── Análisis de Taint IFC (Control de Flujo de Información)     │
│                                                                  │
│  [Puente de Despacho]                                            │
│   └── Despacha la lógica sanitizada al Nodo de Datos interno     │
└─────────────────────────────────┬────────────────────────────────┘
                                  │ Enlace Seguro Interno (Nivel 1)
                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│             NODO DE DATOS (Núcleo de Cómputo en Origen)          │
│                                                                  │
│  [Sandbox de Ejecución]                                          │
│   ├── Isolate V8 / Wasmtime con 25 Globales Envenenados          │
│   ├── 11 Prototipos Congelados (Mitigación CWE-915)              │
│   └── Evaluación in-situ sobre el dataset local                  │
│                                                                  │
│  [Escudos de Egress y Atestación]                                │
│   ├── Política Aggregation-First (Rechazo de registros crudos)   │
│   ├── Escudo PII en 4 Etapas (Exacto, Fuzzy, Regex, NER)         │
│   ├── Privacidad Diferencial Laplace NIST SP 800-226             │
│   └── Sellado HMAC-SHA256 de ZK-Receipt (dataset_hash anclado)   │
└─────────────────────────────────┬────────────────────────────────┘
                                  │ Respuesta Agregada + ZK-Receipt
                                  ▼
                RETORNO VÍA GATEWAY HACIA EL AGENTE REMOTO
```

### Reglas Invariantes del Gateway de Borde:
1. **Asimetría de Flujo (Ingress vs Egress):**
   - **Ingress (Hacia adentro):** La lógica inyectada (WASM/código) puede ingresar desde el Nivel 3/2 hacia el Nivel 1 *únicamente* si supera el Guardian AST y el análisis de Taint.
   - **Egress (Hacia afuera):** Los datos crudos tienen **físicamente prohibido** salir. Solo pueden cruzar hacia afuera resultados matemáticos agregados, perturbados con Privacidad Diferencial y certificados con ZK-Receipts.
2. **Interfaces de Red Aisladas (DMZ Físico o Virtual):**
   - Interfaz Externa: Expuesta a la red pública o de consorcio con WAF y rate limiting.
   - Interfaz Interna: Conectada exclusivamente a la red privada del enclave de datos.

---

## 5. Matriz de Decisión Operativa: ¿Qué Topología Implementar?

| Caso de Uso Operativo | Topología Recomendada | Configuración de Red | Identidad y Autenticación | Criptografía y Sellado |
|---|---|---|---|---|
| **Microservicios Internos de Empresa** | **Solo Nivel 1** (Enclave Privado) | Subredes locales; `enableWAN: false`; Swarm Key PSK; `enableMdns: true` | API Keys internas o JWTs de Service Account | AES-256-GCM; ZK-Receipts locales HMAC-SHA256 |
| **Consorcio Hospitalario / Ensayos Clínicos** | **Nivel 1 + Nivel 2** (Consorcio Federado) | Seeds de consorcio; DHT `/liop/salud/kad/1.0.0`; AutoNAT + Relay v2 | mTLS mutuo (`CertManager`) + OAuth 2.1 RFC 8707 | ML-KEM-768 (Kyber); firmas ML-DSA-65; Privacidad Diferencial |
| **Riesgo Interbancario y Auditoría Financiera** | **Nivel 1 + Nivel 2** (Peering Regulado) | Red dedicada; allowlist de IPs estricta; keepalive simétrico (30s) | Atestación TEE de Hardware + ML-DSA-65 | Sesiones PQC con TTL < 1h; ancla dataset_hash SOX |
| **Servicio Público de IA (LIOaaS)** | **Nivel 1 + Nivel 3** vía Border LIO Gateway | Seeds públicas Anycast; `/liop/global/kad/2.0.0`; Hybrid Gateway activo | API Keys públicas o OIDC; WebAuthn | Las 6 Capas de Seguridad; Rate Limiter HTTP 429 |
| **Proveedor de Datos Públicos / Oráculo** | **Solo Nivel 3** (Nodo Público) | DHT pública; anuncio abierto; AutoNAT y DCUtR activos | PeerId Ed25519 público; manifiestos firmados | ZK-Receipts públicos auditables por terceros |

---

## 6. Correspondencia Real con la Arquitectura de Internet

| Componente de Internet Global | Función en Redes IP Tradicionales | Equivalente en el Protocolo Soberano LIOP |
|---|---|---|
| **Sistema Autónomo (AS)** | Dominio de enrutamiento bajo una única autoridad administrativa. | **Enclave Soberano Organizacional (Nivel 1)** gobernado bajo una política interna de datos. |
| **BGP-4 (Border Gateway Protocol)** | Protocolo que intercambia rutas de alcance entre Sistemas Autónomos. | **Intercambio Federado de Capacidades (FCX) & DHT** intercambiando manifiestos firmados de cómputo. |
| **Router de Frontera / Firewall DMZ** | Dispositivo perimetral que filtra paquetes hacia la intranet corporativa. | **Border LIO Gateway / Hybrid Gateway** que inspecciona el AST antes de enrutar la lógica a los datos. |
| **Puntos de Intercambio de Tráfico (IXP)** | Infraestructura física donde los ISPs realizan peering directo. | **Supernodos de Consorcio (Nivel 2)** enrutando flujos multiplexados Yamux entre pares autorizados. |
| **Servidores Raíz DNS (A-M)** | Directorio autoritativo distribuido que traduce nombres a direcciones IP. | **Supernodos Bootstrap Anycast (Nivel 3)** resolviendo CIDs de capacidad a multiaddrs de proveedores. |
| **Redes Privadas Virtuales (VPN / IPSec)** | Túnel cifrado entre extremos autorizados a través de la WAN pública. | **Claves Swarm PSK libp2p + Túnel PQC ML-KEM-768** aislando comunicaciones de consorcio y empresa. |
| **Cifrado Extremo a Extremo TLS/HTTPS** | Protege los bytes de datos contra escuchas no autorizadas en tránsito. | **Cápsula Post-Cuántica (ML-KEM-768) + ZK-Receipt** garantizando privacidad matemática e integridad. |

---

## 7. Invariante Estratégico: El Faro del Protocolo

La respuesta definitiva a cómo debe operar oficialmente LIOP queda sellada en este invariante fundamental:

> ### Invariante de Topología Soberana
> **"LIOP no fuerza a las organizaciones a una monocultura global insegura, ni las condena a un aislamiento incomunicado. LIOP opera como una red federada de redes, donde los datos permanecen anclados en enclaves soberanos de Nivel 1, la colaboración se media a través de consorcios de Nivel 2 criptográficamente verificados, y la descubribilidad se expande a través de la dorsal global de Nivel 3."**
