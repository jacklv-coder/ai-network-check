import "./evidence.css";

import { serializeEvidenceReport } from "@ai-network-check/evidence-report";
import { readReportHistory } from "@ai-network-check/web-reporting";

import { evidenceSession } from "./evidence-session.ts";
import {
  evidenceFilename,
  renderEvidencePanel
} from "./evidence-view.ts";

const appRootElement = document.querySelector("#app");

if (!(appRootElement instanceof HTMLElement)) {
  throw new Error("Missing #app root element");
}

const appRoot: HTMLElement = appRootElement;
let mountScheduled = false;
let suppressedWebReportCompletedAt: string | null = null;

function createMount(): HTMLElement | null {
  const anchor =
    document.querySelector<HTMLElement>("#agent-mount") ??
    document.querySelector<HTMLElement>("#realtime-mount") ??
    appRoot.querySelector<HTMLElement>(".app-card");
  if (!anchor) return null;

  const mount = document.createElement("div");
  mount.id = "evidence-mount";
  anchor.insertAdjacentElement("afterend", mount);
  return mount;
}

function latestWebReport() {
  try {
    return readReportHistory(localStorage)[0] ?? null;
  } catch {
    return null;
  }
}

function syncLatestWebReport(): boolean {
  const latest = latestWebReport();
  if (!latest) return false;

  if (latest.completedAt === suppressedWebReportCompletedAt) {
    return false;
  }

  const current = evidenceSession.snapshot().report.webReport;
  if (latest.completedAt !== current?.completedAt) {
    suppressedWebReportCompletedAt = null;
    evidenceSession.attachWebReport(latest);
    return true;
  }
  return false;
}

function downloadEvidence(): void {
  const report = evidenceSession.snapshot().report;
  const url = URL.createObjectURL(
    new Blob([serializeEvidenceReport(report)], {
      type: "application/json;charset=utf-8"
    })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = evidenceFilename(report);
  anchor.click();
  URL.revokeObjectURL(url);
}

function resetEvidence(): void {
  suppressedWebReportCompletedAt =
    evidenceSession.snapshot().report.webReport?.completedAt ??
    latestWebReport()?.completedAt ??
    null;
  evidenceSession.reset();
}

function bindEvents(mount: HTMLElement): void {
  mount
    .querySelector<HTMLButtonElement>("#download-evidence-button")
    ?.addEventListener("click", downloadEvidence);
  mount
    .querySelector<HTMLButtonElement>("#reset-evidence-button")
    ?.addEventListener("click", resetEvidence);
}

function render(): void {
  const httpsIsRunning = Boolean(appRoot.querySelector(".running-panel"));
  const existingMount = document.querySelector<HTMLElement>("#evidence-mount");
  if (httpsIsRunning) {
    existingMount?.remove();
    return;
  }

  if (syncLatestWebReport()) return;

  const mount = existingMount ?? createMount();
  if (!mount) return;

  mount.innerHTML = renderEvidencePanel(evidenceSession.snapshot());
  bindEvents(mount);
}

function scheduleMount(): void {
  if (mountScheduled) return;
  mountScheduled = true;
  queueMicrotask(() => {
    mountScheduled = false;
    render();
  });
}

evidenceSession.subscribe(render);
new MutationObserver(scheduleMount).observe(appRoot, {
  childList: true,
  subtree: true
});

render();
