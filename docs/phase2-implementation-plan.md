# План Phase 2 — Evidence Library

**Статус:** реализовано (Phase 2). Решения A–F приняты заказчиком. Solidity не изменялся.

Ниже — утверждённый план. Leaf encoding зафиксирован в Phase 1.

---

## 1. Цель Phase 2

Сделать TypeScript-библиотеку, которая:

1. Собирает **canonical evidence manifests** (RFC 8785).
2. Считает **content hashes**, **leaf hashes**, **Merkle root/proofs**.
3. Собирает **export envelope** для offline-проверки.
4. Даёт данные для submit/verify обеих variants:
   - `IndividualHashEscrow.submitDelivery(id, bytes32[] commitments)`
   - `MerkleRootEscrow.submitDelivery(id, root, declaredCount)`
   - `verifyEvidence(...)` (view) — leaf + optional proof

Библиотека **не** шлёт транзакции, **не** хранит файлы, **не** авторизует оплату.

---

## 2. Требования (из docs + контрактов)

| Источник | Требование |
| --- | --- |
| `implementation-plan.md` | `packages/evidence`, RFC 8785, file/URL hashing, manifest без root, Standard Merkle + export, Vitest |
| `architecture.md` | Также `packages/shared` в Phase 2 |
| `evidence-format.md` | Leaf schema v1, salts, manifest v1, export v1, OZ Standard MerkleTree |
| `protocol-spec.md` | Agreement canonical JSON + keccak256 (ключи и правила типов) |
| Контракты | Тот же leaf ABI encoding; max 100 items; schemaVersion=1 |
| `research-methodology.md` | `@openzeppelin/merkle-tree@1.0.8`; Phase 4 будет мерить sizes/timings этой библиотеки |

### Совместимость leaf (не менять)

```text
encoding: ["uint16","uint256","address","uint256","uint32","uint32","bytes32","bytes32","bytes32"]
leaf = keccak256(bytes.concat(keccak256(abi.encode(...))))
```

Как в `EvidenceCommitment.sol` и `generate-merkle-fixtures.mjs`.

### Что библиотека должна отдавать on-chain

| Variant | Submit payload | Verify payload |
| --- | --- | --- |
| Individual | `leafHashes[]` по index order | recomputed leaf (без proof) |
| Merkle | `root` + `declaredItemCount = items.length` | leaf + `proof[]` против **stored** root |

---

## 3. Предлагаемая структура пакетов

```text
packages/shared/                 # типы + константы (без тяжёлой крипты)
  package.json
  src/index.ts
  src/constants.ts
  src/types/agreement.ts
  src/types/evidence.ts
  src/types/status.ts

packages/evidence/               # каноникализация, hashing, merkle, export, verify
  package.json
  tsconfig.json
  vitest.config.ts
  src/index.ts
  src/canonicalize.ts
  src/hash.ts
  src/salt.ts
  src/evidence-type.ts
  src/content.ts
  src/leaf.ts
  src/manifest.ts
  src/merkle.ts
  src/export.ts
  src/verify-offchain.ts
  src/agreement.ts               # см. открытый вопрос ниже
  src/submit.ts                  # helpers для calldata обеих variants
  test/...
  test/vectors/...
```

Root `package.json` — добавить скрипты `test:evidence`, при необходимости `test`.

**Контракты не менять.** `generate-merkle-fixtures.mjs` оставлять; добавить тест, что evidence lib совпадает с `merkle-vectors.json`.

---

## 4. Модули и функции

### 4.1. `packages/shared` — типы и константы

**Constants**

```ts
EVIDENCE_SCHEMA_VERSION = 1
MAX_EVIDENCE_ITEMS = 100
MAX_REVISIONS = 1
LEAF_ENCODING = [...] // как выше
EVIDENCE_TYPES = {
  file: "evidencebound.file.v1",
  urlReference: "evidencebound.url-reference.v1",
  snapshot: "evidencebound.snapshot.v1",
}
SCHEMAS = {
  agreement: "evidencebound.agreement.v1",
  manifest: "evidencebound.manifest.v1",
  export: "evidencebound.evidence-export.v1",
  urlReference: "evidencebound.url-reference.v1",
}
EvidenceStatus = 0..7 // как IEscrow
```

