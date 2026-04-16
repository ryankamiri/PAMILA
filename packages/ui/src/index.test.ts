import { describe, expect, it } from "vitest";

import { UI_PACKAGE_STATUS } from "./index";

describe("ui scaffold", () => {
  it("marks UI components as future work", () => {
    expect(UI_PACKAGE_STATUS.readyForSharedComponents).toBe(true);
  });
});
