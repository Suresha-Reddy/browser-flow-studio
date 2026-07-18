# Temporal and multi-worker integration

## Production contract

Use `runApplicationFlowUntilPause()` for Temporal activities. Keep `HumanGate` only for local or uninterrupted single-process hosts.

Each activity invocation performs browser work until completion, failure, or the next human boundary. A human boundary returns immediately with a JSON-serializable `FlowCheckpoint` and a cryptographically random intervention token. The Temporal workflow persists the checkpoint, waits for an authenticated signal, and starts a new activity with the checkpoint and validated response.

```ts
let checkpoint: FlowCheckpoint | undefined;
let interventionResponse: InterventionResponse | undefined;

while (true) {
  const result = await browserActivities.runFlowUntilPause({
    applicationId,
    flowPackage,
    checkpoint,
    interventionResponse
  });

  checkpoint = result.checkpoint;
  await persistCheckpoint(checkpoint);

  if (result.status === "completed") return result;
  if (result.status === "failed") throw deserializeFlowError(result.error);

  await persistIntervention(result.intervention);
  interventionResponse = await waitForAuthorizedSignal(result.intervention.token);
}
```

## Checkpoint guarantees

The checkpoint is versioned and tied to flow key, version and SHA-256 checksum. It preserves the next step, completed step instances, extracted non-sensitive values, branch decisions, repeat counters and positions, retry counters, assertion results, manual-review overrides, consumed intervention tokens, submit intent, browser session ID and sanitized page URL.

It never stores applicant input, OTP responses, document buffers, local document paths, storage credentials or URL query strings. Sensitive extraction steps must use `checkpointPolicy: redact` or `checkpointPolicy: omit`.

## Resume token rules

- Tokens use 256 bits of cryptographically secure randomness.
- Tokens are single-use and retained in `consumedInterventionTokens` for idempotent duplicate-signal handling.
- Checkpoint binding associates every token with run ID, immutable flow checksum, state and step.
- OTP tokens default to ten minutes; other interventions default to one hour. A step may set `expiresInSeconds`.
- Tokens contain no OTP, applicant data or secret.
- `responsePattern` and `maximumAttempts` validate OTP-style responses.
- Cancellation consumes the token, writes terminal cancellation state and prevents later resume.

## Browser recovery

When the browser session remains alive, reconnect with `browserSessionId`, detect the checkpoint state and continue from `nextStepId`.

When the browser session is lost, the state replay policy controls recovery:

- `detect_and_continue`: detect a declared entry state and continue only from a proven page.
- `restart_state`: continue from an explicitly declared `restartState` after detecting it.
- `manual_only`: return `MANUAL_FALLBACK_REQUIRED`.
- `never_replay`: never reconstruct or repeat the state automatically.

Any state containing final submit must be `never_replay`. Before clicking submit, the runner persists `submit.attempted` and an idempotency key through `onCheckpoint`. If the worker dies before a result reference is proven, resume returns `SUBMIT_OUTCOME_UNKNOWN` instead of clicking again.

## Execution leases

The host must maintain one active execution lease per application/run. A lease should bind application ID, run ID, worker ID, browser session ID, flow checksum and expiration. Temporal activity retries must acquire the lease before reconnecting to the browser.

## Documents

`RuntimeDocument` supports a path, path array, Playwright file payload or payload array. `ResolvedDocument` preserves original name, MIME type, size, SHA-256, encrypted storage reference and optional temporary path. The runner validates supplied payloads against resolved metadata when both are provided.

Document definitions contain only logical keys and constraints:

```yaml
documents:
  - key: identity_pdf
    required: true
    multiple: false
    acceptedMimeTypes: [application/pdf]
    acceptedExtensions: [.pdf]
    maxBytes: 5242880
```

Upload steps specify `replace`, `append` or `preserve_if_present` and must define a post-upload success assertion. `setInputFiles()` alone is not success.

## Temporal activity boundary

The browser activity should be short-lived relative to human waits. It may persist intermediate checkpoints from `onCheckpoint`, but it must return on a human pause. The workflow—not the activity—waits for OTP, CAPTCHA, approval, login, document review or visual verification.