**Types (черновик)**

- `AgreementDocument` — поля из protocol-spec
- `Manifest`, `ManifestItem`
- `EvidenceLeafFields` — 9 полей leaf
- `EvidenceExport`
- `OffchainVerifyResult` — on-chain statuses + off-chain (`MissingArtifact`, `ContentMismatch`, …)

### 4.2. Canonicalization — `canonicalize.ts`

- Обёртка над pinned RFC 8785 lib (кандидат: `canonicalize` / erdtman — reference RFC; pin после проверки vectors).
- API: `canonicalizeJson(value): string` (UTF-8 string).
- Тест: deterministic key order; известные RFC vectors (минимум).

### 4.3. Hashing — `hash.ts`

- `keccak256Bytes(data: Uint8Array): Hex`
- `keccak256Utf8(text: string): Hex`
- Использовать ту же keccak, что у OZ merkle stack (`ethereum-cryptography/keccak`), чтобы совпасть с fixtures.

### 4.4. Salt — `salt.ts`

- `randomSalt(): Hex` — 32 crypto-random bytes (`crypto.getRandomValues`).
- В тестах — injectable RNG / fixed salts (как в fixtures).

### 4.5. Evidence type — `evidence-type.ts`

- `hashEvidenceType(label: string): Hex` → `keccak256(utf8)`
- Рекомендованные labels; unknown labels не запрещать (как on-chain).

### 4.6. Content hashes — `content.ts`

| Функция | Preimage |
| --- | --- |
| `hashFileBytes(bytes)` | raw bytes, без prefix |
| `hashSnapshotBytes(bytes)` | то же (snapshot = file-like) |
| `hashUrlReference(url)` | keccak256(RFC8785 `{"schema":"...url-reference.v1","url":...}`) |

### 4.7. Leaf — `leaf.ts` (**критично**)

```ts
hashEvidenceLeaf(fields): Hex
// через StandardMerkleTree.leafHash(LEAF_ENCODING, values)
// или эквивалент double-keccak abi.encode — результат должен = OZ 1.0.8
```

Поля в порядке Solidity `EvidenceLeaf`.  
Адрес — checksum/lowercase так, как ждёт OZ encoder (как в fixtures: lowercase `0x…`).

Обязательный тест: каждый case из `packages/contracts/test/fixtures/merkle-vectors.json` → тот же `leafHash`.

### 4.8. Manifest — `manifest.ts`

```ts
buildManifest({
  chainId, escrowContract, escrowId, deliveryVersion,
  items: [{ index, evidenceTypeLabel, contentHash, salt, byteLength, storageKey }]
}): Manifest

canonicalizeManifest(manifest): string
hashManifest(manifest): Hex  // keccak256(utf8(canonical bytes))
```

Правила:

- `schema: evidencebound.manifest.v1`
- **нет** `root` / `proofs` внутри manifest
- items 1..100, indexes `0..n-1` без дыр
- `storageKey` — generated id, не user path
- filenames **не** в manifest

### 4.9. Merkle — `merkle.ts`

Только `@openzeppelin/merkle-tree@1.0.8`, `StandardMerkleTree.of(..., LEAF_ENCODING)` с default `sortLeaves: true`.

```ts
buildDeliveryTree(leaves): { tree, root, leafHashesInIndexOrder, getProof(index) }
```

- 1 leaf → root = leafHash, proof = `[]`
- Не писать свой hashPair

Тест: roots/proofs = `merkle-vectors.json` (single/pair/triple/five/duplicate-content).

### 4.10. Export — `export.ts`

Зафиксировать envelope (сейчас в docs «may contain» — нужно закрепить):

```jsonc
{
  "schema": "evidencebound.evidence-export.v1",
  "manifest": { /* manifest object */ },
  "manifestHash": "0x...",
  "leafEncoding": ["uint16", "..."],
  "leaves": [
    {
      "index": 0,
      "leafHash": "0x...",
      "fields": { /* 9 leaf fields */ },
      "proof": ["0x..."]  // для individual тоже можно [] или опустить
    }
  ],
  "root": "0x...",
  "declaredItemCount": 2
}
```

