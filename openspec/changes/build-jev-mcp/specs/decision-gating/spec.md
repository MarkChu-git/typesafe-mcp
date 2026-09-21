# Spec Delta

## Purpose

定义把 Jev 返回的概率 / confidence 折算成 `act | review | abstain` 三段决策的规则，确保「能否执行」由代码阈值决定而不是由模型决定，并允许调用方按风险覆盖阈值。

## ADDED Requirements

### Requirement: Decision is computed in code from a certainty value
The system SHALL compute a `decision` ∈ {`act`, `review`, `abstain`} for every decision answer from a single `certainty` value in [0, 1] and two thresholds `act_above` and `review_above`. The rule SHALL be: `certainty ≥ act_above` → `act`; otherwise `certainty ≥ review_above` → `review`; otherwise `abstain`. The system MUST NOT ask Jev whether an action may proceed.

#### Scenario: Above act threshold
- **WHEN** `certainty` is 0.80 and thresholds are 0.8 / 0.5
- **THEN** `decision` is `act`

#### Scenario: Between thresholds
- **WHEN** `certainty` is 0.79 and thresholds are 0.8 / 0.5
- **THEN** `decision` is `review`

#### Scenario: Below review threshold
- **WHEN** `certainty` is 0.49 and thresholds are 0.8 / 0.5
- **THEN** `decision` is `abstain`

### Requirement: Certainty source depends on question type
For Choice and Score answers the system SHALL use the API-provided `confidence` as `certainty`. For Noul answers the system SHALL use `certainty = |probability − 0.5| × 2`, so that probability 1.0 or 0.0 yields certainty 1 and probability 0.5 yields certainty 0.

#### Scenario: Noul near certain yes
- **WHEN** a Noul answer has `probability: 0.95`
- **THEN** `certainty` is 0.9 and `decision` is `act` under default thresholds

#### Scenario: Noul near certain no
- **WHEN** a Noul answer has `probability: 0.05`
- **THEN** `certainty` is 0.9、`answer` is `false`、and `decision` is `act`

#### Scenario: Noul coin flip
- **WHEN** a Noul answer has `probability: 0.5`
- **THEN** `certainty` is 0 and `decision` is `abstain`

#### Scenario: Choice uses confidence not top probability
- **WHEN** a Choice answer has `probabilities: {a: 0.6, b: 0.4}` and `confidence: 0.2`
- **THEN** `certainty` is 0.2 and `decision` is `abstain`

### Requirement: Default thresholds and per-call override
The default thresholds SHALL be `act_above = 0.8` and `review_above = 0.5`. Every decision tool SHALL accept optional `act_above` and `review_above` numbers in [0, 1]. The system SHALL reject a call where `review_above > act_above`.

#### Scenario: Stricter override
- **WHEN** a call sets `act_above: 0.95` and the answer's certainty is 0.9
- **THEN** `decision` is `review`

#### Scenario: Inverted thresholds
- **WHEN** a call sets `act_above: 0.4` and `review_above: 0.6`
- **THEN** the call is rejected with `isError: true` explaining that `review_above` must not exceed `act_above`

### Requirement: Result exposes the inputs to the decision
Every decision answer SHALL include the `certainty` used and the effective `thresholds` alongside `decision`, so a caller can audit or recompute the gate.

#### Scenario: Audit fields present
- **WHEN** any decision tool returns successfully
- **THEN** the structured answer contains `decision`、`certainty`、and `thresholds: { act_above, review_above }`
