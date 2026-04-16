import type { CapturePayload } from "@pamila/core";

export const EXTENSION_DISPLAY_NAME = "PAMILA Capture";

export const CAPTURE_MESSAGE_TYPE = "PAMILA_CAPTURE_CURRENT_PAGE";

export const DEFAULT_EXTENSION_SETTINGS = {
  apiBaseUrl: "http://localhost:7410",
  localToken: "",
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

export type CaptureResponseMessage =
  | {
      ok: true;
      payload: CapturePayload;
    }
  | {
      ok: false;
      error: string;
    };
