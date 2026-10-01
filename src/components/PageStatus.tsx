/** Consistent loading and error states for pages that load data from the API. */

export function Loading({ what = 'data' }: { what?: string }) {
  return (
    <p className="subtitle" role="status">
      Loading {what}…
    </p>
  );
}

/** An error with the next step when there is an obvious one (no profile yet, server not running). */
export function PageError({ message }: { message: string }) {
  const needsProfile = /profile first/i.test(message);
  const offline = /not reachable/i.test(message);
  return (
    <p className="error" role="alert">
      {message}
      {needsProfile && (
        <>
          {' '}
          <a href="#/profile">Go to Profile</a>
        </>
      )}
      {offline && ' Check that the server is running, then reload the page.'}
    </p>
  );
}
