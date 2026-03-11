# Frontend Integration Walkthrough: AI Feedback Modes

## Title and Goal

This document defines the frontend work required to align the AI Coach UI with the updated `POST /api/evaluate` backend contract in [api/evaluate.js](d:/_VANACI_WORK/AssertiveComunication/branching-video-sim/api/evaluate.js).

The backend now supports:

- `feedbackMode`, which changes the type of feedback returned
- `previousEvaluation`, which helps preserve score stability across retries
- `attemptNumber`, which supports retry-aware evaluation rules

The frontend must pass these fields correctly and render calibration and practice feedback differently, without re-architecting the existing AI Coach flow.

## Current Frontend Baseline

The current AI Coach implementation is centered in [public/app.js](d:/_VANACI_WORK/AssertiveComunication/branching-video-sim/public/app.js), with scenario definitions in [public/scenario.js](d:/_VANACI_WORK/AssertiveComunication/branching-video-sim/public/scenario.js) and progression thresholds in [public/scenario-config.js](d:/_VANACI_WORK/AssertiveComunication/branching-video-sim/public/scenario-config.js).

Current repo-grounded behavior:

- `renderAiCoachState()` sends a `fetch('/api/evaluate', ...)` request with only `scenarioId`, `situationText`, and `learnerAnswer`.
- That payload currently uses `scenarioId: state.id`, which is incorrect for the backend contract. It should use `state.scenarioId` so the API receives `S1`, `S2`, or `S3`.
- `aiCoachSession` already stores `lastFeedback`, `previousAttempt`, `currentAttempt`, `retryFocus`, and other retry UI metadata.
- `aiCoachSession` does not currently store a full `previousEvaluation` object for reuse on the next API call.
- `renderFeedback()` currently hides rewrite content behind suggested-answer unlock logic and does not give `one_improvement` its own primary UI section.
- Scenario thresholds are already defined in [public/scenario-config.js](d:/_VANACI_WORK/AssertiveComunication/branching-video-sim/public/scenario-config.js):
  - `S1`: `75`
  - `S2`: `85`
  - `S3`: `90`

These existing structures should be extended, not replaced.

## Mode Mapping Decision

Lock the frontend mode mapping to the current three AI Coach scenarios:

- `activity` / `S1` uses `feedbackMode: 'calibration'`
- `activity_sofia` / `S2` uses `feedbackMode: 'practice'`
- `activity_daniel` / `S3` uses `feedbackMode: 'practice'`

This mapping matches the backend prompt behavior in [api/evaluate.js](d:/_VANACI_WORK/AssertiveComunication/branching-video-sim/api/evaluate.js), where calibration is treated as a demonstration mode and practice is treated as learner-generated improvement mode.

## State Changes

### 1. Add `feedbackMode` to AI Coach scenarios

Update each AI Coach state in [public/scenario.js](d:/_VANACI_WORK/AssertiveComunication/branching-video-sim/public/scenario.js):

- `activity` gets `feedbackMode: 'calibration'`
- `activity_sofia` gets `feedbackMode: 'practice'`
- `activity_daniel` gets `feedbackMode: 'practice'`

This keeps mode selection declarative and scenario-specific.

### 2. Extend `aiCoachSession`

Extend the session object in [public/app.js](d:/_VANACI_WORK/AssertiveComunication/branching-video-sim/public/app.js) with:

```js
previousEvaluation: null
```

This field should store the full last successful evaluation payload returned by the API.

### 3. Preserve `previousEvaluation` within the same scenario

Keep `previousEvaluation` intact across revise and resubmit cycles for the current scenario.

Important distinction:

- `previousAttempt` remains the UI-level comparison object used for progress messaging and retry focus
- `previousEvaluation` is the full backend response reused for the next evaluation request

Do not replace one with the other.

### 4. Reset `previousEvaluation` on scenario transitions

Clear `previousEvaluation` when:

- advancing from one AI Coach scenario to another
- leaving AI Coach scope entirely
- starting a fresh scenario after completing or abandoning the prior one

This prevents evaluation context from bleeding across unrelated situations.

## API Contract

The frontend request body should now be:

```json
{
  "scenarioId": "S1 | S2 | S3",
  "situationText": "<state.situationText>",
  "learnerAnswer": "<textarea value>",
  "feedbackMode": "calibration | practice",
  "previousEvaluation": "<full prior successful response or null>",
  "attemptNumber": "<current successful-attempt index for this scenario>"
}
```

