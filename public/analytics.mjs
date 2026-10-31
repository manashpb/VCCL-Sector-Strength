export function compare(indices, benchmark, requested) {
  const bench = indices[benchmark];
  if (!bench) return null;
  const base = bench.points.find((p) => p.date >= requested);
  if (!base) return null;
  const end = bench.points.at(-1);
  const calc = (p, b) => (p.close / b.close - 1) * 100;
  const benchmarkReturn = calc(end, base);
  const rows = Object.entries(indices)
    .filter(([, v]) => v.sector)
    .map(([id, index]) => {
      const first = index.points.find((p) => p.date === base.date),
        last = index.points.find((p) => p.date === end.date);
      if (!first || !last)
        return {
          id,
          name: index.name,
          available: false,
          reason: !first
            ? "No reference-date data"
            : "No data on benchmark latest date",
        };
      return {
        id,
        name: index.name,
        available: true,
        value: calc(last, first),
        excess: calc(last, first) - benchmarkReturn,
        points: index.points
          .filter((p) => p.date >= base.date && p.date <= end.date)
          .map((p) => ({ date: p.date, value: calc(p, first) })),
      };
    })
    .sort(
      (a, b) =>
        Number(b.available) - Number(a.available) ||
        (b.value ?? 0) - (a.value ?? 0),
    );
  return {
    baseDate: base.date,
    endDate: end.date,
    benchmarkReturn,
    rows,
    benchmarkPoints: bench.points
      .filter((p) => p.date >= base.date)
      .map((p) => ({ date: p.date, value: calc(p, base) })),
  };
}
