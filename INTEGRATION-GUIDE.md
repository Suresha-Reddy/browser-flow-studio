# Integrating Flow Studio output

## Document uploads

Every upload step references a logical document key:

```yaml
- id: upload_photo
  type: upload
  document: applicant_photo
  target:
    labels: [Upload photo]
```

Pass the matching document to the exported runner:

```ts
await runApplicationFlow({
  page,
  input: applicantData,
  documents: {
    applicant_photo: "/secure/job-123/photo.jpg",
    identity_pdf: "/secure/job-123/id.pdf"
  }
});
```

A document value may be a local path, an array of paths, or an in-memory Playwright file payload:

```ts
const file = await objectStore.get("job-123/id.pdf");
documents.identity_pdf = {
  name: "identity.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from(file)
};
```

Validate MIME type and size against `definition.documents` before invoking the runner. Store production files in private encrypted storage, download them to a per-job temporary directory if needed, and delete temporary files after completion.

## Human pause and resume

The exported package includes `HumanGate`. The runner pauses by awaiting `onHumanIntervention`; it resumes only when your application resolves the matching resume token.

```ts
import { HumanGate, runApplicationFlow } from "./generated/src/index.js";

const gate = new HumanGate();

const runPromise = runApplicationFlow({
  page,
  input: applicantData,
  documents,
  callbacks: {
    onHumanIntervention: request => gate.wait(request),
    onHumanState: async event => {
      await jobs.update(jobId, {
        status: event.status === "paused" ? "waiting_for_human" : event.status,
        intervention: event.request
      });
    },
    onCheckpoint: event => jobs.saveCheckpoint(jobId, event)
  }
});
```

Expose authenticated application endpoints that call:

```ts
gate.resume(resumeToken);                    // CAPTCHA or verification completed in live browser
gate.resume(resumeToken, { value: otp });    // OTP returned by your UI
gate.resume(resumeToken, { approved: true });
gate.cancel(resumeToken);
```

For CAPTCHA and visual verification, keep the Playwright page alive and expose a restricted live-browser view to the assigned operator. For OTP, use a `human_input` step with `inputMode: callback_value` and a target so the runner can fill the returned value. Never automate CAPTCHA solving or bypass the portal's verification controls.

`HumanGate` is process-local. For production recovery across service restarts, persist the job checkpoint, browser session identifier, state, step and resume token in your database, then reconnect to the retained browser session before resuming.


---

## Durable Temporal integration (v2)

For Temporal or multi-worker deployments, import `runApplicationFlowUntilPause()` from the generated package. Every invocation returns `paused`, `completed`, or `failed`, always with a versioned, checksum-bound `FlowCheckpoint`. Persist the checkpoint before waiting for a signal, then reconnect to the browser and start a new activity with `checkpoint` plus `interventionResponse`.

`HumanGate` remains supported only for local and same-process integrations. See [TEMPORAL-INTEGRATION.md](./TEMPORAL-INTEGRATION.md) for the full workflow loop, token semantics, execution leases, document metadata, browser recovery and submit non-replay rules.
