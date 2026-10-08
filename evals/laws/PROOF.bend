# Proofs of every law in LAWS.bend; `bend PROOF.bend` is the gate. Nat facts live in lemmas.bend.
import Base
import ./LAWS.bend as Laws
import ./scoring.bend as S
import ./lemmas.bend as L

# PROOF: case analysis on the label; each case computes
def Laws.exact_is_free(g):
  match g:
    case S.AutoApprove{}:
      {==}
    case S.HumanReview{}:
      {==}
    case S.Deny{}:
      {==}

# PROOF: item_cost of a missing answer unfolds to worst
def Laws.missing_is_worst(g):
  {==}

# PROOF: both sides compute to 5n
def Laws.approve_is_worst_for_review():
  {==}

# PROOF: both sides compute to 5n
def Laws.approve_is_worst_for_deny():
  {==}

# PROOF: both sides compute to 2n
def Laws.deny_is_worst_for_approve():
  {==}

# PROOF: 1n < 5n computes to True
def Laws.review_beats_approve_on_mistakes():
  {==}

# PROOF: no answer is worst <= worst (le_refl); an answer is checked for all 9 label pairs
def Laws.item_within_worst(i):
  match i:
    case S.Item{g, q}:
      match g q:
        case _ None{}:
          L.le_refl(S.worst(g))
        case S.AutoApprove{} Some{S.AutoApprove{}}:
          {==}
        case S.AutoApprove{} Some{S.HumanReview{}}:
          {==}
        case S.AutoApprove{} Some{S.Deny{}}:
          {==}
        case S.HumanReview{} Some{S.AutoApprove{}}:
          {==}
        case S.HumanReview{} Some{S.HumanReview{}}:
          {==}
        case S.HumanReview{} Some{S.Deny{}}:
          {==}
        case S.Deny{} Some{S.AutoApprove{}}:
          {==}
        case S.Deny{} Some{S.HumanReview{}}:
          {==}
        case S.Deny{} Some{S.Deny{}}:
          {==}

# PROOF: induction on the list; add_le_add joins item_within_worst (head) and the hypothesis (tail)
def Laws.total_within_worst(items):
  match items:
    case Nil{}:
      {==}
    case Con{+h, +t}:
      L.add_le_add(S.item_cost(h), S.item_worst(h), S.actual(t), S.worst_total(t),
        Laws.item_within_worst(h), Laws.total_within_worst(t))

# PROOF: induction on the list; the head costs 0 by exact_is_free, the tail is the hypothesis
def Laws.perfect_is_free(golds):
  match golds:
    case Nil{}:
      {==}
    case Con{g, t}:
      %Equal.sym(Nat, S.cost(g, g), 0n, Laws.exact_is_free(g)) :
        {Nat.add(_, S.actual(S.perfect(t))) == 0n : Nat}
      Laws.perfect_is_free(t)

# PROOF: the fixed item costs 0 (exact_is_free), so zero_add_le gives rest <= item + rest
def Laws.fix_never_hurts(g, p, rest):
  +h = g
  L.zero_add_le(S.cost(h, h), S.item_cost(S.Item{h, p}), S.actual(rest), Laws.exact_is_free(h))