```ts
buildExport(manifest, tree): EvidenceExport
parseExport(json): EvidenceExport  // validate schema/shape
```

### 4.11. Submit helpers — `submit.ts`

```ts
toIndividualSubmit(export|leaves): { commitments: Hex[] }  // index order
toMerkleSubmit(export|tree): { root: Hex, declaredCount: number }
```

Так Phase 3/4 не дублируют encoding.

### 4.12. Off-chain verify — `verify-offchain.ts`

Проверка **до** / рядом с on-chain view:

1. Artifact bytes → contentHash совпал?
2. Leaf fields совпали с manifest item?
3. Leaf hash ∈ export.leafHashes / proof→root?
4. Binding: schema/chain/contract/escrowId/version (зеркало `_bindingStatus`)

Отдельно от on-chain enum: `MissingArtifact`, `ManifestMissing`, `ContentHashMismatch` (как в evidence-format: chain не видит missing files).

### 4.13. Agreement — `agreement.ts` (см. gaps)

По `protocol-spec.md` (Phase 2):

```ts
buildAgreement(doc): AgreementDocument
canonicalizeAgreement(doc): string
hashAgreement(doc): Hex  // keccak256(canonical UTF-8)
```

Правила: decimal strings для ints/timestamps/durations/chainId; addresses lowercase `0x`; `maxRevisions: "1"`; `schema: evidencebound.agreement.v1`.

---

## 5. Пошаговый план реализации

| Шаг | Действие | Критерий готовности |
| --- | --- | --- |
| 0 | Подтверждение плана + решений по gaps | Подтверждение получено |
| 1 | Scaffold `packages/shared` + `packages/evidence` (pnpm, TS, Vitest) | `pnpm -r` видит пакеты |
| 2 | Pin RFC 8785 lib после mini-vectors | Тест canonicalize проходит |
| 3 | `hash` + `salt` + `evidence-type` + `content` | Unit tests |
| 4 | `leaf` + parity vs `merkle-vectors.json` | Все leafHash совпали |
| 5 | `merkle` + parity roots/proofs | Как Foundry `MerkleVectorsTest` |
| 6 | `manifest` + no-root invariant + canonicalize/hash | Vitest |
| 7 | `export` + `submit` helpers | Individual + Merkle payloads |
| 8 | `verify-offchain` adversarial cases | Список Vitest из plan |
| 9 | `agreement` (если включаем в Phase 2) | Hash deterministic |
| 10 | Root scripts + короткий `packages/evidence/README.md` | `pnpm test:evidence` green |
| 11 | **Не** менять Solidity; Foundry suite без регрессий | `forge test` (после установки lib) |

Рекомендуемый порядок внутри шага 8 (из `implementation-plan.md`):

- deterministic canonicalization
- modified file → fail
- wrong salt / escrow / version / chain / contract → fail
- one item, odd counts (1,3,5), duplicate content + distinct salts
- empty / >100 → reject

---

## 6. Зависимости (предложение)

| Пакет | Версия | Зачем |
| --- | --- | --- |
| `@openzeppelin/merkle-tree` | **1.0.8** (pinned) | leaf/tree/proofs |
| `canonicalize` (erdtman) | pin после vectors | RFC 8785 |
| `vitest` | dev | тесты |
| `typescript` | dev | типы |
| `ethereum-cryptography` | explicit или transitive | keccak |

Не добавлять вторую Merkle-реализацию. Не менять OZ Contracts на Solidity-стороне.

---

## 7. Совместимость с escrow — поток данных

```text
artifacts + salts
    → contentHash / manifest items
    → leafHashes (index order)
    → StandardMerkleTree → root + proofs
    → export envelope

IndividualHashEscrow: submitDelivery(id, leafHashes)
MerkleRootEscrow:     submitDelivery(id, root, leafHashes.length)

Verifier:
  off-chain: export + artifact bytes
  on-chain:  verifyEvidence(id, leaf[, proof])  // root только из storage
```

