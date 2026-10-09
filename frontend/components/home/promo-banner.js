'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { bannerTarget } from '../../lib/banner-target.mjs';
import { homeBannerSlides } from '../../lib/home-banners.mjs';
import { closestBanner, startBannerAutoplay } from '../../lib/banner-autoplay.mjs';
import { Icon } from '../icons';
import styles from './home.module.css';

function BannerSlide({ banner, index, count, current, onImageError }) {
  const hasImage = banner?.image_url;
  return <article className={styles.slide} role="group" aria-roledescription="สไลด์" aria-label={`${index + 1} จาก ${count}`}>
    <a href={bannerTarget(banner)} className={styles.bannerLink} tabIndex={current ? 0 : -1}>
      {hasImage ? <div className={styles.bannerImage}>
        <Image src={banner.image_url} alt={banner.title || 'โปรโมชันแนะนำ'} fill unoptimized sizes="(max-width: 760px) calc(100vw - 32px), 728px" priority={index === 0} onError={() => onImageError(banner.image_url)} />
      </div> : <div className={styles.fallbackHero}>
        <div><span className={styles.eyebrow}>{banner?.demo ? 'ตัวอย่างโปรโมชัน' : 'อร่อยใกล้คุณ'}</span><h2>{banner?.title || <>มื้ออร่อยใกล้หอ<br />ไม่ต้องไปไหนไกล</>}</h2><p>{banner?.subtitle || 'เลือกร้านที่ชอบ แล้วให้เราส่งถึงคุณ'}</p><span className={styles.heroCta}>{banner ? 'ดูรายละเอียด' : 'เลือกร้านอร่อย'} <Icon name="arrow" size={15} /></span></div>
        <div className={styles.foodArt}><Image src="/demo/promo-food.svg" alt="" fill sizes="(max-width: 600px) 40vw, 300px" priority={index === 0} /></div>
      </div>}
    </a>
  </article>;
}

export function PromoBanner({ banners = [], loading = false }) {
  const root = useRef(null);
  const track = useRef(null);
  const [index, setIndex] = useState(0);
  const [failedImages, setFailedImages] = useState([]);
  const slides = homeBannerSlides(banners, failedImages, process.env.NODE_ENV === 'development');
  const current = Math.min(index, slides.length - 1);
  const slideCount = slides.length;
  const slideKey = slides.map((slide) => slide?.id || 'fallback').join(',');

  function imageFailed(url) {
    setFailedImages((previous) => previous.includes(url) ? previous : [...previous, url]);
    setIndex(0);
    if (track.current) track.current.scrollLeft = 0;
  }

  const moveTo = useCallback((next) => {
    const element = track.current;
    if (!element) return;
    const target = Math.max(0, Math.min(next, slideCount - 1));
    const slide = element.children[target];
    const left = slide.getBoundingClientRect().left - element.getBoundingClientRect().left + element.scrollLeft;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollTo({ left, behavior: reduced ? 'instant' : 'smooth' });
  }, [slideCount]);

  useEffect(() => {
    if (loading || !root.current || !track.current) return;
    return startBannerAutoplay({ root: root.current, track: track.current,
      advance: () => moveTo((closestBanner(track.current) + 1) % slideCount),
    });
  }, [loading, slideKey, slideCount, moveTo]);

  function onScroll() {
    const element = track.current;
    if (!element) return;
    setIndex(closestBanner(element));
  }

  if (loading) return <div className={styles.bannerSkeleton} role="status"><span className="sr-only">กำลังโหลดโปรโมชัน</span></div>;
  return <section ref={root} className={styles.carousel} aria-label="โปรโมชันแนะนำ" aria-roledescription="คารูเซล">
    <div key={slideKey} ref={track} className={styles.bannerTrack} onScroll={onScroll}>
      {slides.map((banner, position) => <BannerSlide key={banner ? `${banner.id}:${banner.image_url}` : 'fallback'} banner={banner} index={position} count={slides.length} current={position === current} onImageError={imageFailed} />)}
    </div>
    {slides.length > 1 && <div className={styles.carouselControls}>
      <div className={styles.dots}>{slides.map((banner, position) => <button key={banner?.id || position} type="button" aria-label={`ดูแบนเนอร์ ${position + 1}`} aria-current={current === position ? 'true' : undefined} onClick={() => moveTo(position)}><span /></button>)}</div>
      <span className="sr-only" aria-live="polite">แบนเนอร์ {current + 1} จาก {slides.length}</span>
    </div>}
  </section>;
}
