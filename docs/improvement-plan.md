# ComfyForge improvement plan

This plan consolidates the next improvements around reliability, maintainability,
multi-user fairness, performance, and first-run usability. Work is split into
independently releasable phases so that each change can be validated and rolled
back without blocking the rest of the roadmap.

## Baseline

- Backend: 57 tests passing and TypeScript build passing.
- Frontend: 15 tests passing, lint passing, and production build passing.
- Initial production bundle: 628.33 kB JavaScript (185.83 kB gzip).
- Main maintenance hotspots: `App.tsx`, `ChatInterface.tsx`,
  `SettingsModal.tsx`, and their stylesheets.
- A verified pre-change archive is stored outside the repository in
  `F:\Antigravity\ComfyRealism-backups`.
- When this plan was opened, `VERSION` and both package manifests were aligned
  at `2.5.0`; runtime drift must be reported, never resolved by silently
  changing these files.

## Phase 1 — architecture and delivery safety

- [x] Lazy-load settings, statistics, and comparison workspaces.
- [ ] Extract page-level state from `App.tsx` into focused hooks/components.
- [x] Add a backend health endpoint with application version, database state,
      queue state, uptime, and ComfyUI reachability.
- [x] Surface frontend/backend version mismatches in the interface.
- [x] Replace forced service-worker reloads with a user-controlled update flow.
- [x] Add Docker healthchecks for the backend and frontend.

Acceptance criteria:

- Initial JavaScript chunk is below the current 628 kB baseline.
- Updating the PWA never reloads an active page without user action.
- `/api/health` distinguishes healthy, degraded, and unavailable dependencies.
- Frontend and backend version drift is visible to administrators.

## Phase 2 — multi-user queue reliability

- [x] Store the queue owner explicitly and backfill it from the session owner.
- [x] Add configurable per-user pending and batch limits.
- [x] Schedule work fairly between users while preserving per-user FIFO order.
- [x] Expose queue ownership, age, and status to administrators.
- [ ] Complete tests for restart recovery and cancellation (fairness and limit
      parsing are covered).

Acceptance criteria:

- One large batch cannot indefinitely block another user.
- Rejected work returns a stable machine-readable error code.
- Queue recovery after restart preserves ownership and ordering.

## Phase 3 — large-library performance and data safety

- [x] Introduce numbered SQLite migrations using `PRAGMA user_version`.
- [x] Add composite indexes for gallery, history, and comparison queries.
- [x] Replace offset pagination with cursor pagination for the gallery while
      retaining offset compatibility for older clients.
- [x] Add stable cursor pagination to comparison history.
- [x] Introduce indexed FTS5 prompt search with safely parameterized tokens.
- [x] Add a verified live SQLite backup command and an out-of-repository Windows
      data-backup script; an authenticated in-app export remains optional.
- [ ] Add retention policies for thumbnails, logs, and abandoned queue rows.

Acceptance criteria:

- Gallery page latency does not grow linearly with the requested page number.
- Database migrations are repeatable and covered by upgrade tests.
- A backup can be restored into an empty installation and pass a health check.

## Phase 4 — navigation, onboarding, and accessibility

- [x] Add stable routes for chat, gallery, comparisons, and statistics.
- [x] Add a first-run wizard for ComfyUI connectivity, model/workflow discovery,
      workflow defaults, and preparation of the first generation.
- [ ] Add recent creations and system health to the empty welcome screen.
- [ ] Replace remaining emoji controls with the shared icon system.
- [ ] Associate labels and inputs, add modal focus management, and verify all
      critical flows using only the keyboard. Login/onboarding labels, settings
      and onboarding focus trapping, session navigation, profile access, and
      lightbox semantics are complete; remaining forms still need an audit.
- [x] Respect reduced-motion preferences globally; light/dark contrast still
      needs an automated audit.

Acceptance criteria:

- Browser back/forward and deep links preserve the selected workspace.
- A new administrator can reach a successful test generation from the wizard.
- Critical screens pass automated accessibility checks with no serious issues.

## Phase 5 — observability, security, and end-to-end coverage

- [x] Add request IDs and structured production logs for HTTP requests.
- [x] Apply CSP, frame, content-type, referrer, and permissions policies.
- [x] Restrict large request bodies to endpoints that actually require them.
- [ ] Add Playwright coverage for authentication, generation lifecycle,
      reconnect/retry, gallery batches, comparisons, and PWA updates.
- [x] Enforce a 450 KiB entry-chunk budget during the production build.

Acceptance criteria:

- Every failed generation can be correlated across HTTP, WebSocket, queue, and
  ComfyUI audit records.
- Security headers are verified in an integration test.
- Critical desktop and mobile flows run in CI before Docker images are pushed.

## Release strategy

Each phase should land as a small series of reviewable commits. Database and
queue migrations must be backward-compatible for one release. Feature flags are
preferred for changes that affect scheduling or update behavior, and the
pre-change archive should be retained until the first post-migration backup has
been restored successfully.
