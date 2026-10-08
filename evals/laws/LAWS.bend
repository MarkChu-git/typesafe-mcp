# Laws for the weighted-cost scorer (see scoring.bend). Written by a human, never edited by the
# AI that proves them: PROOF.bend must prove every law here, and `bend PROOF.bend` is the gate.
import Base
import ./scoring.bend as S

# LAW: "answering with the gold label costs nothing"
law exact_is_free:
  for g: S.Decision
  {S.cost(g, g) == 0n : Nat}

# LAW: "a missing answer costs the worst case for its label"
law missing_is_worst:
  for g: S.Decision
  {S.item_cost(S.Item{g, None{}}) == S.worst(g) : Nat}

# LAW: "auto-approving a request that needed a human is the worst mistake for it"
law approve_is_worst_for_review:
  {S.cost(S.HumanReview{}, S.AutoApprove{}) == S.worst(S.HumanReview{}) : Nat}

# LAW: "auto-approving a request that should be denied is the worst mistake for it"
law approve_is_worst_for_deny:
  {S.cost(S.Deny{}, S.AutoApprove{}) == S.worst(S.Deny{}) : Nat}

# LAW: "denying a request that should be auto-approved is the worst mistake for it"
law deny_is_worst_for_approve:
  {S.cost(S.AutoApprove{}, S.Deny{}) == S.worst(S.AutoApprove{}) : Nat}

# LAW: "when a request should be denied, sending it to a human costs less than auto-approving it"
law review_beats_approve_on_mistakes:
  {Nat.is_lt(S.cost(S.Deny{}, S.HumanReview{}), S.cost(S.Deny{}, S.AutoApprove{})) == True{} : Bool}

# LAW: "one item never costs more than the worst case for its label"
law item_within_worst:
  for i: S.Item
  {Nat.is_le(S.item_cost(i), S.item_worst(i)) == True{} : Bool}

# LAW: "the total cost never exceeds the worst total, so 1 - actual/worst stays in [0, 1]"
law total_within_worst:
  for items: List<&2, S.Item>
  {Nat.is_le(S.actual(items), S.worst_total(items)) == True{} : Bool}

# LAW: "answering every item with its gold label scores a perfect 1"
law perfect_is_free:
  for golds: List<&2, S.Decision>
  {S.actual(S.perfect(golds)) == 0n : Nat}

# LAW: "correcting one answer never raises the total cost"
law fix_never_hurts:
  for g: S.Decision
  for p: Maybe<&2, S.Decision>
  for rest: List<&2, S.Item>
  {Nat.is_le(S.actual(S.Item{g, Some{g}} <> rest), S.actual(S.Item{g, p} <> rest)) == True{} : Bool}
