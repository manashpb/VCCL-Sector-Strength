import { compare } from "./analytics.mjs";
const $ = (id) => document.getElementById(id),
  fmt = (n) => (n > 0 ? "+" : "") + n.toFixed(2),
  tone = (n) => (n > 1e-9 ? "positive" : n < -1e-9 ? "negative" : "neutral");
let data,
  model,
  polling = false,
  visibility = {};
const config = { responsive: true, scrollZoom: true, displaylogo: false };
const layout = {
  paper_bgcolor: "#111c2e",
  plot_bgcolor: "#111c2e",
  font: { color: "#94a3b8", family: "Segoe UI, sans-serif" },
  margin: { l: 65, r: 25, t: 20, b: 50 },
  xaxis: { gridcolor: "#23324a" },
  yaxis: { gridcolor: "#23324a", zerolinecolor: "#64748b" },
  hovermode: "x unified",
};
async function api(path, options) {
  const response = await fetch("/sectors/api/" + path, options);
  if (!response.ok) {
    let message = "Request failed (" + response.status + ")";
    try {
      message = (await response.json()).error || message;
    } catch {}
    throw Error(message);
  }
  return response.json();
}
function showError(message) {
  $("error").hidden = !message;
  $("error").textContent = message || "";
}
function status(s) {
  $("update").disabled = s.running;
  $("update").textContent = s.running ? "Updating…" : "Update data";
  $("status").textContent = s.running
    ? `Fetching NSE archives: ${s.completed} / ${s.total} dates checked · ${s.downloaded} downloaded${s.currentDate ? " · " + s.currentDate : ""}. First load may take several minutes; you can keep using the page.`
    : s.error
      ? "Update stopped. Cached data remains available."
      : s.total
        ? `Update complete · ${s.downloaded} new trading-day reports downloaded.`
        : "";
  if (s.error) showError(s.error);
}
async function load() {
  data = await api("data");
  status(data.status);
  const previous = $("benchmark").value;
  const names = Object.entries(data.indices).sort((a, b) =>
    a[1].name.localeCompare(b[1].name),
  );
  $("benchmark").replaceChildren(
    ...names.map(([id, v]) => new Option(v.name, id)),
  );
  $("benchmark").disabled = !names.length;
  if (!names.length) {
    $("freshness").textContent = "No cached data yet";
    if (data.status.running) poll();
    return;
  }
  $("benchmark").value = data.indices[previous]
    ? previous
    : data.indices["NIFTY 50"]
      ? "NIFTY 50"
      : names[0][0];
  $("coverage").textContent =
    `${data.reportCount} trading-day reports cached · History available from ${data.firstDataDate}.` +
    (data.uncheckedDates
      ? ` ${data.uncheckedDates} calendar dates still need checking; use Update data to complete the year.`
      : "");
  $("freshness").textContent =
    `Last data: ${data.lastDataDate} · ${Object.keys(data.indices).length} indices` +
    (data.lastChecked
      ? ` · Last checked: ${new Date(data.lastChecked).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`
      : "");
  $("reference").disabled = false;
  const points = data.indices[$("benchmark").value].points;
  $("reference").min = points[0].date;
  $("reference").max = points.at(-1).date;
  if (!$("reference").value || $("reference").value < points[0].date)
    $("reference").value = points[0].date;
  if ($("reference").value > points.at(-1).date)
    $("reference").value = points.at(-1).date;
  await render();
  if (data.status.running) poll();
}
async function render() {
  const id = $("benchmark").value,
    bench = data.indices[id];
  if (!bench) return;
  const reference = $("reference");
  reference.min = bench.points[0].date;
  reference.max = bench.points.at(-1).date;
  if (reference.value < reference.min) reference.value = reference.min;
  if (reference.value > reference.max) reference.value = reference.max;
  model = compare(data.indices, id, reference.value);
  if (!model) return;
  const b = bench.points;
  const missingOHLC = b.filter((p) => p.open === null).length;
  document.querySelector("#candles .empty")?.remove();
  $("ohlc-note").textContent = missingOHLC
    ? `NSE does not provide valid OHLC for ${missingOHLC} sessions of this index. Those closes are shown as dots; no candles are inferred.`
    : "";
  await Plotly.react(
    "candles",
    [
      {
        type: "candlestick",
        name: bench.name,
        x: b.map((p) => p.date),
        open: b.map((p) => p.open),
        high: b.map((p) => p.high),
        low: b.map((p) => p.low),
        close: b.map((p) => p.close),
        increasing: { line: { color: "#34d399" } },
        decreasing: { line: { color: "#fb7185" } },
      },
      ...(missingOHLC
        ? [
            {
              type: "scatter",
              mode: "markers",
              name: "Close (OHLC unavailable)",
              x: b.filter((p) => p.open === null).map((p) => p.date),
              y: b.filter((p) => p.open === null).map((p) => p.close),
              marker: { color: "#7dd3fc", size: 4 },
            },
          ]
        : []),
    ],
    {
      ...layout,
      uirevision: id,
      xaxis: { ...layout.xaxis, type: "date", rangeslider: { visible: false } },
      yaxis: {
        ...layout.yaxis,
        title: { text: "Index level" },
        fixedrange: false,
      },
      shapes: [
        {
          type: "line",
          xref: "x",
          x0: model.baseDate,
          x1: model.baseDate,
          yref: "paper",
          y0: 0,
          y1: 1,
          line: { color: "#fbbf24", width: 2, dash: "dot" },
        },
      ],
      annotations: [
        {
          x: model.baseDate,
          y: 1,
          xref: "x",
          yref: "paper",
          text: "Reference · " + model.baseDate,
          showarrow: false,
          yanchor: "bottom",
          font: { color: "#fbbf24" },
        },
      ],
    },
    config,
  );
  $("benchmark-name").textContent = bench.name + " return";
  $("return").textContent = fmt(model.benchmarkReturn) + "%";
  $("return").className = tone(model.benchmarkReturn);
  $("period").textContent = model.baseDate + " → " + model.endDate;
  $("reference-note").textContent =
    (model.baseDate !== reference.value
      ? `No benchmark session on ${reference.value}; using ${model.baseDate}. `
      : "") +
    "Returns use reference-session close. All sectors are compared on " +
    model.endDate +
    ".";
  $("breadth").textContent =
    `${model.rows.filter((r) => r.available && r.excess > 1e-9).length} outperforming · ${model.rows.filter((r) => r.available && r.excess < -1e-9).length} underperforming · ${model.rows.filter((r) => !r.available).length} unavailable`;
  $("summary").replaceChildren(
    ...model.rows.map((r) => {
      const tr = document.createElement("tr");
      for (const text of [
        r.name,
        r.available ? fmt(r.value) + "%" : "N/A",
        r.available ? fmt(r.excess) : r.reason,
      ]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.append(td);
      }
      tr.className = r.available ? tone(r.excess) : "neutral";
      return tr;
    }),
  );
  const colors = [
    "#38bdf8",
    "#a78bfa",
    "#fbbf24",
    "#2dd4bf",
    "#fb7185",
    "#fb923c",
    "#a3e635",
    "#e879f9",
    "#818cf8",
    "#22d3ee",
  ];
  const traces = model.rows
    .filter((r) => r.available)
    .map((r, i) => {
      const points = new Map(r.points.map((p) => [p.date, p.value]));
      return {
        type: "scatter",
        mode: "lines",
        uid: r.id,
        name: r.name + "  " + fmt(r.value) + "%",
        x: model.benchmarkPoints.map((p) => p.date),
        y: model.benchmarkPoints.map((p) => points.get(p.date) ?? null),
        connectgaps: false,
        line: {
          color: colors[i % colors.length],
          width: 1.8,
          dash: ["solid", "dash", "dot"][Math.floor(i / colors.length) % 3],
        },
        visible: visibility[r.id] ?? true,
        meta: r.id,
        hovertemplate: r.name + "<br>%{x}<br>%{y:.2f}%<extra></extra>",
      };
    });
  traces.push({
    type: "scatter",
    mode: "lines",
    uid: "benchmark",
    name: bench.name + " (benchmark)  " + fmt(model.benchmarkReturn) + "%",
    x: model.benchmarkPoints.map((p) => p.date),
    y: model.benchmarkPoints.map((p) => p.value),
    line: { color: "#f8fafc", width: 3, dash: "dash" },
    meta: "benchmark",
    visible: visibility.benchmark ?? true,
  });
  traces.sort((a, b) => b.y.at(-1) - a.y.at(-1));
  await Plotly.react(
    "comparison",
    traces,
    {
      ...layout,
      uirevision: id + model.baseDate,
      xaxis: { ...layout.xaxis, title: { text: "Date" }, type: "date" },
      yaxis: {
        ...layout.yaxis,
        title: { text: "Cumulative return (%)" },
        ticksuffix: "%",
      },
      legend: {
        orientation: "h",
        y: -0.2,
        x: 0,
        traceorder: "normal",
        font: { size: 11 },
      },
      margin: { l: 65, r: 25, t: 20, b: 300 },
    },
    config,
  );
  const plot = $("comparison");
  plot.removeAllListeners("plotly_restyle");
  plot.on("plotly_restyle", () => {
    for (const t of plot.data) visibility[t.meta] = t.visible ?? true;
  });
}
async function poll() {
  if (polling) return;
  polling = true;
  try {
    let tick = 0;
    while (true) {
      await new Promise((r) => setTimeout(r, 2500));
      const s = await api("status");
      status(s);
      if (!s.running) {
        await load();
        break;
      }
      if (++tick % 4 === 0) await load();
    }
  } catch (e) {
    showError(e.message);
  } finally {
    polling = false;
  }
}
$("benchmark").addEventListener("change", () => {
  visibility = {};
  render().catch((e) => showError(e.message));
});
$("reference").addEventListener("change", () => {
  if ($("reference").validity.valid && $("reference").value)
    render().catch((e) => showError(e.message));
});
$("update").addEventListener("click", async () => {
  showError("");
  $("update").disabled = true;
  try {
    const result = await api("update", {
      method: "POST",
      headers: { "X-VCCL-Request": "sector-update" },
    });
    status(result.status);
    poll();
  } catch (e) {
    showError(e.message);
    $("update").disabled = false;
  }
});
$("show-all").addEventListener("click", () => {
  visibility = {};
  if (model)
    Plotly.restyle("comparison", { visible: true }).catch((e) =>
      showError(e.message),
    );
});
load().catch((e) => showError(e.message));
