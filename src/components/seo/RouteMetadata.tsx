import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

interface PageMetadata {
  title: string;
  description: string;
  robots: 'index,follow' | 'noindex,nofollow';
}

const DEFAULT_DESCRIPTION =
  'SYKABELAJAR adalah platform edukasi untuk mengikuti kompetisi, mengerjakan tantangan harian, naik peringkat, dan mengumpulkan penghargaan.';
const BRAND_IMAGE = 'https://sykabelajar.my.id/SB_logo.png';

function readableSegment(segment: string): string {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Keep the original path segment if it is not valid URI encoding.
  }
  return decoded
    .replace(/^@/, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function getPageMetadata(pathname: string): PageMetadata {
  const path = pathname.replace(/\/+$/, '') || '/';
  const privatePage: PageMetadata = {
    title: 'SYKABELAJAR — Platform Edukasi',
    description: DEFAULT_DESCRIPTION,
    robots: 'noindex,nofollow',
  };

  if (path === '/') {
    return {
      title: 'SYKABELAJAR — Lomba & Gamifikasi Edukasi',
      description: DEFAULT_DESCRIPTION,
      robots: 'index,follow',
    };
  }
  if (path === '/login') {
    return { title: 'Masuk ke SYKABELAJAR', description: 'Masuk ke akun SYKABELAJAR untuk melanjutkan aktivitas belajar dan kompetisi.', robots: 'index,follow' };
  }
  if (path === '/register') {
    return { title: 'Daftar Akun SYKABELAJAR', description: 'Buat akun SYKABELAJAR untuk mengikuti kompetisi, tantangan harian, dan aktivitas belajar.', robots: 'index,follow' };
  }
  if (path === '/leaderboard') {
    return { title: 'Papan Peringkat — SYKABELAJAR', description: 'Lihat papan peringkat dan pencapaian komunitas SYKABELAJAR.', robots: 'noindex,nofollow' };
  }

  if (path.startsWith('/lomba/')) {
    const parts = path.split('/').filter(Boolean);
    const slug = parts[1] ?? '';
    if (parts[2] === 'kerja' || parts[2] === 'twibbon') return privatePage;
    const competitionName = readableSegment(slug);
    return {
      title: competitionName ? `${competitionName} — Kompetisi SYKABELAJAR` : 'Kompetisi SYKABELAJAR',
      description: 'Temukan informasi kompetisi, pendaftaran, jadwal, dan penghargaan di SYKABELAJAR.',
      robots: 'noindex,nofollow',
    };
  }

  if (path === '/profile/edit' || path === '/profile/interface-settings' || path === '/profile/collective-history') {
    return privatePage;
  }
  if (/^\/profile\/[^/]+$/.test(path)) {
    const username = readableSegment(path.split('/')[2] ?? '');
    return {
      title: username ? `Profil ${username} — SYKABELAJAR` : 'Profil Pengguna — SYKABELAJAR',
      description: 'Lihat profil dan pencapaian pengguna di SYKABELAJAR.',
      robots: 'noindex,nofollow',
    };
  }

  if (
    path.startsWith('/admin') ||
    path.startsWith('/organizer') ||
    path.startsWith('/guru') ||
    path.startsWith('/pesan') ||
    path.startsWith('/peserta-kolektif') ||
    path.startsWith('/verify/') ||
    path.startsWith('/sertifikat-kolektif/') ||
    ['/home', '/feed', '/daily-tasks', '/awards', '/referrals', '/notifications', '/orders', '/claim-peserta-kolektif'].includes(path)
  ) {
    return privatePage;
  }
  return privatePage;
}

function upsertMeta(attribute: 'name' | 'property', key: string, value: string): void {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute('content', value);
}

export function RouteMetadata() {
  const location = useLocation();

  useEffect(() => {
    const metadata = getPageMetadata(location.pathname);
    const canonicalUrl = `${window.location.origin}${location.pathname}`;

    document.title = metadata.title;
    upsertMeta('name', 'description', metadata.description);
    upsertMeta('name', 'robots', metadata.robots);
    upsertMeta('property', 'og:title', metadata.title);
    upsertMeta('property', 'og:description', metadata.description);
    upsertMeta('property', 'og:url', canonicalUrl);
    upsertMeta('property', 'og:type', 'website');
    upsertMeta('property', 'og:site_name', 'SYKABELAJAR');
    upsertMeta('property', 'og:image', BRAND_IMAGE);
    upsertMeta('name', 'twitter:card', 'summary_large_image');
    upsertMeta('name', 'twitter:title', metadata.title);
    upsertMeta('name', 'twitter:description', metadata.description);
    upsertMeta('name', 'twitter:image', BRAND_IMAGE);

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = canonicalUrl;
  }, [location.pathname]);

  return null;
}
