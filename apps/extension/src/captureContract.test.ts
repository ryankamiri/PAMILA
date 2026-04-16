import { describe, expect, it } from "vitest";

import { EXTENSION_DISPLAY_NAME } from "./captureContract";

describe("extension scaffold", () => {
  it("names the capture helper", () => {
    expect(EXTENSION_DISPLAY_NAME).toBe("PAMILA Capture");
  });
});
