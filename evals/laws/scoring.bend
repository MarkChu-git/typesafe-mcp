# Reference model of the weighted-cost scorer used by the gating tasks
# (evals/verifiers.ts `weightedCost` with the refund-gating cost table).
import Base

type Decision is Data:
  AutoApprove{}
  HumanReview{}
  Deny{}

# Cost of predicting `pred` when the right answer is `gold`.
def cost(gold: Decision, pred: Decision) -> Nat:
  match gold pred:
    case AutoApprove{} AutoApprove{}:
      0n
    case AutoApprove{} HumanReview{}:
      1n
    case AutoApprove{} Deny{}:
      2n
    case HumanReview{} AutoApprove{}:
      5n
    case HumanReview{} HumanReview{}:
      0n
    case HumanReview{} Deny{}:
      2n
    case Deny{} AutoApprove{}:
      5n
    case Deny{} HumanReview{}:
      1n
    case Deny{} Deny{}:
      0n

# The largest cost any prediction can have for this gold label.
def worst(gold: Decision) -> Nat:
  match gold:
    case AutoApprove{}:
      2n
    case HumanReview{}:
      5n
    case Deny{}:
      5n

# One graded item: the gold label and the agent's answer (None when it gave none).
type Item is Data:
  Item{gold: Decision, pred: Maybe<&2, Decision>}

def item_cost(i: Item) -> Nat:
  match i:
    case Item{gold, pred}:
      match pred:
        case None{}:
          worst(gold)
        case Some{p}:
          cost(gold, p)

def item_worst(i: Item) -> Nat:
  match i:
    case Item{gold, pred}:
      worst(gold)

def actual(items: List<&2, Item>) -> Nat:
  match items:
    case Nil{}:
      0n
    case Con{h, t}:
      Nat.add(item_cost(h), actual(t))

def worst_total(items: List<&2, Item>) -> Nat:
  match items:
    case Nil{}:
      0n
    case Con{h, t}:
      Nat.add(item_worst(h), worst_total(t))

# Every item answered with its own gold label.
def perfect(golds: List<&2, Decision>) -> List<&2, Item>:
  match golds:
    case Nil{}:
      Nil{}
    case Con{+g, t}:
      Item{g, Some{g}} <> perfect(t)
