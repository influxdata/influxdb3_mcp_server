"""BESS domain signals. Composes primitives from signals_base.

Records emitted:
  CellReading      (cell-level voltage/temperature)
  PackReading      (pack-level current/soc/soh)
  InverterReading  (site-level inverter power)

Scale: each Site has N packs × 16 modules × 12 cells by default.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import dataclass

from simulator.signals_base import jitter, random_walk, sinusoid


@dataclass
class CellReading:
    site: str
    pack_id: str
    module_id: str
    cell_id: str
    voltage: float
    temperature_c: float


@dataclass
class PackReading:
    site: str
    pack_id: str
    current_a: float
    soc: float
    soh: float


@dataclass
class InverterReading:
    site: str
    power_kw: float


@dataclass
class Cell:
    site: str
    pack_id: str
    module_id: str
    cell_id: str
    seed: int

    def __post_init__(self) -> None:
        # Voltage drifts slowly around a base per-cell. Temperature follows a
        # daily sinusoid plus load-driven jitter.
        self._volt_rw = random_walk(
            seed=self.seed, step_std=0.002, start=3.7, min_val=3.2, max_val=4.2
        )
        self._temp_jitter = jitter(seed=self.seed + 1, std=0.5)

    def tick(self, t: int) -> CellReading:
        voltage = self._volt_rw()
        # Temperature: 25°C baseline + 3°C daily sinusoid + per-tick jitter.
        temperature_c = (
            25.0
            + sinusoid(t, period_s=86400.0, amplitude=3.0, offset=0.0)
            + self._temp_jitter(float(t))
        )
        temperature_c = max(15.0, min(50.0, temperature_c))
        return CellReading(
            site=self.site,
            pack_id=self.pack_id,
            module_id=self.module_id,
            cell_id=self.cell_id,
            voltage=voltage,
            temperature_c=temperature_c,
        )


@dataclass
class Pack:
    site: str
    pack_id: str
    seed: int

    def __post_init__(self) -> None:
        # SoC drifts slowly; SoH degrades very slowly (but visibly within a long run).
        self._soc_rw = random_walk(
            seed=self.seed, step_std=0.0005, start=0.65, min_val=0.10, max_val=0.95
        )
        self._soh_rw = random_walk(
            seed=self.seed + 10, step_std=0.00001, start=0.98, min_val=0.75, max_val=1.0
        )
        # Current cycles every 1800s between charge (+positive) and discharge (negative).
        self._current_cycle_period = 1800.0

    def tick(self, t: int) -> PackReading:
        current_a = 80.0 * sinusoid(
            t, period_s=self._current_cycle_period, amplitude=1.0, offset=0.0
        )
        return PackReading(
            site=self.site,
            pack_id=self.pack_id,
            current_a=current_a,
            soc=self._soc_rw(),
            soh=self._soh_rw(),
        )


@dataclass
class Inverter:
    site: str
    seed: int

    def __post_init__(self) -> None:
        self._rw = random_walk(
            seed=self.seed + 100, step_std=0.5, start=50.0, min_val=0.0, max_val=250.0
        )

    def tick(self, t: int) -> InverterReading:
        # Diurnal pattern on top of random walk.
        solar_like = max(0.0, sinusoid(t, period_s=86400.0, amplitude=100.0, offset=50.0))
        power = 0.5 * self._rw() + 0.5 * solar_like
        return InverterReading(site=self.site, power_kw=power)


class Site:
    def __init__(
        self,
        site: str,
        n_packs: int = 4,
        n_modules_per_pack: int = 16,
        n_cells_per_module: int = 12,
        seed: int = 0,
    ) -> None:
        self.site = site
        self._packs = [Pack(site=site, pack_id=f"pack-{p}", seed=seed + p) for p in range(n_packs)]
        self._cells = [
            Cell(
                site=site,
                pack_id=f"pack-{p}",
                module_id=f"mod-{m}",
                cell_id=f"cell-{c}",
                seed=seed * 1000 + p * 100 + m * 10 + c,
            )
            for p in range(n_packs)
            for m in range(n_modules_per_pack)
            for c in range(n_cells_per_module)
        ]
        self._inverter = Inverter(site=site, seed=seed)

    def cells(self) -> Iterable[Cell]:
        return iter(self._cells)

    def packs(self) -> Iterable[Pack]:
        return iter(self._packs)

    def tick(self, t: int) -> Iterator[CellReading | PackReading | InverterReading]:
        for c in self._cells:
            yield c.tick(t)
        for p in self._packs:
            yield p.tick(t)
        yield self._inverter.tick(t)
