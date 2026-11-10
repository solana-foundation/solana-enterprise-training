import { useId } from "react";

/**
 * The Solana logo as served on solana.com: the gradient logomark plus the
 * SOLANA wordmark, which takes `currentColor`. `mark` renders the logomark only.
 */
export function SolanaLogo({ mark = false, className }: { mark?: boolean; className?: string }) {
  const gid = `sol-grad-${useId().replace(/:/g, "")}`;
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={mark ? "0 0 25.6 22.2" : "0 0 149 22"}
      fill="none"
      role="img"
      aria-label="Solana"
    >
      <path
        fill={`url(#${gid})`}
        d="m25.033 17.458-4.087 4.382a.95.95 0 0 1-.692.302H.879a.476.476 0 0 1-.348-.798l4.082-4.382a.95.95 0 0 1 .692-.302H24.68a.473.473 0 0 1 .353.798m-4.087-8.827a.96.96 0 0 0-.692-.302H.879a.475.475 0 0 0-.348.798l4.082 4.385a.96.96 0 0 0 .692.302H24.68a.476.476 0 0 0 .346-.798zM.879 5.483h19.375a.95.95 0 0 0 .692-.302L25.033.798a.475.475 0 0 0-.09-.724A.47.47 0 0 0 24.68 0H5.305a.95.95 0 0 0-.692.302L.531 4.685a.475.475 0 0 0 .348.798"
      />
      {!mark && (
        <path
          fill="currentColor"
          d="M48.653 9.365H38.288V5.95h13.06V2.538H38.252a3.407 3.407 0 0 0-3.425 3.388v3.46a3.406 3.406 0 0 0 3.425 3.392h10.38v3.414H35.075v3.413h13.578a3.41 3.41 0 0 0 3.425-3.388v-3.46a3.406 3.406 0 0 0-3.425-3.392m20.08-6.827H58.33a3.407 3.407 0 0 0-3.434 3.388v10.291a3.405 3.405 0 0 0 3.434 3.389h10.405a3.407 3.407 0 0 0 3.425-3.389V5.926a3.4 3.4 0 0 0-2.12-3.136 3.4 3.4 0 0 0-1.305-.252Zm-.025 13.654H58.354V5.952h10.35zm36.468-13.654H95.028a3.407 3.407 0 0 0-3.425 3.388v13.68h3.46v-5.607h10.102v5.607h3.46V5.926a3.41 3.41 0 0 0-2.136-3.143 3.4 3.4 0 0 0-1.313-.246Zm-.025 8.047H95.049V5.951h10.102zm40.424-8.047h-10.149a3.406 3.406 0 0 0-3.425 3.388v13.68h3.46v-5.607h10.079v5.607H149V5.926a3.42 3.42 0 0 0-1.011-2.403 3.4 3.4 0 0 0-2.414-.985m-.035 8.047h-10.102V5.951h10.102zm-20.066 5.607h-1.384l-4.948-12.224a2.27 2.27 0 0 0-2.113-1.43h-3.07a2.27 2.27 0 0 0-2.283 2.26v14.808h3.46V5.95h1.384l4.945 12.225a2.285 2.285 0 0 0 2.122 1.42h3.07a2.27 2.27 0 0 0 2.283-2.26V2.538h-3.466zm-46.8-13.654h-3.46v13.68a3.405 3.405 0 0 0 3.438 3.388H89.03v-3.414H78.675z"
        />
      )}
      <defs>
        <linearGradient id={gid} x1="2.494" x2="22.809" y1="22.671" y2="-0.233" gradientUnits="userSpaceOnUse">
          <stop offset="0.08" stopColor="#9945FF" />
          <stop offset="0.3" stopColor="#8752F3" />
          <stop offset="0.5" stopColor="#5497D5" />
          <stop offset="0.6" stopColor="#43B4CA" />
          <stop offset="0.72" stopColor="#28E0B9" />
          <stop offset="0.97" stopColor="#19FB9B" />
        </linearGradient>
      </defs>
    </svg>
  );
}
