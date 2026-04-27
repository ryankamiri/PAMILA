import type { CapturePayload } from "@pamila/core";

import type {
  ApiConnectionResult,
  AppliedCaptureCorrection,
  CaptureCorrectionMode,
  ExtensionSettings
} from "./captureContract.js";

export interface ApiSavedListingMatch {
  canonicalUrl: string;
  listingId: string;
  sourceUrl: string;
  status: string;
  title: string;
}

export interface CaptureImportApiResponse {
  appliedCorrections?: AppliedCaptureCorrection[];
  correctionMode?: CaptureCorrectionMode;
  listing: {
    canonicalSourceUrl?: string;
    id: string;
    sourceUrl: string;
    status: string;
    title: string;
  };
}

export interface SavedListingsLookupApiResponse {
  matches: Record<string, ApiSavedListingMatch>;
}

export async function postCapturePayload(
  settings: ExtensionSettings,
  payload: CapturePayload
): Promise<CaptureImportApiResponse> {
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

  return (await response.json()) as CaptureImportApiResponse;
}

export async function lookupSavedListings(
  settings: ExtensionSettings,
  urls: string[],
  source?: "airbnb" | "leasebreak"
): Promise<SavedListingsLookupApiResponse> {
  const response = await fetch(`${settings.apiBaseUrl}/api/listings/lookup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(settings.localToken ? { "X-PAMILA-Token": settings.localToken } : {})
    },
    body: JSON.stringify(source ? { source, urls } : { urls })
  });

  if (!response.ok) {
    const body = await readResponseBody(response);
    throw new Error(`PAMILA API returned ${response.status}${body ? `: ${body}` : ""}`);
  }

  return (await response.json()) as SavedListingsLookupApiResponse;
}

export async function checkApiConnection(settings: ExtensionSettings): Promise<ApiConnectionResult> {
  try {
    const healthResponse = await fetch(`${settings.apiBaseUrl}/health`);
    if (!healthResponse.ok) {
      return {
        status: "api_offline",
        message: `PAMILA API health check returned ${healthResponse.status}.`
      };
    }

    const protectedResponse = await fetch(`${settings.apiBaseUrl}/api/settings`, {
      headers: settings.localToken ? { "X-PAMILA-Token": settings.localToken } : {}
    });

    if (protectedResponse.ok) {
      return {
        status: "connected",
        message: "Connected to PAMILA API."
      };
    }

    if (protectedResponse.status === 401 || protectedResponse.status === 403) {
      return {
        status: "token_issue",
        message: "API is running, but the extension token does not match PAMILA_LOCAL_TOKEN."
      };
    }

    return {
      status: "api_offline",
      message: `PAMILA API settings check returned ${protectedResponse.status}.`
    };
  } catch {
    return {
      status: "api_offline",
      message: "Could not reach the local PAMILA API."
    };
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
