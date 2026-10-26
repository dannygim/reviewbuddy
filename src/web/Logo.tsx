export function Logo() {
  return (
    <span className="logo" role="img" aria-label="reviewbuddy">
      <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
        <path
          className="logo-back"
          d="M6 3h12a4 4 0 0 1 4 4v7a4 4 0 0 1-4 4h-7l-4 3.5V18H6a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z"
        />
        <path
          className="logo-front"
          d="M14 11h12a4 4 0 0 1 4 4v7a4 4 0 0 1-4 4h-1v4l-5-4h-6a4 4 0 0 1-4-4v-7a4 4 0 0 1 4-4z"
        />
        <path className="logo-check" d="M16.5 18.5l2.5 2.5 5-5" />
      </svg>
      <span aria-hidden="true">
        review<b>buddy</b>
      </span>
    </span>
  );
}
