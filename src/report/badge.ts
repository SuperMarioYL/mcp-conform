/**
 * Badge emitter — a static, self-contained conformance badge as SVG + JSON.
 *
 * No hosted badge service (out of scope, mvp_plan §6): the SVG is rendered
 * locally so a server author can commit `badge.svg` straight into their README.
 * The JSON form is a shields.io "endpoint" payload, so authors who prefer a live
 * badge can point shields at it.
 */
import type { ConformanceReport } from "../adapters/types.js";

export type BadgeStatus = "passing" | "failing" | "partial";

export interface BadgeData {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
  /** Derived overall verdict. */
  status: BadgeStatus;
}

/** Reduce a report to an overall badge verdict. */
export function badgeStatus(report: ConformanceReport): BadgeStatus {
  const hasFail = report.results.some((r) => r.status === "fail");
  if (hasFail) return "failing";
  const hasPass = report.results.some((r) => r.status === "pass");
  const hasSkipOrNa = report.results.some(
    (r) => r.status === "skip" || r.status === "n/a"
  );
  if (hasPass && hasSkipOrNa) return "partial";
  return hasPass ? "passing" : "partial";
}

const COLOR: Record<BadgeStatus, string> = {
  passing: "#3fb950", // green
  failing: "#e5534b", // red
  partial: "#d29922", // amber
};

/** Build the shields.io endpoint JSON payload. */
export function buildBadgeJson(report: ConformanceReport): BadgeData {
  const status = badgeStatus(report);
  return {
    schemaVersion: 1,
    label: "mcp-conform",
    message: status,
    color: COLOR[status],
    status,
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Approximate text width for a 11px DejaVu/Verdana-ish font, in px. */
function textWidth(s: string): number {
  // 6.5px per char is a good-enough average for the badge label sizes we emit.
  return Math.ceil(s.length * 6.5) + 10;
}

/**
 * Render a self-contained flat badge SVG (shields.io "flat" look, no external
 * fonts or images so it renders identically everywhere).
 */
export function buildBadgeSvg(report: ConformanceReport): string {
  const data = buildBadgeJson(report);
  const label = escapeXml(data.label);
  const message = escapeXml(data.message);

  const lw = textWidth(label);
  const rw = textWidth(message);
  const w = lw + rw;
  const h = 20;

  const labelX = (lw / 2) * 10;
  const labelLen = (lw - 10) * 10;
  const msgX = (lw + rw / 2) * 10;
  const msgLen = (rw - 10) * 10;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" role="img" aria-label="${label}: ${message}">
  <title>${label}: ${message}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${w}" height="${h}" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="${h}" fill="#555"/>
    <rect x="${lw}" width="${rw}" height="${h}" fill="${data.color}"/>
    <rect width="${w}" height="${h}" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="110" text-rendering="geometricPrecision">
    <text aria-hidden="true" x="${labelX}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${labelLen}">${label}</text>
    <text x="${labelX}" y="140" transform="scale(.1)" fill="#fff" textLength="${labelLen}">${label}</text>
    <text aria-hidden="true" x="${msgX}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${msgLen}">${message}</text>
    <text x="${msgX}" y="140" transform="scale(.1)" fill="#fff" textLength="${msgLen}">${message}</text>
  </g>
</svg>
`;
}
