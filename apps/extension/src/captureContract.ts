export const EXTENSION_DISPLAY_NAME = "PAMILA Capture";

export interface ExtensionCaptureDraft {
  source: "airbnb" | "leasebreak";
  url: string;
  title: string | null;
  visibleFields: Record<string, string>;
  selectedText: string | null;
  pageText: string | null;
  approxLocation: unknown;
  thumbnailCandidates: Array<{
    url: string;
    width: number | null;
    height: number | null;
  }>;
}
