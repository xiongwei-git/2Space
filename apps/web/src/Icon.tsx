const paths: Record<string, string[]> = {
  clipboard: [
    "M9 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3",
    "M9 3h6v4H9z",
  ],
  lock: ["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4"],
  clock: ["M12 8v4l3 2"],
  copy: ["M9 9h12v12H9z", "M5 15H3V3h12v2"],
  download: ["M12 3v12", "m7 10 5 5 5-5", "M5 16v5h14v-5"],
  share: ["M18 8 6 12l12 4"],
  globe: ["M3 12h18", "M12 3c5 5 5 13 0 18-5-5-5-13 0-18"],
  refresh: [
    "M20 7v5h-5",
    "M4 17v-5h5",
    "M5 8a8 8 0 0 1 13-4l2 3",
    "M19 16a8 8 0 0 1-13 4l-2-3",
  ],
  zap: ["m13 2-9 12h7l-1 8 10-13h-7z"],
  eye: ["M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12"],
  qr: [
    "M3 3h6v6H3z",
    "M15 3h6v6h-6z",
    "M3 15h6v6H3z",
    "M15 15h3v3h3v3h-6z",
    "M21 12v3",
    "M12 3v3",
    "M12 12h3",
    "M3 12h3",
    "M12 18v3",
  ],
  phone: ["M7 2h10v20H7z", "M11 18h2"],
  code: ["m8 7-5 5 5 5", "m16 7 5 5-5 5"],
  list: [
    "M8 6h13",
    "M8 12h13",
    "M8 18h13",
    "M3 6h.01",
    "M3 12h.01",
    "M3 18h.01",
  ],
  heart: ["M20 4a5 5 0 0 0-8 1 5 5 0 0 0-8-1C-2 10 7 18 12 21c5-3 14-11 8-17Z"],
  arrow: ["M4 12h16", "m14 6 6 6-6 6"],
};
export default function Icon({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) {
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === "clock" || name === "globe" ? (
        <circle cx="12" cy="12" r="9" />
      ) : name === "eye" ? (
        <circle cx="12" cy="12" r="3" />
      ) : name === "share" ? (
        <>
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
        </>
      ) : null}
      {(paths[name] || paths.clipboard).map((d, index) => (
        <path d={d} key={index} />
      ))}
    </svg>
  );
}
