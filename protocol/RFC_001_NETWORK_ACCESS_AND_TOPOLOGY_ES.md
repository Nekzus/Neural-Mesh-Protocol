# RFC 0001: Estándares de Topología de Red, Gestión de Identidad y Control de Accesos en LIOP

```
Grupo de Trabajo de Red                                        M. Ortega
Petición de Comentarios: 0001                           Nekzus Solutions
Categoría: Estándar Técnico                               Septiembre 2026
ISSN: 2026-LIOP-RFC1-ES
```

# Estado de este Memorando
Este documento especifica un protocolo técnico estándar para la comunidad de cómputo descentralizado e inteligencia artificial, e invita al debate y sugerencias de mejora. La distribución de este memorando es ilimitada.

# Aviso de Propiedad Intelectual
Copyright (c) 2026 Nekzus Solutions y las personas identificadas como autoras del documento. Todos los derechos reservados. Este documento está licenciado bajo la Licencia Internacional Creative Commons Atribución 4.0 (CC BY 4.0).

---

## Resumen
Este documento especifica la topología de red canónica, los mecanismos de verificación de identidad de nodos, el control de accesos granular y los invariantes del gateway perimetral para el protocolo Logic-Injection-on-Origin (LIOP). LIOP rompe con los protocolos tradicionales de extracción de contexto al transmitir la lógica computacional hacia el punto físico de origen de los datos.

Para resolver la tensión entre la descubribilidad abierta entre máquinas y la soberanía estricta de la información, este memorando especifica formalmente la **Arquitectura de Malla Soberana Federada en Tres Niveles (Tri-Tier)**, define los perfiles de autenticación Máquina a Máquina (M2M) bajo OAuth 2.1 y RFC 8707, estandariza el Control de Acceso Basado en Roles por Scopes (RBAC) y especifica la tubería de defensa de 6 capas aplicada por el Border LIO Gateway (BLG).

---

## 1. Introducción y Terminología

### 1.1 Lenguaje de Requisitos
Las palabras clave "DEBE", "NO DEBE", "REQUERIDO", "DEBERÁ", "NO DEBERÁ", "DEBERÍA", "NO DEBERÍA", "RECOMENDADO", "NO RECOMENDADO", "PUEDE" y "OPCIONAL" en este documento deben interpretarse tal como se describe en BCP 14 [RFC2119] [RFC8174] cuando, y solo cuando, aparezcan en mayúsculas sostenidas, como se indica aquí.

### 1.2 El Postulado Logic-Injection-on-Origin (LIO)
> **Postulado de Origen:** Los datos DEBEN permanecer inmóviles en su ubicación física y soberana de origen. La lógica computacional DEBE ser transmitida hacia los datos.

Un Cliente LIOP (Agente) que emite una solicitud NO DEBE exigir la transferencia de datasets crudos de entidades. En su lugar, el cliente DEBE transmitir lógica ejecutable (micro-módulos WASM o representaciones verificadas de Árbol de Sintaxis Abstracta). El Servidor LIOP DEBE ejecutar esta lógica in-situ dentro de un sandbox aislado y DEBE transmitir hacia el exterior únicamente resultados agregados acompañados de recibos criptográficos verificables.

---

## 2. La Topología de Red en Tres Niveles

Todo despliegue de LIOP DEBE ajustarse a uno o más de los tres niveles de red estandarizados que aquí se definen.

