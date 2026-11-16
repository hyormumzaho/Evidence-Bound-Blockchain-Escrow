# Phase 2 Completion Report — Evidence Library

**Дата:** 2026-11-09  
**Статус:** Phase 2 реализована и протестирована  
**Solidity:** не изменялся  

Связанные документы:

- План: `docs/phase2-implementation-plan.md`
- Формат evidence: `docs/evidence-format.md`
- Protocol: `docs/protocol-spec.md`
- Общий план: `docs/implementation-plan.md`

---

## 1. Цель Phase 2 (что должно было появиться)

TypeScript-библиотека, которая:

1. Собирает canonical evidence manifests (RFC 8785).
2. Считает content hashes, leaf hashes, Merkle root/proofs.
3. Собирает export envelope для offline-проверки.
4. Даёт submit/verify payloads для обеих variants:
   - `IndividualHashEscrow.submitDelivery(id, bytes32[] commitments)`
   - `MerkleRootEscrow.submitDelivery(id, root, declaredCount)`
   - `verifyEvidence(...)` (view) — leaf + optional proof

Библиотека **не** шлёт транзакции, **не** хранит файлы, **не** авторизует оплату.

---

## 2. Принятые решения по открытым вопросам (A–G)

| ID | Решение | Как реализовано |
| --- | --- | --- |
| **A** | Agreement hashing включён в Phase 2 | `packages/evidence/src/agreement.ts` — `buildAgreement`, `canonicalizeAgreement`, `hashAgreement` |
| **B** | В manifest — string label; в leaf — `keccak256(label)` | `ManifestItem.evidenceType: string`; `buildLeafFields` → `hashEvidenceType` |
| **C** | Жёсткая JSON-схема export + строгая валидация | `buildExport` / `parseExport` / `serializeExport` / `parseExportJson` |
| **D** | `packages/shared` = типы/константы; crypto в `packages/evidence` | Разделение пакетов соблюдено |
| **E** | `canonicalize@2.1.0` после проверки vectors | Pinned; тесты deterministic key order + nested RFC-style object |
| **F** | Decimal strings для целых в canonical JSON | Agreement + manifest: `chainId`, `escrowId`, `index`, `byteLength`, … как decimal strings; ABI-преобразование в `manifestToLeafFields` |
| **G** | Отдельный template builder не делать | Только поле `templateHash` в agreement document |

---

## 3. Результаты тестов

### 3.1. Evidence library

```bash
pnpm test:evidence
```

| Результат | Значение |
| --- | --- |
| Test files | **6 passed** |
| Tests | **28 passed** |
| Failed | **0** |

Файлы suite:

| Файл | Что покрывает |
| --- | --- |
| `test/canonicalize.test.ts` | RFC 8785 key order, nested object, URL-reference shape |
| `test/content-agreement.test.ts` | file/URL/type hashing; agreement determinism и validation |
| `test/merkle-vectors.test.ts` | parity leafHash/root/proof vs `merkle-vectors.json` |
| `test/merkle-sizes.test.ts` | proofs для **1, 3, 5, 100** items |
| `test/manifest-export.test.ts` | caps, labels, storageKey, export round-trip, tamper checks |
| `test/verify-adversarial.test.ts` | modified file, wrong salt/escrow/chain/version/contract, duplicate content |

### 3.2. Solidity (регрессия Phase 1)

```bash
forge test --root packages/contracts -vv
```

| Результат | Значение |
| --- | --- |
| Test suites | 6 |
| Tests | **64 passed** |
| Failed | **0** |
| Skipped | **0** |

Контракты и Foundry fixtures не менялись. Все ранее существовавшие 64 теста продолжают работать.

---

## 4. Что реализовано

### 4.1. `packages/shared` — типы и константы

| Модуль | Содержание |
| --- | --- |
| `src/constants.ts` | `LEAF_ENCODING`, `EVIDENCE_SCHEMA_VERSION`, `MAX_EVIDENCE_ITEMS`, `MAX_REVISIONS`, `EVIDENCE_TYPE_LABELS`, `SCHEMAS`, `EvidenceStatus`, `OffchainStatus` |
| `src/types/agreement.ts` | `AgreementDocument` |
| `src/types/evidence.ts` | `Manifest`, `ManifestItem`, `EvidenceLeafFields`, `EvidenceExport`, `EvidenceExportLeaf` |
| `src/types/status.ts` | `VerifyResult` |
| `src/types/hex.ts` | `Hex` |
| `src/index.ts` | public re-exports |

### 4.2. `packages/evidence` — криптографическая логика

