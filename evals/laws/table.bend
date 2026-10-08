# Prints the model's item costs so tests/evals/laws.test.ts can compare them with the TS scorer.
# One line per gold label: costs for no answer, auto_approve, human_review, deny; then the worst case.
import Base
import ./scoring.bend as S

def cell(i: S.Item) -> String:
  Nat.show(S.item_cost(i))

def row(+g: S.Decision) -> String:
  cell(S.Item{g, None{}}) ++ " " ++ cell(S.Item{g, Some{S.AutoApprove{}}}) ++ " " ++ cell(S.Item{g, Some{S.HumanReview{}}}) ++ " " ++ cell(S.Item{g, Some{S.Deny{}}}) ++ " / " ++ Nat.show(S.worst(g))

def main() -> String:
  row(S.AutoApprove{}) ++ "; " ++ row(S.HumanReview{}) ++ "; " ++ row(S.Deny{})
