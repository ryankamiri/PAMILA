import { describe, expect, it } from "vitest";

import { APP_NAME } from "./appConfig";

describe("web scaffold", () => {
  it("uses the PAMILA app name", () => {
    expect(APP_NAME).toBe("PAMILA");
  });
});
