import type { ComponentType, SVGProps } from "react";

export type WorkspaceIcon = ComponentType<SVGProps<SVGSVGElement>>;

// Small, single-color UI glyphs; the official brand marks remain separate.
function Glyph({ children, ...props }: SVGProps<SVGSVGElement>) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{children}</svg>;
}

export function WesternBootIcon(props: SVGProps<SVGSVGElement>) {
  return <Glyph {...props}>
    <path d="M5 3h8l-1 10 3 3 5 1c1 .2 1 3-1 3H9l-2-2H4v-5Z" />
    <path d="M4 20h3v-2M6 6l3 2 3-2M9 8v4M12 13l-3 2" />
  </Glyph>;
}

export function WesternHatIcon(props: SVGProps<SVGSVGElement>) {
  return <Glyph {...props}>
    <path d="m6 14 2-8c.4-1.5 2-2 4 0 2-2 3.6-1.5 4 0l2 8" />
    <path d="M6.5 12c3.5 1 7.5 1 11 0M6 14l-3-2c-2 3 0 7 9 7s11-4 9-7l-3 2c-4 1-8 1-12 0Z" />
  </Glyph>;
}

export function WesternBadgeIcon(props: SVGProps<SVGSVGElement>) {
  return <Glyph {...props}>
    <path d="m12 2 3 5 6 .5-2.5 5 2.5 5-6 .5-3 4-3-4-6-.5 2.5-5-2.5-5L9 7Z" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </Glyph>;
}
