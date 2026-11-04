// Subprocess fixtures for harness.test.js: intentionally failing or unfinished
// cases must not run in the process whose verdict checks them.
const assert = require("assert");
const fs = require("fs");
let writeCalls = 0;
if (process.argv[2] === "partial writes") {
  const originalWrite = fs.writeSync;
  fs.writeSync = (fd, bytes, offset, length) => {
    const transient = ["EAGAIN", "EWOULDBLOCK", "EINTR"][writeCalls++];
    if (transient) throw Object.assign(new Error("temporary write interruption"), { code: transient });
    // Split inside multibyte characters as well as between result lines.
    return originalWrite(fd, bytes, offset, Math.min(length, 3));
  };
}
const { test, atest, pass, fail, skip, counts } = require("../../_harness");

switch (process.argv[2]) {
  case "pending":
    test("pending without handles", () => new Promise(() => {}));
    break;
  case "many pending":
    // Initialize stdout's pipe before the harness writes, as ordinary test
    // diagnostics do; this exposes nonblocking fd backpressure on POSIX.
    console.log("fixture diagnostics");
    for (let i = 0; i < 4000; i++) test(`pending ${i}`, () => new Promise(() => {}));
    break;
  case "partial writes":
    test("pending café 🧪", () => new Promise(() => {}));
    process.on("exit", () => assert.ok(writeCalls > 3, "write fault injection was not exercised"));
    break;
  case "success":
    assert.strictEqual(atest, test);
    assert.strictEqual(test("sync", () => 42), undefined);
    (async () => {
      await atest("resolved", () => Promise.resolve());
      await test("deferred", () => new Promise(resolve => setImmediate(resolve)));
      assert.deepStrictEqual(counts, { passed: 3, failed: 0, skipped: 0 });
      test("after await", () => {});
    })().catch(e => fail("await contract", e));
    break;
  case "failures":
    test("sync throw", () => { throw new Error("sync reason"); });
    test("rejected error", () => Promise.reject(new Error("async reason")));
    test("rejected string", () => Promise.reject("string reason"));
    pass("explicit pass");
    skip("explicit skip", "fixture reason");
    fail("explicit fail", new Error("explicit reason"));
    test("after failures", () => {});
    break;
  case "mixed":
    test("pending alpha", () => new Promise(() => {}));
    test("deferred success", () => new Promise(resolve => setImmediate(resolve)));
    test("pending beta", () => new Promise(() => {}));
    test("deferred rejection", () => new Promise((resolve, reject) => {
      setImmediate(() => reject(new Error("mixed reason")));
    }));
    test("sync success", () => {});
    break;
  case "duplicate names":
    test("same name", () => new Promise(() => {}));
    test("same name", () => Promise.resolve());
    test("same name", () => new Promise(() => {}));
    break;
  case "filtered":
    test("excluded pending", () => new Promise(() => {}));
    test("excluded throw", () => { throw new Error("must not execute"); });
    test("selected sync", () => {});
    test("selected async", () => Promise.resolve());
    break;
  case "before exit":
    test("resumes before exit", () => new Promise(resolve => {
      process.once("beforeExit", () => setImmediate(resolve));
    }));
    break;
  case "explicit reports and pending":
    test("still pending", () => new Promise(() => {}));
    // These APIs report independent results; a matching name cannot settle a test.
    pass("still pending");
    skip("still pending", "independent skip");
    fail("still pending", "independent failure");
    break;
  case "forced exit":
    test("pending on forced exit", () => new Promise(() => {}));
    setImmediate(() => process.exit(0));
    break;
  case "existing exit code":
    test("success with external failure", () => Promise.resolve());
    process.exitCode = 7;
    break;
  case "unhandled rejection":
    test("completed", () => Promise.resolve());
    Promise.reject(new Error("outside the test"));
    break;
  case "thenables":
    assert.strictEqual(test("sync thenable", () => ({ then(resolve) { resolve(); } })), undefined);
    test("async thenable", () => ({ then(resolve) { setImmediate(resolve); } }));
    test("rejected thenable", () => ({ then(resolve, reject) { reject("thenable reason"); } }));
    break;
  default:
    throw new Error(`Unknown harness fixture: ${process.argv[2]}`);
}
