// CivicAI mark: a location pin with a check, for "verified civic reports". Same artwork as public/favicon.svg.
export function LogoMark({ size = 36 }: { size?: number }) {
  return <svg className="brand-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <rect width="64" height="64" rx="14" fill="#153f33" />
    <path d="M32 11c-8.3 0-15 6.5-15 14.6 0 10.2 12 23.1 14 25.2.5.5 1.5.5 2 0 2-2.1 14-15 14-25.2C47 17.5 40.3 11 32 11Z" fill="#dbe7a8" />
    <path d="m25 26 5 5 9-10" fill="none" stroke="#153f33" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
