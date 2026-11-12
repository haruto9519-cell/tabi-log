const test = require("node:test");
const assert = require("node:assert/strict");
const sync = require("../expense-sync.js");

test("keeps a newly created local expense until it is uploaded", () => {
  const remote = [{ id: "remote-1", amount: 100 }];
  const local = [{ id: "local-new", amount: 250 }];
  const meta = sync.normalizeMeta(null, remote, local);
  assert.deepEqual(sync.merge(remote, local, meta), [...remote, ...local]);
});

test("keeps a locally edited expense over an older cloud copy", () => {
  const remote = [{ id: "expense-1", amount: 100 }];
  const local = [{ id: "expense-1", amount: 180 }];
  const meta = sync.markDirty({ baselineIds: ["expense-1"], dirtyIds: [], deletedIds: [] }, "expense-1");
  assert.deepEqual(sync.merge(remote, local, meta), local);
});

test("does not resurrect an expense deleted on another device", () => {
  const remote = [];
  const local = [{ id: "expense-1", amount: 100 }];
  const meta = { baselineIds: ["expense-1"], dirtyIds: [], deletedIds: [] };
  assert.deepEqual(sync.merge(remote, local, meta), []);
});

test("a pending local edit wins even if the cloud copy was deleted elsewhere", () => {
  const remote = [];
  const local = [{ id: "expense-1", amount: 180 }];
  const meta = { baselineIds: ["expense-1"], dirtyIds: ["expense-1"], deletedIds: [] };
  assert.deepEqual(sync.merge(remote, local, meta), local);
});

test("a local deletion suppresses the cloud copy until sync succeeds", () => {
  const remote = [{ id: "expense-1", amount: 100 }];
  const local = [];
  const meta = sync.markDeleted({ baselineIds: ["expense-1"], dirtyIds: [], deletedIds: [] }, "expense-1");
  assert.deepEqual(sync.merge(remote, local, meta), []);
});

test("successful sync resets dirty and deleted markers to the new baseline", () => {
  const meta = sync.afterSuccess({ baselineIds: [], dirtyIds: ["a"], deletedIds: ["b"] }, ["a", "c"]);
  assert.deepEqual(meta, { baselineIds: ["a", "c"], dirtyIds: [], deletedIds: [] });
  assert.deepEqual(sync.merge([{ id: "a" }, { id: "c" }], [{ id: "a" }, { id: "c" }], meta), [{ id: "a" }, { id: "c" }]);
});
