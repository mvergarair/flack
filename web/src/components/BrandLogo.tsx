import { useBranding } from '../data/branding';
import { Logo } from './icons';

/** The workspace logo set by an admin, or the Flack mark. */
export function BrandLogo({ size = 32 }: { size?: number }) {
  const { branding, name } = useBranding();
  if (!branding.logo) return <Logo size={size} />;
  return (
    <img
      src={branding.logo}
      alt=""
      aria-label={`${name} logo`}
      width={size}
      height={size}
      data-testid="brand-logo"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.22), objectFit: 'contain', flexShrink: 0 }}
    />
  );
}
