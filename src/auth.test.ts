import { describe, expect, test } from "bun:test";
import {
  AccessGate,
  authCookie,
  authCookieName,
  formatPin,
  newPin,
} from "./auth";

describe("newPin", () => {
  test("is six digits, zero-padded", () => {
    expect(newPin(() => 42)).toBe("000042");
    expect(newPin(() => 4_293_999_999)).toBe("999999");
    for (let i = 0; i < 100; i++) expect(newPin()).toMatch(/^\d{6}$/);
  });

  test("redraws values that would bias the result", () => {
    const draws = [4_294_000_000, 4_294_967_295, 7];
    expect(newPin(() => draws.shift()!)).toBe("000007");
  });

  test("formats with a space for reading aloud", () => {
    expect(formatPin("482913")).toBe("482 913");
  });
});

describe("AccessGate", () => {
  const minute = 60_000;
  const name = authCookieName(4400);

  test("issues a cookie token for the right PIN", () => {
    const gate = new AccessGate("482913");
    const result = gate.login("482 913");
    if (!result.ok) throw new Error(result.error);
    expect(name).toBe("reviewbuddy_auth_4400");
    expect(gate.isAuthorized(`${name}=${result.token}`, name)).toBe(true);
    expect(gate.isAuthorized(`other=1; ${name}=${result.token}`, name)).toBe(
      true,
    );
    // Another reviewbuddy on the same host uses another port.
    expect(
      gate.isAuthorized(`${name}=${result.token}`, authCookieName(4401)),
    ).toBe(false);
    expect(authCookie(name, result.token)).toBe(
      `${name}=${result.token}; HttpOnly; SameSite=Strict; Path=/`,
    );
  });

  test("rejects wrong, malformed and missing PINs and unknown cookies", () => {
    const gate = new AccessGate("482913");
    expect(gate.login("000000")).toMatchObject({ ok: false, status: 401 });
    expect(gate.login("12345")).toMatchObject({ ok: false, status: 400 });
    expect(gate.login(undefined)).toMatchObject({ ok: false, status: 400 });
    expect(gate.isAuthorized(null, name)).toBe(false);
    expect(gate.isAuthorized(`${name}=forged`, name)).toBe(false);
  });

  test("allows 5 wrong PINs a minute", () => {
    const gate = new AccessGate("482913");
    for (let i = 0; i < 5; i++) {
      expect(gate.login("000000", i)).toMatchObject({ status: 401 });
    }
    expect(gate.login("482913", 10)).toMatchObject({ ok: false, status: 429 });
    expect(gate.login("482913", minute + 10)).toMatchObject({ ok: true });
  });

  test("locks after 20 wrong PINs until restarted", () => {
    let alerted = 0;
    const gate = new AccessGate("482913", () => alerted++);
    for (let i = 0; i < 20; i++) gate.login("000000", i * minute);
    expect(gate.locked).toBe(true);
    expect(alerted).toBe(1);
    expect(gate.login("482913", 100 * minute)).toMatchObject({
      ok: false,
      status: 403,
    });
  });
});
