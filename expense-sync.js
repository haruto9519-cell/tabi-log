(function (root) {
  "use strict";
  function normalizeMeta(raw, remoteExpenses, localExpenses) {
    const remoteIds = new Set((remoteExpenses || []).map(item => String(item.id)));
    if (!raw || typeof raw !== "object") {
      return {
        baselineIds: [...remoteIds],
        dirtyIds: (localExpenses || []).map(item => String(item.id)).filter(id => !remoteIds.has(id)),
        deletedIds: []
      };
    }
    return {
      baselineIds: Array.isArray(raw.baselineIds) ? raw.baselineIds.map(String) : [...remoteIds],
      dirtyIds: Array.isArray(raw.dirtyIds) ? raw.dirtyIds.map(String) : [],
      deletedIds: Array.isArray(raw.deletedIds) ? raw.deletedIds.map(String) : []
    };
  }

  function merge(remoteExpenses, localExpenses, meta) {
    const deleted = new Set(meta.deletedIds || []);
    const dirty = new Set(meta.dirtyIds || []);
    const baseline = new Set(meta.baselineIds || []);
    const merged = new Map();
    for (const item of remoteExpenses || []) {
      const id = String(item.id);
      if (!deleted.has(id)) merged.set(id, item);
    }
    for (const item of localExpenses || []) {
      const id = String(item.id);
      if (deleted.has(id)) {
        merged.delete(id);
      } else if (dirty.has(id) || !baseline.has(id)) {
        merged.set(id, item);
      }
      // A baseline item missing remotely was deleted on another device.
      // Keep the remote deletion unless this device has a pending local edit.
    }
    return [...merged.values()];
  }

  function markDirty(meta, id) {
    const value = String(id);
    return {
      baselineIds: [...new Set(meta.baselineIds || [])],
      dirtyIds: [...new Set([...(meta.dirtyIds || []), value])],
      deletedIds: (meta.deletedIds || []).filter(item => item !== value)
    };
  }

  function markDeleted(meta, id) {
    const value = String(id);
    return {
      baselineIds: [...new Set(meta.baselineIds || [])],
      dirtyIds: (meta.dirtyIds || []).filter(item => item !== value),
      deletedIds: [...new Set([...(meta.deletedIds || []), value])]
    };
  }

  function afterSuccess(meta, syncedIds) {
    return {
      baselineIds: [...new Set((syncedIds || []).map(String))],
      dirtyIds: [],
      deletedIds: []
    };
  }

  const api = { normalizeMeta, merge, markDirty, markDeleted, afterSuccess };
  root.TabiLogExpenseSync = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
