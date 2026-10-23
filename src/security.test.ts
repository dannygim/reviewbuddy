import { describe, expect, test } from "bun:test";
import { isAllowedHost } from "./security";

describe("isAllowedHost", () => {
  test.each([
    ["127.0.0.1:4400"],
    ["127.0.0.1"],
    ["localhost:4400"],
    ["LOCALHOST"],
    ["[::1]:4400"],
    ["100.64.0.1:4400"],
    ["mac.tail1234.ts.net"],
    ["mac.tail1234.ts.net:443"],
  ])("allows %p", (host) => {
    expect(isAllowedHost(host, [])).toBe(true);
  });

  test.each([
    ["evil.example"],
    ["evil.example:4400"],
    ["localhost.evil.example"],
    ["ts.net.evil.example"],
    [""],
    [null],
  ])("rejects %p", (host) => {
    expect(isAllowedHost(host, [])).toBe(false);
  });

  test("allows configured names, ignoring case and port", () => {
    expect(isAllowedHost("MyMac:4400", ["mymac"])).toBe(true);
    expect(isAllowedHost("other:4400", ["mymac"])).toBe(false);
  });
});
