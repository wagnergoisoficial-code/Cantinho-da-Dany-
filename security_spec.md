# Security Specification — Dany Clean Pro (Etapa 01)

## 1. Data Invariants
1. **Zero Anonymous / Unauthenticated Access**: Every read and write in `/workspaces/{workspaceId}/**` requires `request.auth != null`, `request.auth.token.email_verified == true`, and `request.auth.token.email` strictly in `['wagnergoisoficial@gmail.com', 'danycleanenpro@gmail.com']`.
2. **Master Gate**: Subcollections (`settings`, `leads`, `helpers`, `meta`) require `workspaceId == 'dany_clean_pro'` and, on single-document operations (`get`, `create`, `update`, `delete`), verify parent existence at `/workspaces/dany_clean_pro`. Collection `list` queries enforce `resource.data.workspaceId == workspaceId` without invoking `get()`/`exists()` inside `allow list`.
3. **Path Variable Hardening**: All document IDs (`workspaceId`, `settingId`, `leadId`, `helperId`, `metaId`) must match `^[a-zA-Z0-9_-]+$` and length `1..128`.
4. **Strict Schema & No Shadow Fields**: Every document write passes a standalone `isValid*` helper checking exact allowed keys (`hasAll` + `hasOnly`), type safety, bounded string sizes, and bounded array lengths.
5. **Temporal Integrity & Optimistic Versioning**: `serverUpdatedAt == request.time`, `updatedByEmail == request.auth.token.email`, `recordVersion is int && recordVersion >= 1` on create, and `incoming().recordVersion == existing().recordVersion + 1` on update.
6. **Immutability**: `workspaceId` cannot change on update; `id` and `createdAt` cannot change on leads; `id` and `savedAt` cannot change on helpers.

## 2. "Dirty Dozen" Adversarial Payloads (All Must Return `PERMISSION_DENIED`)
1. Unauthenticated read of `/workspaces/dany_clean_pro/leads/lead_1`.
2. Authenticated non-allowlisted user (`attacker@gmail.com`, `email_verified: true`) reading `/workspaces/dany_clean_pro/settings/pricing`.
3. Email spoofing (`wagnergoisoficial@gmail.com` with `email_verified: false`) writing `/workspaces/dany_clean_pro/leads/lead_1`.
4. Ghost/shadow field (`isAdmin: true` or `extraField: "x"`) in lead create or update payload.
5. ID poisoning (`leadId` containing spaces, slashes, or >128 chars, or `data.id != leadId`).
6. Workspace escape (`workspaceId: "other_tenant"` on subcollection create or update).
7. Timestamp forgery (`serverUpdatedAt` set to client `Timestamp.now()` instead of `request.time`).
8. Version rollback/overwrite (`recordVersion` equal to or lower than `existing().recordVersion` on update).
9. Immutable field tampering (`createdAt` or `id` altered during lead update).
10. Invalid enum injection (`status: "Hacked"` or `serviceType: "unknown"`).
11. Resource exhaustion / Denial of Wallet (`notes` > 6000 chars or `interactionHistory` > 500 items).
12. `updatedByEmail` spoofing (authenticated as `wagnergoisoficial@gmail.com` but writing `updatedByEmail: "danycleanenpro@gmail.com"`).
