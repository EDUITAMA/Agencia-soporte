import "@angular/compiler";
import { describe, expect, it } from "vitest";

import { AppComponent } from "./app.component";

describe("AppComponent", () => {
  it("derives initials from the authenticated aXet identity", () => {
    const component = Object.create(AppComponent.prototype) as AppComponent;

    expect(component.initials({ token: "token", displayName: "Ada Lovelace" })).toBe("AL");
    expect(component.initials({ token: "token", email: "ada@example.test" })).toBe("AE");
  });
});
