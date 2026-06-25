export const RENDER_MODE_REQUEST_TYPES = Object.freeze({
  RUN_INSPECTION: "renderMode.runInspection",
  END_INSPECTION: "renderMode.endInspection",
  CONTENT_BEGIN: "renderMode.contentBegin",
  CONTENT_HIDE_CONSENT: "renderMode.contentHideConsent",
  CONTENT_CAPTURE_HTML: "renderMode.contentCaptureHtml",
  CONTENT_END: "renderMode.contentEnd",
} as const);

export const RENDER_MODE_EVENT_TYPES = Object.freeze({
  INSPECTION_RECORDED: "renderMode.inspectionRecorded",
  NO_JS_HOLD_CHANGED: "renderMode.noJsHoldChanged",
} as const);

export type RenderModeSnapshotPayload = Readonly<{
  pageUrl: string;
  renderedHtml: string;
  rawHtml: string;
  renderMode: string;
  hiddenCount: number;
}>;

export type RenderModeViewState = Readonly<{
  inspecting: boolean;
  javaScriptDisabled: boolean;
  noJsHeld: boolean;
  operationId: string;
  baseUrl: string;
  lastSnapshotPageUrl: string;
  followUpCompleted: boolean;
  lastError: string;
}>;

export type RenderModeDirectiveState = Readonly<Pick<
  RenderModeViewState,
  "inspecting" | "operationId" | "noJsHeld" | "javaScriptDisabled"
>>;

type RenderModeDebugRecord = Readonly<Record<string, unknown>>;

export type RenderModeRunInspectionPayload = Readonly<{
  baseUrl: string;
  javaScriptDisabled: boolean;
  operationId: string;
}>;

export type RenderModeRunInspectionReply = Readonly<{
  ok: boolean;
  tabId: number;
  operationId: string;
  loadStarted: boolean;
  reloadResult: Readonly<{
    ok: boolean;
    error?: string;
  }> | null;
  followUpCompleted: boolean;
  followUpError: string;
  inspectionSnapshot: RenderModeSnapshotPayload | null;
  endAcknowledged: boolean;
  runtime?: RenderModeDebugRecord;
  state?: RenderModeDebugRecord;
}>;

export type RenderModeEndInspectionPayload = Readonly<{
  operationId: string;
}>;

export type RenderModeEndInspectionReply = Readonly<{
  ok: boolean;
  tabId: number;
  operationId: string;
  endAcknowledged: boolean;
  runtime?: RenderModeDebugRecord;
  state?: RenderModeDebugRecord;
}>;

export type RenderModeContentBeginPayload = Readonly<{
  operationId: string;
}>;

export type RenderModeContentBeginReply = Readonly<{
  ok: boolean;
  error?: string;
}>;

export type RenderModeContentHideConsentPayload = Readonly<Record<never, never>>;

export type RenderModeContentHideConsentReply = Readonly<{
  ok: boolean;
  hiddenCount: number;
  error?: string;
}>;

export type RenderModeContentCaptureHtmlPayload = Readonly<{
  baseUrl: string;
  operationId: string;
}>;

export type RenderModeContentCaptureHtmlReply = RenderModeSnapshotPayload & Readonly<{
  ok: boolean;
  error?: string;
}>;

export type RenderModeContentEndPayload = Readonly<{
  operationId: string;
}>;

export type RenderModeContentEndReply = Readonly<{
  ok: boolean;
  error?: string;
}>;

export type RenderModeInspectionRecordedPayload = Readonly<{
  operationId: string;
  baseUrl: string;
  javaScriptDisabled: boolean;
  noJsHeld: boolean;
  followUpCompleted: boolean;
  snapshotPageUrl: string;
}>;

export type RenderModeNoJsHoldChangedPayload = Readonly<{
  held: boolean;
  operationId: string;
  reason: string;
}>;
