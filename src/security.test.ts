import { describe, expect, test } from "bun:test";
import { isAllowedHost, isOwnerRequest } from "./security";

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

describe("isOwnerRequest", () => {
  const headers = (host: string | null, extra: Record<string, string> = {}) =>
    new Headers({ ...(host === null ? {} : { host }), ...extra });

  test.each([
    ["127.0.0.1", "127.0.0.1:4400"],
    ["127.0.0.1", "127.0.0.1"],
    ["127.255.0.1", "localhost"],
    ["127.0.0.1", "LOCALHOST:4400"],
    ["::1", "[::1]:4400"],
    ["::ffff:127.0.0.1", "localhost:4400"],
    // --host 0.0.0.0 prints http://0.0.0.0:<port>/
    ["127.0.0.1", "0.0.0.0:4400"],
    ["::1", "[::]:4400"],
  ])("a direct connection from %p to %p is the owner", (address, host) => {
    expect(isOwnerRequest(address, headers(host))).toBe(true);
  });

  test.each([
    ["100.64.0.1"],
    ["192.168.0.2"],
    ["::ffff:192.168.0.2"],
    ["::2"],
    ["127.0.0.256"],
    [""],
    [null],
    [undefined],
  ])("a connection from %p is not the owner", (address) => {
    expect(isOwnerRequest(address, headers("127.0.0.1:4400"))).toBe(false);
  });

  test.each([
    ["mac.tail1234.ts.net"],
    ["mac.tail1234.ts.net:8443"],
    ["100.64.0.1:4400"],
    ["localhost.evil.example"],
    ["mymac:4400"],
    [""],
    [null],
  ])("a connection to %p is not the owner", (host) => {
    expect(isOwnerRequest("127.0.0.1", headers(host))).toBe(false);
  });

  // tailscale serve connects from 127.0.0.1 and adds X-Forwarded-*.
  test.each([
    ["X-Forwarded-For", "100.64.0.2"],
    ["X-Forwarded-Host", "mac.tail1234.ts.net"],
    ["Forwarded", "for=100.64.0.2"],
    ["X-Forwarded-For", ""],
  ])("a request with %s is not the owner", (name, value) => {
    expect(
      isOwnerRequest("127.0.0.1", headers("127.0.0.1:4400", { [name]: value })),
    ).toBe(false);
  });
});
