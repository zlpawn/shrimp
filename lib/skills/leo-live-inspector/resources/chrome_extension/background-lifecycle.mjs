export function shouldStopNetworkCapture(session) {
  return Boolean(session && session.stoppedAt == null);
}
