/**
 * Matrix renderer — turns a {@link ConformanceReport} into the per-client ×
 * {auth, behavior} parity matrix, both as a colored terminal table (picocolors)
 * and as a stable JSON object for `--json` / CI.
 */
import pc from "picocolors";
import { ADAPTERS } from "../runner.js";
import type {
  Axis,
  CheckStatus,
  ClientId,
  ConformanceReport,
} from "../adapters/types.js";

const AXES: Axis[] = ["behavior", "auth"];

/**
 * Worst-case roll-up of a set of statuses into a single cell verdict.
 *
 * Precedence is `fail > pass > skip > n/a`: a hard failure dominates everything;
 * otherwise a real `pass` wins; otherwise a `skip` (optional-yellow) dominates
 * an `n/a` (stubbed) so a mixed `["skip","n/a"]` cell reads `skip` — the
 * actionable signal is not hidden behind a stubbed cell. Empty -> `n/a`.
 */
export function rollup(statuses: CheckStatus[]): CheckStatus {
  if (statuses.length === 0) return "n/a";
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("pass")) return "pass";
  if (statuses.includes("skip")) return "skip";
  return "n/a";
}

export interface MatrixCell {
  client: ClientId;
  axis: Axis;
  status: CheckStatus;
  /** check_id of the first failing row, when status is `fail`. */
  failedCheck?: string;
}

/** Computed matrix view derived from a report. */
export interface MatrixView {
  spec_version: string;
  server: ConformanceReport["server"];
  cells: MatrixCell[];
}

/** Build the {client × axis} matrix view from raw result rows. */
export function buildMatrix(report: ConformanceReport): MatrixView {
  const cells: MatrixCell[] = [];
  for (const adapter of ADAPTERS) {
    for (const axis of AXES) {
      const rows = report.results.filter(
        (r) => r.client === adapter.id && r.axis === axis
      );
      const status = rollup(rows.map((r) => r.status));
      const failed = rows.find((r) => r.status === "fail");
      cells.push({
        client: adapter.id,
        axis,
        status,
        failedCheck: failed?.check_id,
      });
    }
  }
  return {
    spec_version: report.spec_version,
    server: report.server,
    cells,
  };
}

const SYMBOL: Record<CheckStatus, string> = {
  pass: "✓ pass",
  fail: "✗ fail",
  skip: "~ skip",
  "n/a": "- n/a ",
};

function colorize(status: CheckStatus, text: string): string {
  switch (status) {
    case "pass":
      return pc.green(text);
    case "fail":
      return pc.red(text);
    case "skip":
      return pc.yellow(text);
    case "n/a":
      return pc.dim(text);
  }
}

function pad(s: string, width: number): string {
  // pad on visible length (the strings we pad here have no color codes yet)
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

/**
 * Render the colored terminal matrix. Rows = clients, columns = axes.
 * Returns the full multi-line string (also printed by the CLI).
 */
export function renderMatrix(report: ConformanceReport): string {
  const view = buildMatrix(report);
  const adapterById = new Map(ADAPTERS.map((a) => [a.id, a]));

  const clientColWidth = Math.max(
    "Client".length,
    ...ADAPTERS.map((a) => a.label.length)
  );
  const cellWidth = 8; // fits "✓ pass" etc. plus a space

  const lines: string[] = [];
  lines.push(pc.bold(`mcp-conform — conformance matrix (spec ${view.spec_version})`));
  lines.push(pc.dim(`server: ${view.server.cmd}  [${view.server.transport}]`));
  lines.push("");

  // header
  const header =
    pad("Client", clientColWidth) +
    "  " +
    AXES.map((a) => pad(a, cellWidth)).join("  ");
  lines.push(pc.bold(header));
  lines.push(pc.dim("-".repeat(header.length)));

  // rows
  for (const adapter of ADAPTERS) {
    const label = adapter.implemented ? adapter.label : `${adapter.label}*`;
    const cells = AXES.map((axis) => {
      const cell = view.cells.find(
        (c) => c.client === adapter.id && c.axis === axis
      )!;
      return colorize(cell.status, pad(SYMBOL[cell.status], cellWidth));
    });
    lines.push(pad(label, clientColWidth) + "  " + cells.join("  "));
  }

  lines.push("");

  // failing-assertion call-outs
  const failures = report.results.filter((r) => r.status === "fail");
  if (failures.length > 0) {
    lines.push(pc.red(pc.bold("Failures:")));
    for (const f of failures) {
      const a = adapterById.get(f.client);
      lines.push(
        pc.red(`  ✗ ${a?.label ?? f.client} / ${f.axis} / ${f.check_id}: ${f.detail}`)
      );
    }
  } else {
    lines.push(pc.green("All applicable checks passed (n/a = adapter stubbed, skip = optional)."));
  }

  lines.push("");
  lines.push(pc.dim("* = adapter stubbed (returns n/a) — real adapter lands in a later release."));

  return lines.join("\n");
}

/** Stable JSON shape emitted by `--json` (the matrix view, not the raw rows). */
export function matrixJson(report: ConformanceReport): MatrixView {
  return buildMatrix(report);
}