| Модуль | API / роль |
| --- | --- |
| `canonicalize.ts` | `canonicalizeJson` — RFC 8785 wrapper |
| `hash.ts` | `keccak256Bytes`, `keccak256Utf8` (`ethereum-cryptography`) |
| `salt.ts` | `randomSalt` — 32 crypto-random bytes |
| `evidence-type.ts` | `hashEvidenceType(label)` → bytes32 |
| `content.ts` | `hashFileBytes`, `hashSnapshotBytes`, `hashUrlReference` |
| `leaf.ts` | `hashEvidenceLeaf`, `buildLeafFields`, `leafValues` — OZ `standardLeafHash` |
| `merkle.ts` | `buildDeliveryTree`, `verifyLeafProof` — `@openzeppelin/merkle-tree@1.0.8` |
| `manifest.ts` | `buildManifest`, `canonicalizeManifest`, `hashManifest`, `manifestToLeafFields`, `manifestLeafHashes` |
| `agreement.ts` | `buildAgreement`, `canonicalizeAgreement`, `hashAgreement` |
| `export.ts` | `buildExport`, `parseExport`, `serializeExport`, `parseExportJson` |
| `submit.ts` | `toIndividualSubmit`, `toMerkleSubmit` |
| `verify-offchain.ts` | `verifyExportLeaf`, `verifyLeafMembership` |
| `hex.ts` | hex/address/decimal helpers и ABI-safe parsing |
| `index.ts` | package public API |
| `README.md` | краткая документация пакета |

### 4.3. Совместимость leaf (не изменена)

```text
encoding: ["uint16","uint256","address","uint256","uint32","uint32","bytes32","bytes32","bytes32"]
leaf = keccak256(bytes.concat(keccak256(abi.encode(...))))
```

Эталон: `packages/contracts/test/fixtures/merkle-vectors.json`  
On-chain: `EvidenceCommitment.sol` / `IEscrow.EvidenceLeaf`

### 4.4. Export envelope (зафиксированная схема)

```jsonc
{
  "schema": "evidencebound.evidence-export.v1",
  "manifest": { /* evidencebound.manifest.v1 */ },
  "manifestHash": "0x...",
  "leafEncoding": ["uint16", "uint256", "address", "uint256", "uint32", "uint32", "bytes32", "bytes32", "bytes32"],
  "leaves": [
    {
      "index": 0,
      "leafHash": "0x...",
      "fields": { /* 9 Solidity leaf fields */ },
      "proof": ["0x..."]
    }
  ],
  "root": "0x...",
  "declaredItemCount": 2
}
```

`parseExport` проверяет:

- schema export/manifest;
- `manifestHash == keccak256(RFC8785(manifest))`;
- `leafEncoding` равен pinned `LEAF_ENCODING`;
- `declaredItemCount == leaves.length == manifest.items.length`;
- каждый `leafHash` пересчитывается из fields;
- каждый proof верифицируется против `root`;
- fields совпадают с manifest-derived leaves.

### 4.5. Поток данных к escrow

```text
artifacts + salts
    → contentHash / manifest items
    → leafHashes (index order)
    → StandardMerkleTree → root + proofs
    → export envelope

IndividualHashEscrow: submitDelivery(id, leafHashes)
MerkleRootEscrow:     submitDelivery(id, root, leafHashes.length)

Verifier:
  off-chain: export + artifact bytes  (packages/evidence)
  on-chain:  verifyEvidence(id, leaf[, proof])  // root только из storage
```

Acceptance по-прежнему **не** требует on-chain proof.

---

## 5. Созданные и изменённые файлы

### 5.1. Новые пакеты / файлы

```text
packages/shared/
  package.json
  tsconfig.json
  src/index.ts
  src/constants.ts
  src/types/hex.ts
  src/types/agreement.ts
  src/types/evidence.ts
  src/types/status.ts

packages/evidence/
  package.json
  tsconfig.json
  vitest.config.ts
  README.md
  src/index.ts
  src/canonicalize.ts
  src/hash.ts
  src/salt.ts
  src/evidence-type.ts
  src/content.ts
  src/hex.ts
  src/leaf.ts
  src/merkle.ts
  src/manifest.ts
  src/agreement.ts
  src/export.ts
  src/submit.ts
  src/verify-offchain.ts
  test/helpers.ts
  test/canonicalize.test.ts
  test/content-agreement.test.ts
  test/merkle-vectors.test.ts
  test/merkle-sizes.test.ts
  test/manifest-export.test.ts
  test/verify-adversarial.test.ts

docs/phase2-implementation-plan.md   (план + статус «реализовано»)
docs/phase2-completion-report.md     (этот отчёт)
```

### 5.2. Изменённые корневые файлы

