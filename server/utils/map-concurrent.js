/** Map with bounded concurrency, input ordering, and drain-before-reject semantics. */
async function mapConcurrent(items, concurrency, mapper) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('concurrency must be a positive integer');
  }
  const results = new Array(items.length);
  let next = 0;
  let failed = false;
  let failure;
  async function worker() {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await mapper(items[index], index);
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (failed) throw failure;
  return results;
}

module.exports = { mapConcurrent };