Implementation notes:

- `scenarioId` must use `state.scenarioId`, not `state.id`
- `feedbackMode` should come from the scenario definition
- `previousEvaluation` must be the full previous successful evaluation JSON, not a partial subset
- `attemptNumber` should be included even though it was not in the original brief, because [api/evaluate.js](d:/_VANACI_WORK/AssertiveComunication/branching-video-sim/api/evaluate.js) uses it for stuck-detection and scoring stability

Recommended attempt number calculation:

```js
(activityProgress.scenarios[state.scenarioId]?.attempts.length || 0) + 1
```

Because failed API calls do not record attempts today, this remains aligned with current progression logic.

## Fetch Call Update

Update the existing `fetch('/api/evaluate', ...)` block in [public/app.js](d:/_VANACI_WORK/AssertiveComunication/branching-video-sim/public/app.js).

Replace the current body with this shape:

```js
body: JSON.stringify({
    scenarioId: state.scenarioId,
    situationText: state.situationText,
    learnerAnswer: userAnswer,
    feedbackMode: state.feedbackMode || 'practice',
    previousEvaluation: aiCoachSession.previousEvaluation,
    attemptNumber: (activityProgress.scenarios[state.scenarioId]?.attempts.length || 0) + 1
})
```

After a successful response:

```js
aiCoachSession.previousEvaluation = feedback;
```

This assignment should happen only after a successful API response, never on a failed call.

## Rendering Rules

The feedback UI must now branch by mode.

### Calibration Mode

When `feedbackMode === 'calibration'`:

- show `rewrite.best_practice_version` prominently
- render it expanded by default
- do not gate this best-practice content behind `isSuggestedAnswerUnlocked()`
- keep `rewrite.why_this_is_better` visible directly beneath the example
- hide the practice cue box in calibration mode

Calibration is a study/reference experience, so the model answer should be immediately available.

### Practice Mode

When `feedbackMode === 'practice'`:

- never render the best-practice block when `rewrite.best_practice_version === ""`
- always surface `one_improvement` as a visible primary coaching item
- always surface `rewrite.why_this_is_better` as structural guidance, even when no full rewrite text exists
- keep the existing CLEAR score grid, CLEAR coaching report, retry flow, progress line, and threshold gating

Practice mode should reinforce structure and next-step improvements without leaking answer wording.

### Cross-Mode Rules

In both modes:

- do not display the internal `style` field anywhere
- preserve current threshold-gated `CONTINUE` behavior
- preserve existing retry and attempt recording behavior

## Specific UI Refactor Notes

Adjust `renderFeedback()` in [public/app.js](d:/_VANACI_WORK/AssertiveComunication/branching-video-sim/public/app.js) with these rules:

### 1. Promote `one_improvement`

Create a dedicated visible section for `one_improvement`.

This should not be buried inside derived coaching text. It is now a primary API output and should be surfaced directly.

### 2. Separate structural guidance from rewrite visibility

Move `rewrite.why_this_is_better` out of the collapsible suggested-response dependency for practice mode.

Required behavior:

- if practice mode returns no rewrite text, still show the structural guidance bullets
- if calibration mode returns rewrite text, show both the rewrite and its supporting bullets together

### 3. Only use the collapsible block when real rewrite text exists

The suggested-response collapsible should only be used when there is actual `best_practice_version` text to show.

That means:

- calibration mode can show a visible best-practice section immediately
- practice mode should not render an empty suggested-response container

### 4. Bypass unlock logic for calibration

Calibration content should not wait for `isSuggestedAnswerUnlocked()`.

Practice mode may keep current unlock behavior only for any optional suggested-response affordance that still remains, but the structural guidance and `one_improvement` must not be hidden.

## Implementation Notes by File

### [public/scenario.js](d:/_VANACI_WORK/AssertiveComunication/branching-video-sim/public/scenario.js)

Add `feedbackMode` to:

- `activity`
- `activity_sofia`
- `activity_daniel`

### [public/app.js](d:/_VANACI_WORK/AssertiveComunication/branching-video-sim/public/app.js)

Update:

- `aiCoachSession` shape to include `previousEvaluation`
- AI Coach session reset paths so `previousEvaluation` is cleared on scenario change and when leaving AI Coach scope
- evaluate fetch payload so it sends `feedbackMode`, `previousEvaluation`, and `attemptNumber`
- success handler so it stores the returned payload as `aiCoachSession.previousEvaluation`
- `renderFeedback()` so it handles calibration and practice output differently