| Файл | Изменение |
| --- | --- |
| `package.json` | скрипты `test:evidence`, `test`, `build:evidence` |
| `pnpm-lock.yaml` | lockfile новых зависимостей |
| `pnpm-workspace.yaml` | `allowBuilds.esbuild: true` (нужно для Vitest) |
| `.gitignore` | `packages/*/dist/` |

### 5.3. Не изменялись

- Все Solidity-контракты (`EscrowBase`, variants, `MockUSDC`, `EvidenceCommitment`, `IEscrow`)
- Foundry tests / fixtures / deploy scripts
- Phase 3/4/5 код (не создавался)

---

## 6. Зависимости (pinned)

| Пакет | Версия | Назначение |
| --- | --- | --- |
| `@openzeppelin/merkle-tree` | **1.0.8** | standard leaf / tree / proofs |
| `canonicalize` | **2.1.0** | RFC 8785 |
| `ethereum-cryptography` | **3.2.0** | keccak256 для content/agreement/manifest |
| `typescript` | **5.9.3** | types |
| `vitest` | **3.2.4** | tests |
| `@evidencebound/shared` | workspace | types/constants |

Вторая Merkle-реализация **не** добавлялась.

---

## 7. Обнаруженные проблемы и нюансы

1. **API OZ 1.0.8:** публичного `StandardMerkleTree.hashLeaf` нет. Используется `standardLeafHash` из `@openzeppelin/merkle-tree/dist/hashes.js` — та же функция, которой пользуется `StandardMerkleTree` внутри. Результат совпадает с `merkle-vectors.json` и Solidity.

2. **`standardLeafHash` возвращает hex-string**, не `Uint8Array`. Первая реализация ошибочно прогоняла строку через byte-toHex (`0x000x…`). Исправлено: `normalizeHex(standardLeafHash(...))`.

3. **Vitest + workspace packages:** для удобства тестов `package.json` экспортирует TypeScript source (`main`/`exports` → `./src/index.ts`), чтобы не требовать предварительный `tsc` перед `pnpm test:evidence`.

4. **pnpm supply-chain:** для Vitest потребовался `allowBuilds.esbuild: true` в `pnpm-workspace.yaml`.

5. **Противоречий документации, требующих изменения Solidity, не обнаружено.** Leaf encoding, caps и binding semantics сохранены.

---

## 8. Как повторить проверку

```bash
# зависимости workspace
pnpm install

# Phase 2
pnpm test:evidence

# Phase 1 regresssion (Foundry в PATH)
export PATH="$HOME/.foundry/bin:$PATH"
# при необходимости: bash packages/contracts/script/install-deps.sh
forge test --root packages/contracts -vv
```

Ожидание: 28 evidence tests green + 64 forge tests green.

---

## 9. Что не входит / осталось до Phase 3

Phase 2 **не** включает:

- Next.js app / wallet UI / MetaMask
- SQLite metadata и local file uploads
- Server-side path/size checks
- Experiment CSV / gas measurements (Phase 4)
- Devcontainer / public testnet
- Изменение `declaredItemCount` semantics, EIP-712, arbitrator fee

### Следующие шаги для Phase 3 (ещё не начаты)

1. `apps/web` — dashboard, agreement, escrow room, submission, review, arbitrator, independent verifier.
2. SQLite + generated `storageKey` для uploads; лимиты размера; path traversal checks; без execution uploads; без server-side fetch user URLs.
3. UI читает state/balances из chain; payment auth только кошельком.
4. Использовать `@evidencebound/evidence` / `@evidencebound/shared`:
   - `hashAgreement` перед `createEscrow` / `approveAgreement`
   - `buildExport` + `toIndividualSubmit` / `toMerkleSubmit` перед `submitDelivery`
   - off-chain `verifyExportLeaf` + on-chain `verifyEvidence`
5. Mock-funds disclaimer и отдельные сообщения для missing file vs `NotMember`.

---

## 10. Итоговый вердикт

Phase 2 **полностью реализована и протестирована**:

- shared + evidence packages на месте;
- совместимость с OpenZeppelin Merkle Tree 1.0.8 и `merkle-vectors.json` подтверждена тестами;
- agreement hashing включён;
- export round-trip и adversarial cases покрыты;
- Solidity не менялся; все **64** Foundry-теста зелёные;
- **28** Vitest-тестов зелёные.

Готово к Phase 3 как библиотечная зависимость:

```ts
import {
  buildAgreement,
  hashAgreement,
  buildManifest,
  buildExport,
  toIndividualSubmit,
  toMerkleSubmit,
  verifyExportLeaf,
} from "@evidencebound/evidence";
```