```
┌─────────────────────────────────────────────────────────────────┐
│           NIVEL 3: DORSAL PÚBLICA GLOBAL DE DESCUBRIMIENTO      │
│       Supernodos Semilla Anycast BGP, Descubrimiento Abierto    │
└────────────────────────────────┬────────────────────────────────┘
                                 │ Intercambio Federado de Capacidades (FCX)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│           NIVEL 2: MALLA DE CONSORCIO FEDERADO SECTORIAL        │
│       mTLS (Root CA del Consorcio) + OAuth 2.1 RFC 8707         │
└────────────────────────────────┬────────────────────────────────┘
                                 │ Frontera Asimétrica de Ingress
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│           NIVEL 1: ENCLAVE SOBERANO INTRA-ORGANIZACIONAL        │
│       Subredes Aisladas (10.0.0.0/8), Sandbox WASI, Datos Crudos │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 Nivel 1: Enclaves Soberanos Intra-Organizacionales
1. **Aislamiento de Red:** Los nodos de Nivel 1 DEBEN acoplarse estrictamente a namespaces de red privados, subredes internas (ej. `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) o interfaces loopback.
2. **Desactivación de WAN:** Los nodos de Nivel 1 DEBEN configurar `enableWAN: false`. Los nodos NO DEBEN asociarse a direcciones WAN públicas ni aceptar tráfico externo sin verificar.
3. **Prevención de Fugas Multicast:** Los nodos ubicados en VLANs corporativas DEBERÍAN configurar `enableMdns: false` para evitar difundir la topología interna en conmutadores de Capa 2 compartidos.
4. **Colocalización de Datos:** El núcleo de cómputo de Nivel 1 (isolate WASI) DEBE ejecutarse de forma directamente adyacente a la base de datos física. Los registros crudos NO DEBEN serializarse a través de saltos de red externos.

### 2.2 Nivel 2: Mallas de Consorcio Federado Sectoriales
1. **Admisión al Consorcio:** Los nodos que participan en Nivel 2 DEBEN presentar una cadena de certificados X.509 firmada por la Root CA acreditada del consorcio.
2. **Seguridad de Transporte Mutua:** Todos los enlaces entre nodos DEBEN aplicar TLS Mutuo (mTLS) con soporte de recarga en caliente (`CertManager`).
3. **Aislamiento de Espacio de Nombres en DHT:** El descubrimiento entre pares en el consorcio DEBE utilizar cadenas de protocolo Kademlia específicas:
   ```
   /liop/consortium/<slug-dominio>/kad/1.0.0
   ```
   Los nodos del consorcio NO DEBEN publicar registros internos de enrutamiento en la DHT pública.
4. **Ancla de Autorización:** El acceso a través de las fronteras del consorcio DEBE gobernarse mediante tokens de acceso M2M OAuth 2.1 que incorporen Indicadores de Recursos RFC 8707 (`resource: "urn:liop:mesh:consortium"`).

### 2.3 Nivel 3: Dorsal Pública Global de Descubrimiento
1. **Supernodos Semilla:** La fundación del protocolo y los custodios acreditados DEBEN mantener semillas de arranque distribuidas geográficamente con enrutamiento Anycast BGP en al menos tres zonas continentales: US-East, EU-Central y AP-Southeast.
2. **Ámbito de Enrutamiento Público:** El enrutamiento público DEBE utilizar el identificador global de protocolo DHT:
   ```
   /liop/global/kad/2.0.0
   ```
3. **Prohibición de Publicar Datos:** Los nodos NO DEBEN publicar registros de datos sensibles, identificadores clínicos, datos financieros o topologías IP internas en Nivel 3. Los Identificadores de Contenido (CIDs) anunciados en Nivel 3 DEBEN representar estrictamente Manifiestos de Servicio Públicos.

---

## 3. Estándares de Identidad de Nodos y Agentes

### 3.1 Arquitectura de Identidad de Nodos
Cada nodo de LIOP DEBERÁ mantener dos identidades criptográficas independientes:
1. **Identidad de Transporte (Ed25519):** Un par de claves Ed25519 cuyo multihash SHA-256 constituye el `PeerId` canónico de libp2p. Esta identidad DEBE usarse para el handshake Noise (`Noise_XX_25519_ChaChaPoly_SHA256`).
2. **Identidad de Atestación (ML-DSA-65):** Un par de claves de firma digital post-cuántica conforme a NIST FIPS 204. La clave pública y la firma DEBEN incluirse en el manifiesto de servicio del nodo (`pqcPublicKey`, `pqcSignature`).

