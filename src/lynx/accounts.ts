export function buildValidateEndpointFromStageBase(stageBase: string): string {
  const host = stageBase.trim();
  return host ? `https://accounts.${host}/api/account/validate` : "";
}

export function buildLoginEndpointFromStageBase(stageBase: string): string {
  const host = stageBase.trim();
  return host ? `https://accounts.${host}/api/account/login` : "";
}

export function buildLoginBody(email: string, password: string): Readonly<{ email: string; password: string }> {
  return { email: email.trim(), password };
}