### [public/scenario-config.js](d:/_VANACI_WORK/AssertiveComunication/branching-video-sim/public/scenario-config.js)

No contract changes are required here, but this file remains the source of truth for threshold gating:

- `S1 = 75`
- `S2 = 85`
- `S3 = 90`

### [api/evaluate.js](d:/_VANACI_WORK/AssertiveComunication/branching-video-sim/api/evaluate.js)

Treat this file as the backend contract source of truth for:

- accepted request fields
- mode-aware behavior
- stability handling via `previousEvaluation`
- retry/stuck logic via `attemptNumber`

This frontend document should reference that contract, not redefine backend logic.

## Success Criteria

The frontend integration is complete when all of the following are true:

- `S1` first submission sends `feedbackMode: 'calibration'`, `previousEvaluation: null`, and `attemptNumber: 1`
- `S1` renders `rewrite.best_practice_version` immediately without waiting for suggested-answer unlock
- `S2` first submission sends `feedbackMode: 'practice'`, `previousEvaluation: null`, and `attemptNumber: 1`
- `S2` practice feedback does not show a blank rewrite block when `best_practice_version === ""`
- `S2` still shows `one_improvement` and `rewrite.why_this_is_better`
- `S2` revise and resubmit sends the full previous evaluation object plus `attemptNumber: 2`
- a stronger second practice response does not produce an unexplained score drop
- moving from `S1` to `S2` clears `previousEvaluation`
- moving from `S2` to `S3` clears `previousEvaluation`
- failed API calls do not update `previousEvaluation`
- failed API calls do not consume a successful-attempt slot
- `S3` still respects the `90`-point threshold and guided-help behavior already implemented

## Public APIs / Interfaces / Types To Call Out

### AI Coach scenario objects

In [public/scenario.js](d:/_VANACI_WORK/AssertiveComunication/branching-video-sim/public/scenario.js), add:

```js
feedbackMode: 'calibration' | 'practice'
```

### AI Coach session object

In [public/app.js](d:/_VANACI_WORK/AssertiveComunication/branching-video-sim/public/app.js), add:

```js
previousEvaluation: object | null
```

### Evaluate request body

In [api/evaluate.js](d:/_VANACI_WORK/AssertiveComunication/branching-video-sim/api/evaluate.js), the frontend must now supply:

- `feedbackMode`
- `previousEvaluation`
- `attemptNumber`

## Test Cases and Scenarios

### Manual verification

1. Scenario 1 calibration
   - Open `activity`
   - Submit a response
   - Confirm request payload includes:
     - `scenarioId: 'S1'`
     - `feedbackMode: 'calibration'`
     - `previousEvaluation: null`
     - `attemptNumber: 1`
   - Confirm the UI renders `best_practice_version` immediately and prominently

2. Scenario 2 first practice attempt
   - Open `activity_sofia`
   - Submit a response
   - Confirm request payload includes:
     - `scenarioId: 'S2'`
     - `feedbackMode: 'practice'`
     - `previousEvaluation: null`
     - `attemptNumber: 1`
   - Confirm no empty rewrite block appears
   - Confirm `one_improvement` and `why_this_is_better` are both visible

3. Scenario 2 retry stability
   - From `activity_sofia`, submit a first weak answer
   - Click revise and submit an improved answer
   - Confirm second request includes the full prior evaluation object
   - Confirm second request sends `attemptNumber: 2`
   - Confirm the second score does not drop unexpectedly when the learner addresses the prior improvement

4. Scenario transition reset
   - Complete `S1` and move into `S2`
   - Confirm `previousEvaluation` has been cleared before the first `S2` request
   - Repeat when moving from `S2` to `S3`

5. Failed API behavior
   - Simulate or force an evaluation failure
   - Confirm the UI does not overwrite `previousEvaluation`
   - Confirm no successful attempt is recorded for threshold progression

6. Scenario 3 gating
   - Submit low-scoring answers in `S3`
   - Confirm threshold gating, failed-attempt tracking, and guided-help behavior remain unchanged

## Assumptions and Defaults

- Document type: implementation spec
- Target location: repo root
- Mode mapping: `S1` calibration, `S2-S3` practice
- Backend response contract in [api/evaluate.js](d:/_VANACI_WORK/AssertiveComunication/branching-video-sim/api/evaluate.js) is the source of truth
- Scope remains frontend-only; this document does not prescribe backend code changes beyond consuming the existing contract correctly