Acceptance по-прежнему **не** требует on-chain proof (Decision уже зафиксирован).

---

## 8. Что не входит в Phase 2

- Next.js / SQLite / uploads (Phase 3)
- Experiment CSV / gas runner (Phase 4)
- Изменение `EscrowBase` / variants / `declaredItemCount` semantics
- EIP-712 wallet typing
- Devcontainer

---

## 9. Gaps / противоречия / решения, нужные до старта

### A. Agreement hashing: Phase 2 или нет?

- `protocol-spec.md`: canonical agreement — **Phase 2**
- `implementation-plan.md` Phase 2: явно только evidence/manifest/merkle/export
- `architecture.md`: `packages/shared` в Phase 2

**Предложение:** включить `agreement.ts` в `packages/evidence` (или thin wrapper в shared types + hash в evidence) в Phase 2 — иначе Phase 3 начнётся без `agreementHash`.

Нужно подтверждение: **да / отложить**.

### B. Точная форма `evidenceType` в manifest

Docs перечисляют поле `evidenceType`, но не говорят: **string label** или **bytes32 hex**.

**Предложение:** в manifest хранить **string label** (`evidencebound.file.v1`); при leaf building делать `keccak256(label)`. В export.leaves.fields — уже `bytes32`, как on-chain.

### C. Точная JSON-схема export envelope

Сейчас «may contain» — слишком свободно для тестов и Phase 3.

**Предложение:** зафиксировать schema из §4.10 как обязательную (все поля required, кроме `proof` optional для individual-only consumers).

### D. `packages/shared` vs всё в `evidence`

Architecture требует shared; implementation-plan не расписывает.

**Предложение:** shared = types/constants only; evidence = logic. Web (Phase 3) импортирует оба.

### E. RFC 8785 dependency

Open item в plan. Кандидат: `canonicalize` (RFC reference). Pin только после теста.

**Предложение:** начать с `canonicalize`, при провале vectors — смена до merge.

### F. Числовые поля agreement как decimal strings

Spec требует strings для amounts/timestamps. Нужно ли то же для manifest (`chainId`, `escrowId`, `deliveryVersion`, `byteLength`, `index`)?

Spec для manifest не уточняет.

**Предложение:** для manifest использовать JSON numbers **только если** они I-JSON-safe integers; либо единообразно decimal strings как в agreement. Предпочтительнее **decimal strings** для всех целых в canonical docs — меньше сюрпризов RFC 8785/floats. Нужно решение.

### G. Нужен ли `templateHash` hashing helper?

В agreement есть `templateHash` как hex. Отдельный builder шаблонов в Phase 2 не описан — **не делать**, только поле в agreement doc.

---

## 10. Риски

| Риск | Митигация |
| --- | --- |
| Leaf mismatch с Solidity | Golden test vs `merkle-vectors.json` |
| Свой Merkle ≠ OZ | Только `StandardMerkleTree` 1.0.8 |
| Root в manifest | Explicit forbid + test |
| Circular root/manifest | root только в export |
| >100 items | Reject в builder (= `MAX_EVIDENCE_ITEMS`) |
| Production salts в fixtures | Test salts deterministic; API docs: crypto random |

---

## 11. Как проверить результат (после реализации)

```bash
pnpm install
pnpm test:evidence          # Vitest Phase 2
# optional:
pnpm fixtures               # contracts fixtures unchanged
forge test --root packages/contracts   # no Solidity drift
```

Ручной чек: взять 1 file → export → `toIndividualSubmit` / `toMerkleSubmit` → значения должны совпасть с `hashEvidenceLeaf` / tree root из OZ.

---

## 12. Что нужно для старта реализации

1. Подтверждение плана в целом.
2. Решения по **A–F** (хотя бы A, B, F).
3. Разрешение ставить зависимости (`canonicalize`, vitest, typescript, pin merkle-tree в evidence).

После подтверждения — реализация строго по этому плану, **без** изменений Solidity, если не всплывёт блокер совместимости (тогда спросить отдельно).
