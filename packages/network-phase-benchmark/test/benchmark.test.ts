import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { TLSSocket } from "node:tls";
import test from "node:test";

import {
  runNetworkPhaseBenchmark,
  type HttpsRequestFactory
} from "../src/index.ts";

class FakeRequest extends EventEmitter {
  onEnd: (() => void) | null = null;
  destroyed = false;

  end(): void {
    this.onEnd?.();
  }

  destroy(): this {
    this.destroyed = true;
    return this;
  }
}

class FakeSocket extends EventEmitter {
  remoteAddress: string | undefined;
  remoteFamily: string | undefined;
}

function response(statusCode: number): IncomingMessage {
  return {
    statusCode,
    resume() {},
    destroy() {}
  } as unknown as IncomingMessage;
}

function successFactory(clock: { value: number }): HttpsRequestFactory {
  return (_url, _options, onResponse) => {
    const request = new FakeRequest();
    const socket = new FakeSocket();
    request.onEnd = () => {
      clock.value = 1;
      request.emit("socket", socket as unknown as TLSSocket);
      clock.value = 10;
      socket.emit("lookup", null, "203.0.113.10", 4, "example.com");
      clock.value = 30;
      socket.emit("connect");
      clock.value = 50;
      socket.emit("secureConnect");
      clock.value = 90;
      onResponse(response(401));
    };
    return request as unknown as ClientRequest;
  };
}

test("measures DNS, TCP, TLS and request-to-first-byte phases", async () => {
  const clock = { value: 0 };
  const result = await runNetworkPhaseBenchmark(
    { url: "https://api.example.com/v1/models" },
    { request: successFactory(clock), now: () => clock.value }
  );

  assert.equal(result.status, "success");
  assert.equal(result.httpStatus, 401);
  assert.equal(result.resolvedAddress, "203.0.113.10");
  assert.deepEqual(result.phases, {
    dnsMs: 10,
    tcpMs: 20,
    tlsMs: 20,
    requestToFirstByteMs: 40,
    totalToFirstByteMs: 90
  });
});

test("supports IP targets without a DNS lookup event", async () => {
  const clock = { value: 0 };
  const factory: HttpsRequestFactory = (_url, _options, onResponse) => {
    const request = new FakeRequest();
    const socket = new FakeSocket();
    socket.remoteAddress = "127.0.0.1";
    socket.remoteFamily = "IPv4";
    request.onEnd = () => {
      clock.value = 1;
      request.emit("socket", socket as unknown as TLSSocket);
      clock.value = 20;
      socket.emit("connect");
      clock.value = 30;
      socket.emit("secureConnect");
      clock.value = 50;
      onResponse(response(200));
    };
    return request as unknown as ClientRequest;
  };

  const result = await runNetworkPhaseBenchmark(
    { url: "https://127.0.0.1/" },
    { request: factory, now: () => clock.value }
  );
  assert.equal(result.phases?.dnsMs, 0);
  assert.equal(result.phases?.tcpMs, 19);
  assert.equal(result.resolvedAddress, "127.0.0.1");
});

test("classifies DNS errors", async () => {
  const factory: HttpsRequestFactory = () => {
    const request = new FakeRequest();
    request.onEnd = () => {
      const error = Object.assign(new Error("not found"), {
        code: "ENOTFOUND"
      });
      request.emit("error", error);
    };
    return request as unknown as ClientRequest;
  };
  const result = await runNetworkPhaseBenchmark(
    { url: "https://missing.example/" },
    { request: factory, now: () => 0 }
  );
  assert.equal(result.status, "dns-error");
  assert.equal(result.errorCode, "ENOTFOUND");
});

test("classifies TCP and TLS errors by the active phase", async () => {
  const makeFactory = (secure: boolean): HttpsRequestFactory =>
    () => {
      const request = new FakeRequest();
      const socket = new FakeSocket();
      request.onEnd = () => {
        request.emit("socket", socket as unknown as TLSSocket);
        socket.emit("lookup", null, "203.0.113.10", 4, "example.com");
        if (secure) {
          socket.emit("connect");
          request.emit(
            "error",
            Object.assign(new Error("TLS"), {
              code: "ERR_TLS_CERT_ALTNAME_INVALID"
            })
          );
        } else {
          request.emit(
            "error",
            Object.assign(new Error("refused"), {
              code: "ECONNREFUSED"
            })
          );
        }
      };
      return request as unknown as ClientRequest;
    };

  assert.equal(
    (
      await runNetworkPhaseBenchmark(
        { url: "https://example.com/" },
        { request: makeFactory(false), now: () => 0 }
      )
    ).status,
    "tcp-error"
  );
  assert.equal(
    (
      await runNetworkPhaseBenchmark(
        { url: "https://example.com/" },
        { request: makeFactory(true), now: () => 0 }
      )
    ).status,
    "tls-error"
  );
});

test("enforces request timeout", async () => {
  const factory: HttpsRequestFactory = () => {
    const request = new FakeRequest();
    request.onEnd = () => request.emit("timeout");
    return request as unknown as ClientRequest;
  };
  const result = await runNetworkPhaseBenchmark(
    { url: "https://example.com/", timeoutMs: 100 },
    { request: factory, now: () => 0 }
  );
  assert.equal(result.status, "timeout");
  assert.equal(result.errorCode, "ETIMEDOUT");
});

test("supports cancellation before and during a request", async () => {
  const pre = new AbortController();
  pre.abort();
  assert.equal(
    (
      await runNetworkPhaseBenchmark({
        url: "https://example.com/",
        signal: pre.signal
      })
    ).status,
    "cancelled"
  );

  const running = new AbortController();
  let fakeRequest: FakeRequest | null = null;
  const factory: HttpsRequestFactory = () => {
    fakeRequest = new FakeRequest();
    return fakeRequest as unknown as ClientRequest;
  };
  const pending = runNetworkPhaseBenchmark(
    { url: "https://example.com/", signal: running.signal },
    { request: factory, now: () => 0 }
  );
  running.abort();
  assert.equal((await pending).status, "cancelled");
  assert.equal(fakeRequest?.destroyed, true);
});

test("rejects unsafe URLs and invalid timeouts", () => {
  assert.throws(
    () => runNetworkPhaseBenchmark({ url: "http://example.com/" }),
    /must use HTTPS/
  );
  assert.throws(
    () =>
      runNetworkPhaseBenchmark({
        url: "https://user:pass@example.com/"
      }),
    /must not contain credentials/
  );
  assert.throws(
    () =>
      runNetworkPhaseBenchmark({
        url: "https://example.com/",
        timeoutMs: 0
      }),
    /positive integer/
  );
});
