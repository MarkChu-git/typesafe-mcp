# Facts about `Nat.is_le` and `Nat.add` that PROOF.bend needs and Base does not state.
import Base

# `Le(a, b)` is the claim "a <= b": the comparison answers True.
def Le(a: Nat, b: Nat) -> Type:
  {Nat.is_le(a, b) == True{} : Bool}

# A motive that is Empty at True and Unit at False, used to refute `False == True`.
def disc(b: Bool) -> Type:
  match b:
    case False{}:
      Unit
    case True{}:
      Empty

# LEMMA: "False is not True"
law false_ne_true:
  for h: {False{} == True{} : Bool}
  Empty

# PROOF: rewrite through disc and answer Unit{}
def false_ne_true(h):
  %h : disc(_)
  Unit{}

# LEMMA: "every number is at most itself"
law le_refl:
  for +x: Nat
  Le(x, x)

# PROOF: induction on x
def le_refl(x):
  match x:
    case 0n:
      {==}
    case 1n+p:
      le_refl(p)

# LEMMA: "a <= b implies a <= b + 1"
law le_succ:
  for +a: Nat
  for +b: Nat
  for h: Le(a, b)
  Le(a, 1n+b)

# PROOF: induction on a and b; a successor is never at most 0
def le_succ(a, b, h):
  match a b:
    case 0n 0n:
      {==}
    case 0n 1n+bp:
      {==}
    case 1n+ap 0n:
      Empty.absurd(Le(1n+ap, 1n), false_ne_true(h))
    case 1n+ap 1n+bp:
      le_succ(ap, bp, h)

# LEMMA: "a <= b implies a <= c + b"
law le_add_left:
  for +a: Nat
  for +b: Nat
  for +c: Nat
  for h: Le(a, b)
  Le(a, Nat.add(c, b))

# PROOF: induction on c, one le_succ per step
def le_add_left(a, b, c, h):
  match c:
    case 0n:
      h
    case 1n+p:
      le_succ(a, Nat.add(p, b), le_add_left(a, b, p, h))

# LEMMA: "a <= b and c <= d imply a + c <= b + d"
law add_le_add:
  for +a: Nat
  for +b: Nat
  for +c: Nat
  for +d: Nat
  for hab: Le(a, b)
  for hcd: Le(c, d)
  Le(Nat.add(a, c), Nat.add(b, d))

# PROOF: induction on a and b; a = 0 is le_add_left, a successor is never at most 0, else recurse
def add_le_add(a, b, c, d, hab, hcd):
  match a b:
    case 0n _:
      le_add_left(c, d, b, hcd)
    case 1n+ap 0n:
      Empty.absurd(Le(Nat.add(1n+ap, c), d), false_ne_true(hab))
    case 1n+ap 1n+bp:
      add_le_add(ap, bp, c, d, hab, hcd)

# LEMMA: "if a is 0 then a + y <= x + y"
law zero_add_le:
  for -a: Nat
  for +x: Nat
  for +y: Nat
  for e: {a == 0n : Nat}
  Le(Nat.add(a, y), Nat.add(x, y))

# PROOF: rewrite a to 0, then y <= x + y by le_add_left
def zero_add_le(a, x, y, e):
  %Equal.sym(Nat, a, 0n, e) : Le(Nat.add(_, y), Nat.add(x, y))
  le_add_left(y, y, x, le_refl(y))
