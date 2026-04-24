import type { CapturePayload } from "@pamila/core";

export const EXTENSION_DISPLAY_NAME = "PAMILA Capture";

export const CAPTURE_MESSAGE_TYPE = "PAMILA_CAPTURE_CURRENT_PAGE";
export const HELPER_CAPTURE_ACTIVE_TAB_MESSAGE_TYPE = "PAMILA_HELPER_CAPTURE_ACTIVE_TAB";
export const HELPER_CHECK_CONNECTION_MESSAGE_TYPE = "PAMILA_HELPER_CHECK_CONNECTION";

export const DEFAULT_EXTENSION_SETTINGS = {
  apiBaseUrl: "http://localhost:7410",
  localToken: "dev-local-token",
  pageTextLimit: 12_000,
  selectedTextLimit: 4_000,
  thumbnailLimit: 8
} as const;

export interface ExtensionSettings {
  apiBaseUrl: string;
  localToken: string;
  pageTextLimit: number;
  selectedTextLimit: number;
  thumbnailLimit: number;
}

export interface CaptureRequestMessage {
  type: typeof CAPTURE_MESSAGE_TYPE;
  settings: Pick<ExtensionSettings, "pageTextLimit" | "selectedTextLimit" | "thumbnailLimit">;
}

export type ApiConnectionStatus = "connected" | "token_issue" | "api_offline";

export interface ApiConnectionResult {
  status: ApiConnectionStatus;
  message: string;
}

export interface HelperCaptureActiveTabMessage {
  type: typeof HELPER_CAPTURE_ACTIVE_TAB_MESSAGE_TYPE;
}

export interface HelperCheckConnectionMessage {
  type: typeof HELPER_CHECK_CONNECTION_MESSAGE_TYPE;
}

export type CaptureResponseMessage =
  | {
      ok: true;
      payload: CapturePayload;
    }
  | {
      ok: false;
      error: string;
    };

export type HelperCaptureResult =
  | {
      ok: true;
      message: string;
      apiStatus: ApiConnectionStatus;
    }
  | {
      ok: false;
      message: string;
      apiStatus: ApiConnectionStatus;
    };
