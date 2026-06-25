export interface RenderModeInspectionSnapshot {
  url: string;
  timestamp: number;
  html?: string;
}

export interface RenderModeInspectionResult {
  withJavaScript: RenderModeInspectionSnapshot;
  withoutJavaScript: RenderModeInspectionSnapshot;
}
