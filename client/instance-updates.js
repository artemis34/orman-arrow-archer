// Three uploads an attribute's entire capacity when updateRanges is empty.
// Instance pools keep spare slots, so publish only the active prefix. Keep one
// range record per attribute to avoid creating garbage every animation frame.
const ranges = new WeakMap();

export function publishInstanceRange(attribute, count) {
  if (count <= 0) return;
  // A hidden mesh may be updated several times before Three uploads it. Keep
  // every pending write, including a tail that is temporarily outside count:
  // cached instance colours can become visible again without being rewritten.
  let end = Math.min(count, attribute.count) * attribute.itemSize;
  for (const pending of attribute.updateRanges)
    end = Math.max(end, pending.start + pending.count);
  let range = ranges.get(attribute);
  if (!range) {
    range = { start: 0, count: 0 };
    ranges.set(attribute, range);
  }
  range.count = end;
  attribute.clearUpdateRanges();
  attribute.updateRanges.push(range);
  attribute.needsUpdate = true;
}
