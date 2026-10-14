import { afterEach, describe, expect, it, vi } from "vitest";

import { AxetSessionService } from "./axet-session.service";

describe("AxetSessionService", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "DeptAppService");
  });

  it("reads the identity and token supplied by the aXet host", async () => {
    Reflect.set(globalThis, "DeptAppService", {
      getUserInfo: () => ({ jwt: "host-token", displayName: "Ada", email: "ada@example.test" }),
    });

    await expect(new AxetSessionService().getSession()).resolves.toEqual({
      token: "host-token",
      displayName: "Ada",
      email: "ada@example.test",
    });
  });

  it("reports no session outside the aXet host", async () => {
    await expect(new AxetSessionService().getSession()).resolves.toBeNull();
  });

  it("supports an asynchronous host identity provider", async () => {
    Reflect.set(globalThis, "DeptAppService", {
      getUserInfo: vi.fn().mockResolvedValue({ jwt: "async-token", userName: "Ada" }),
    });

    await expect(new AxetSessionService().getSession()).resolves.toEqual({
      token: "async-token",
      displayName: "Ada",
      email: undefined,
    });
  });
});
