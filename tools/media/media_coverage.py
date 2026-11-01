"""How well a set of clips (test cases) covers a target set (the footage to cover), and which
candidates to add.

Two measures, each weighted by the target clips' priority:
- Pairs: which pairs of trait levels the target has, some pick also has. Levels come from the
  target: a trait that is often zero is none / some / lots (split at the median of the nonzero
  values), the others low / mid / high (thirds). Most failures come from one trait or two
  interacting, which is why pairs are the standard measure in combinatorial testing.
- Distance: how far a target clip is from its nearest pick, with each trait as a percentile of the
  target (facility location).

A pick adds the candidate with the most of both, the pair gain counting twice, times the
candidate's own priority. On held-out UGC clips this kept 99% of a pairs-only pick's pair coverage
and came within 5% of a distance-only pick's mean distance; picking farthest first (k-center) did
worse than random, as it chases outliers.
"""

import itertools
import math
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

# A trait zero in this share of the target clips or more gets none / some / lots
OFTEN_ZERO = 0.3
ZERO = 1e-3
PAIR_WEIGHT = 2.0


@dataclass(frozen=True)
class Clip:
    ref: str
    # Clips from one source video: a pick takes at most one
    group: str
    traits: dict[str, float]
    priority: float = 1.0


Levels = dict[str, str]
Pair = tuple[tuple[str, str], tuple[str, str]]


def levelers(
    target: list[dict[str, float]],
    traits: list[str],
) -> dict[str, Callable[[float], str | None]]:
    out = {}
    for trait in traits:
        values = np.array([row.get(trait, math.nan) for row in target], dtype=float)
        values = values[~np.isnan(values)]
        if len(values) == 0:
            continue
        if np.mean(values <= ZERO) >= OFTEN_ZERO and np.any(values > ZERO):
            out[trait] = leveled(
                [("none", ZERO), ("some", float(np.median(values[values > ZERO])))],
                "lots",
            )
        else:
            low, high = np.percentile(values, [100 / 3, 200 / 3])
            out[trait] = leveled([("low", float(low)), ("mid", float(high))], "high")
    return out


def leveled(bounds: list[tuple[str, float]], above: str) -> Callable[[float], str | None]:
    """A value's level: the first (name, upper bound) it is at most, else `above`."""

    def level(value: float) -> str | None:
        if math.isnan(value):
            return None
        return next((name for name, upper in bounds if value <= upper), above)

    return level


def levels_of(traits: dict[str, float], level: dict[str, Callable[[float], str | None]]) -> Levels:
    out = {}
    for trait, leveler in level.items():
        value = traits.get(trait)
        named = leveler(math.nan if value is None else float(value))
        if named is not None:
            out[trait] = named
    return out


def pairs(levels: Levels) -> set[Pair]:
    return set(itertools.combinations(sorted(levels.items()), 2))


def share(weights: Counter, covered: set) -> float:
    total = sum(weights.values())
    return sum(w for p, w in weights.items() if p in covered) / total if total else 1.0


def percentiles(target: np.ndarray, values: np.ndarray) -> np.ndarray:
    """Each value as the share of the target's values at or below it, per trait (columns). An
    unknown value sits in the middle."""
    out = np.full(values.shape, 0.5)
    for j in range(values.shape[1]):
        column = np.sort(target[~np.isnan(target[:, j]), j])
        known = ~np.isnan(values[:, j])
        if len(column):
            out[known, j] = np.searchsorted(column, values[known, j], side="right") / len(column)
    return out


@dataclass(frozen=True)
class Coverage:
    """A target's pairs and percentile space, to score sets of clips against."""

    traits: list[str]
    level: dict[str, Callable[[float], str | None]]
    weights: Counter
    points: np.ndarray
    priorities: np.ndarray
    values: np.ndarray

    @classmethod
    def of(cls, target: list[Clip], traits: list[str]) -> "Coverage":
        level = levelers([clip.traits for clip in target], traits)
        weights: Counter = Counter()
        for clip in target:
            for pair in pairs(levels_of(clip.traits, level)):
                weights[pair] += clip.priority
        values = matrix(target, traits)
        priorities = np.array([clip.priority for clip in target], float)
        return cls(traits, level, weights, percentiles(values, values), priorities, values)

    def place(self, clips: list[Clip]) -> np.ndarray:
        return percentiles(self.values, matrix(clips, self.traits))

    def distances(self, clips: list[Clip]) -> np.ndarray:
        """Each target clip's distance to each clip."""
        return np.sqrt(((self.points[:, None, :] - self.place(clips)[None, :, :]) ** 2).sum(-1))

    def score(self, clips: list[Clip]) -> tuple[float, float]:
        """The pair share the clips cover, and the target's mean distance to its nearest clip."""
        covered = set().union(*(pairs(levels_of(c.traits, self.level)) for c in clips))
        if not clips:
            return share(self.weights, covered), math.nan
        nearest = self.distances(clips).min(1)
        return share(self.weights, covered), float(
            (nearest * self.priorities).sum() / self.priorities.sum(),
        )


def matrix(clips: list[Clip], traits: list[str]) -> np.ndarray:
    return np.array(
        [[clip.traits.get(t, math.nan) for t in traits] for clip in clips],
        float,
    ).reshape(len(clips), len(traits))


def pick(
    coverage: Coverage,
    candidates: list[Clip],
    have: list[Clip],
    count: int,
) -> list[tuple[str, float, float]]:
    """Greedily `count` candidates, at most one per group. Returns each pick with the pair share and
    mean distance after it."""
    candidate_levels = [pairs(levels_of(c.traits, coverage.level)) for c in candidates]
    covered = set().union(*(pairs(levels_of(c.traits, coverage.level)) for c in have))
    distance = coverage.distances(candidates)
    nearest = (
        coverage.distances(have).min(1)
        if have
        else np.full(len(coverage.points), np.sqrt(len(coverage.traits)))
    )
    w = coverage.priorities
    picked, groups, out = [], {c.group for c in have}, []
    for _ in range(count):
        pair_gain = np.array(
            [sum(coverage.weights[p] for p in levels - covered) for levels in candidate_levels],
            float,
        )
        distance_gain = (
            w[:, None] * (nearest[:, None] - np.minimum(nearest[:, None], distance))
        ).sum(0)
        score = PAIR_WEIGHT * pair_gain / (pair_gain.max() or 1) + distance_gain / (
            distance_gain.max() or 1
        )
        score *= np.array([c.priority for c in candidates], float)
        score[[i for i, c in enumerate(candidates) if c.group in groups]] = -np.inf
        i = int(np.argmax(score))
        if score[i] <= 0:
            break
        picked.append(candidates[i])
        groups.add(candidates[i].group)
        covered |= candidate_levels[i]
        nearest = np.minimum(nearest, distance[:, i])
        out.append((candidates[i].ref, *coverage.score([*have, *picked])))
    return out
