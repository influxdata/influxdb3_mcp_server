"""Primitive signal generators composed by domain-specific signal modules.

This file is intentionally self-contained and copy-pasted across all
reference-architecture repos (see portfolio spec §5.2). Keep it small and
dependency-free.
"""

from __future__ import annotations

import math
import random
from collections.abc import Callable


def sinusoid(
    t_seconds: float, period_s: float, amplitude: float, offset: float, phase_rad: float = 0.0
) -> float:
    """Instantaneous value of a sine wave at time `t_seconds`.

    Returns: offset + amplitude * sin(2π t/period + phase).
    """
    return offset + amplitude * math.sin(2.0 * math.pi * t_seconds / period_s + phase_rad)


def random_walk(
    seed: int,
    step_std: float,
    start: float = 0.0,
    min_val: float = float("-inf"),
    max_val: float = float("inf"),
) -> Callable[[], float]:
    """Return a stateful callable producing the next random-walk value.

    Each call advances one step. Deterministic given `seed`.
    """
    rng = random.Random(seed)
    state = [start]

    def step_fn() -> float:
        state[0] = max(min_val, min(max_val, state[0] + rng.gauss(0.0, step_std)))
        return state[0]

    return step_fn


def step(at_t: float, before: float, after: float) -> Callable[[float], float]:
    """Return a step function: `before` if t<at_t else `after`."""

    def inner(t: float) -> float:
        return after if t >= at_t else before

    return inner


def burst(at_t: float, duration_s: float, magnitude: float) -> Callable[[float], float]:
    """Return a rectangular pulse of height `magnitude` over [at_t, at_t+duration_s]."""

    def inner(t: float) -> float:
        return magnitude if at_t <= t < (at_t + duration_s) else 0.0

    return inner


def jitter(seed: int, std: float) -> Callable[[float], float]:
    """Return a deterministic noise function. Same `t` → same value for given seed."""
    rng = random.Random(seed)
    cache: dict[float, float] = {}

    def inner(t: float) -> float:
        if t not in cache:
            cache[t] = rng.gauss(0.0, std)
        return cache[t]

    return inner
