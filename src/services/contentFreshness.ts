export function getLocalDateFreshnessKey(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getTimeBucketFreshnessKey(bucketHours: number, now: Date = new Date()): string {
  const bucketMs = bucketHours * 60 * 60 * 1000;
  const bucket = Math.floor(now.getTime() / bucketMs);
  return `${bucketHours}h:${bucket}`;
}