### 3.2 Autenticación de Agentes Máquina a Máquina (M2M)
1. **Tipo de Concesión:** Los agentes autónomos de IA y daemons cliente DEBEN autenticarse mediante la concesión `client_credentials` de OAuth 2.1. Los flujos interactivos (Authorization Code, Implicit, Password) DEBEN ser rechazados por el Servidor de Autorización.
2. **Perfil JWT:** Los tokens de acceso DEBEN emitirse como JSON Web Tokens (JWT) conformes a RFC 9068.
3. **Lista Blanca de Algoritmos:** Las firmas de los tokens DEBEN verificarse contra una lista permitida restringida a `EdDSA` (Ed25519) y `ES256`. Los tokens firmados con RSA o algoritmos HMAC simétricos DEBEN ser rechazados.
4. **Verificación de Audiencia:** El claim `aud` DEBE coincidir con el identificador de audiencia configurado (por defecto: `urn:liop:mesh:api`).

---

## 4. Especificaciones de Control de Acceso y RBAC

### 4.1 Mapeo de Autorización por Scopes
Los gateways y servidores de recursos DEBEN verificar los scopes antes de ejecutar cualquier método JSON-RPC de MCP:

```
+--------------------------+-----------------------+---------------------+
| Método MCP               | Scope Requerido       | Política por Defecto|
+--------------------------+-----------------------+---------------------+
| initialize               | (Ninguno)             | PERMITIR (Público)  |
| ping                     | (Ninguno)             | PERMITIR (Público)  |
| notifications/*          | (Ninguno)             | PERMITIR (Público)  |
| tools/list               | liop:tools:list       | AUTENTICACIÓN OBLIG.|
| tools/call               | liop:tools:call       | AUTENTICACIÓN OBLIG.|
| resources/list           | liop:resources:read   | AUTENTICACIÓN OBLIG.|
| resources/read           | liop:resources:read   | AUTENTICACIÓN OBLIG.|
| prompts/list             | liop:schema:read      | AUTENTICACIÓN OBLIG.|
| prompts/get              | liop:schema:read      | AUTENTICACIÓN OBLIG.|
| (Método No Reconocido)   | (Fail-Closed)         | DENEGAR             |
+--------------------------+-----------------------+---------------------+
```

### 4.2 Invariante de Falla Cerrada (Fail-Closed)
Siguiendo NIST SP 800-207, si un método entrante no está explícitamente mapeado a un array de scopes vacío y no se presenta un token de autorización válido, el servidor DEBE rechazar la invocación inmediatamente con el código de error JSON-RPC `-32099`.

### 4.3 Endpoint de Metadatos de Recursos Protegidos (PRM)
Los servidores que requieran autenticación DEBEN implementar RFC 9728 y servir el documento en:
```
/.well-known/oauth-protected-resource
```
Cuando se reciba una petición no autenticada en un endpoint protegido, el servidor DEBE responder con estado HTTP `401 Unauthorized` e incluir la cabecera `WWW-Authenticate` con el parámetro `resource_metadata`.

---

## 5. Invariantes del Border LIO Gateway (BLG)

El Border LIO Gateway actúa como la frontera de Capa 7 entre redes externas no confiables y enclaves soberanos internos.

### 5.1 Invariante de Tráfico Asimétrico
1. **Regla de Entrada (Solo Código):** El gateway DEBE permitir que el tráfico entrante cruce hacia el Nivel 1 *únicamente* si la carga consiste en lógica ejecutable que supere la Capa 1 (Guardian AST) y la Capa 3 (Análisis Taint).
2. **Regla de Salida (Solo Agregaciones):** El gateway NO DEBE permitir que filas crudas o registros individuales abandonen el Nivel 1. El tráfico saliente DEBE ser una reducción matemática verificada y sellada con un ZK-Receipt HMAC-SHA256.

### 5.2 La Tubería de Seguridad de 6 Capas
```
[Ingress] ---> [L1: Guardian AST] ---> [L2: WASI Sandbox] ---> [L3: IFC Taint]
                                                                     │
                                                              [Cómputo In-Situ]
                                                                     │
[Egress]  <--- [L6: ZK-Receipt]  <--- [L5: Agregación]   <--- [L4: Escudo PII]
```

