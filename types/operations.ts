export interface TabOperationResult<TResult = unknown> {
  ok: boolean;
  result?: TResult;
  error?: {
    code: string;
    message: string;
  };
}

export interface TabOperationDescriptor {
  key: string;
  timeoutMs: number;
}
