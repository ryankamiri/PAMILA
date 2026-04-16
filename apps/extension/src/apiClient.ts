import type { CapturePayload } from "@pamila/core";

import type { ExtensionSettings } from "./captureContract.js";

export async function postCapturePayload(settings: ExtensionSettings, payload: CapturePayload): Promise<void> {
  const response = await fetch(`${settings.apiBaseUrl}/api/captures`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(settings.localToken ? { "X-PAMILA-Token": settings.localToken } : {})
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await readResponseBody(response);
    throw new Error(`PAMILA API returned ${response.status}${body ? `: ${body}` : ""}`);
  }
}

async function readResponseBody(response: Response): Promise<string | null> {
  try {
    const body = await response.text();
    return body.trim() || null;
  } catch {
    return null;
  }
}