1. **L1 (Guardian AST):** El código inyectado DEBE parsearse a un AST. Imports externos, evaluación dinámica (`eval`) e invocaciones fuera de la lista de 14 símbolos permitidos DEBEN ser rechazados.
2. **L2 (Sandbox WASI):** Las variables globales del anfitrión (mínimo 25 símbolos) DEBEN envenenarse con trampas. Los prototipos clave (mínimo 11 símbolos) DEBEN congelarse con `Object.freeze()`. El control de fuel DEBE aplicarse obligatoriamente.
3. **L3 (Análisis IFC Taint):** El código que intente extracción por canales laterales mediante derivación carácter a carácter DEBE ser rechazado.
4. **L4 (Escudo PII de Salida):** La respuesta DEBE superar filtros de coincidencia exacta, difusa, expresiones regulares y NER clínico/financiero.
5. **L5 (Política de Agregación):** La salida DEBE representar una reducción $N \to M$ ($M \ll N$) y DEBE incorporar ruido de Privacidad Diferencial de Laplace según NIST SP 800-226.
6. **L6 (ZK-Receipt):** La respuesta DEBE incluir un recibo HMAC-SHA256 que vincule `dataset_hash`, `logic_hash` y `output_hash`.

---

## 6. Mitigaciones de Seguridad y Amenazas

### 6.1 Mitigación de Secuestro de Rutas Estilo BGP
LIOP elimina la confianza implícita en anuncios de red. Todos los descriptores de capacidad anunciados sobre Kademlia DEBEN firmarse criptográficamente con la clave privada ML-DSA-65 del emisor. Anuncios con firmas inválidas DEBEN descartarse de inmediato.

### 6.2 Mitigación de Ataques Sybil y Eclipse
Las mallas de consorcio de Nivel 2 DEBEN restringir las conexiones exclusivamente a nodos que presenten certificados válidos de la Root CA del consorcio. Nodos que intenten conectarse sin validación mutua de certificados DEBEN ser desconectados en la capa de transporte.

### 6.3 Secreto Hacia Adelante Post-Cuántica
Todas las sesiones de transporte DEBERÍAN negociar claves de sesión mediante **ML-KEM-768 (Kyber)**. Los secretos simétricos negociados DEBEN poseer una vida útil máxima de 3,600 segundos, tras la cual DEBE ejecutarse una renegociación silenciosa automática.

---

## 7. Consideraciones de Registros e IANA

### 7.1 Registros de URIs Well-Known
Este documento registra la siguiente URI según RFC 8615:
- **Sufijo URI:** `oauth-protected-resource`
- **Especificación:** RFC 9728 / LIOP RFC 0001

### 7.2 Espacio de Nombres de Scopes OAuth
Este documento establece el espacio de nombres `liop`:
- `liop:tools:list` — Lectura de declaraciones y esquemas de herramientas
- `liop:tools:call` — Envío de lógica para ejecución
- `liop:resources:read` — Lectura de recursos estáticos y manifiestos
- `liop:schema:read` — Inspección de definiciones de esquemas
- `liop:mesh:query` — Consulta a tablas de enrutamiento de la malla

---

## 8. Referencias Normativas
- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, Marzo 1997.
- **[RFC8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, Mayo 2017.
- **[RFC8707]** Campbell, B., et al., "Resource Indicators for OAuth 2.0", RFC 8707, Febrero 2020.
- **[RFC9068]** Jones, M., et al., "JSON Web Token (JWT) Profile for OAuth 2.0 Access Tokens", RFC 9068, Octubre 2021.
- **[RFC9728]** Jones, M., "OAuth 2.0 Protected Resource Metadata", RFC 9728, 2025.
- **[FIPS203]** National Institute of Standards and Technology, "Module-Lattice-Based Key-Encapsulation Mechanism Standard", FIPS PUB 203, Agosto 2024.
- **[FIPS204]** National Institute of Standards and Technology, "Module-Lattice-Based Digital Signature Standard", FIPS PUB 204, Agosto 2024.
- **[NIST800-207]** Rose, S., et al., "Zero Trust Architecture", NIST Special Publication 800-207, Agosto 2020.
- **[NIST800-226]** National Institute of Standards and Technology, "Guidelines for Evaluating Differential Privacy Guarantees", NIST SP 800-226, 2024.

---

```
Dirección del Autor:
Mauricio Ortega
Nekzus Solutions
Email: dev@nekzus.com
URI: https://github.com/nekzus/liop
```
