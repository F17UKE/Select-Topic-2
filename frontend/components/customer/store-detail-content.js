'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../icons';
import { baht } from '../../lib/api';
import { openReviewDialog } from '../../lib/review-dialog.mjs';
import styles from './store-detail.module.css';

// Presentation-only exclusion of the explicitly identified verification fixtures.
// No records, availability flags or purchase permissions are changed.
export function visibleStoreCategories(categories = []) {
  return categories.filter((category) => category.name !== 'Phase G Demo')
    .map((category) => ({ ...category, items: (category.items || []).filter((item) => item.name !== 'Phase G Demo Rice') }))
    .filter((category) => category.items.length > 0);
}

function StoreImage({ src, alt, hero = false, sizes }) {
  const [failed, setFailed] = useState(null);
  return src && failed !== src
    ? <Image src={src} alt={alt} fill sizes={sizes} priority={hero} loading={hero ? undefined : 'lazy'} onError={() => setFailed(src)} />
    : <div className={styles.imageFallback} role="img" aria-label={alt}><Icon name="scooter" size={36} /><span>อร่อยใกล้คุณ</span></div>;
}

export function StoreGallery({ images = [], name, closed = false }) {
  const track = useRef(null);
  const [index, setIndex] = useState(0);
  const slides = images.length ? images : [{ id: 'fallback' }];
  function onScroll() {
    const element = track.current;
    const left = element.getBoundingClientRect().left;
    let nearest = 0;
    Array.from(element.children).forEach((slide, position) => {
      if (Math.abs(slide.getBoundingClientRect().left - left) < Math.abs(element.children[nearest].getBoundingClientRect().left - left)) nearest = position;
    });
    setIndex(nearest);
  }
  function select(position) {
    const element = track.current;
    const left = element.children[position].getBoundingClientRect().left - element.getBoundingClientRect().left + element.scrollLeft;
    element.scrollTo({ left, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  return <section className={styles.gallery} aria-label="รูปภาพร้าน">
    <div ref={track} onScroll={onScroll} className={`${styles.galleryTrack} ${closed ? styles.closedGallery : ''}`}>
      {slides.map((image, position) => <div className={styles.gallerySlide} key={image.id} role="group" aria-label={`รูป ${position + 1} จาก ${slides.length}`}>
        <StoreImage src={image.image_url} alt={image.alt_text || name || 'รูปภาพร้าน'} hero={position === 0} sizes="(max-width: 760px) calc(100vw - 32px), 728px" />
      </div>)}
    </div>
    {slides.length > 1 && <div className={styles.dots}>{slides.map((image, position) => <button type="button" key={image.id} onClick={() => select(position)} aria-label={`ดูรูปภาพร้าน ${position + 1}`} aria-current={index === position ? 'true' : undefined}><span /></button>)}</div>}
  </section>;
}

export function StoreMenuCard({ item }) {
  const soldOut = item.stock_quantity != null && Number(item.stock_quantity) === 0;
  const unavailable = !item.is_available || soldOut;
  return <Link className={styles.menuCard} href={`/menu/${item.id}`}>
    <div className={`${styles.menuImage} ${unavailable ? styles.unavailableImage : ''}`}><StoreImage src={item.image_url} alt={item.name} sizes="96px" /></div>
    <div className={styles.menuCopy}>
      <h3>{item.name}</h3>
      {item.description && <p>{item.description}</p>}
      {unavailable && <span className={styles.unavailableBadge}>{soldOut ? 'หมด' : 'ปิดขาย'}</span>}
      <div className={styles.menuFooter}><strong>{baht(item.price)}</strong><Icon name="arrow" size={17} /></div>
    </div>
  </Link>;
}

export function StoreReviews({ reviews = [], count = 0, average }) {
  const dialog = useRef(null);
  const trigger = useRef(null);
  const cleanup = useRef(null);
  const id = useId();
  const hasReviews = Number(count) > 0;
  useEffect(() => () => cleanup.current?.(), [hasReviews]);
  // The existing public API applies moderation and its existing result limit.
  const latest = [...reviews].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  function open() {
    cleanup.current?.();
    cleanup.current = openReviewDialog(dialog.current, trigger.current);
  }
  if (!hasReviews) return <p>ร้านใหม่</p>;
  return <>
    <button ref={trigger} type="button" className={styles.ratingTrigger} aria-haspopup="dialog" aria-controls={id}
      aria-label={`ดูรีวิวร้าน ${count} รีวิว คะแนนเฉลี่ย ${Number(average).toFixed(1)}`} onClick={open}>
      <Icon name="star" size={18} /><span>{Number(average).toFixed(1)} ({count} รีวิว)</span><Icon name="arrow" size={15} />
    </button>
    <dialog ref={dialog} id={id} className={styles.reviewDialog} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
      <div className={styles.sheetHeader}><h2 id={`${id}-title`}>รีวิวร้าน</h2><button type="button" data-review-close aria-label="ปิดรีวิวร้าน" onClick={() => dialog.current.close()}><span aria-hidden="true">×</span></button></div>
      <div className={styles.sheetSummary}><p className={styles.reviewSummary}><Icon name="star" size={22} /><strong>{Number(average).toFixed(1)}</strong></p><p>จาก {count} รีวิว</p></div>
      <div className={styles.reviewList} tabIndex={0} role="region" aria-label="รายการรีวิว">
        {latest.length ? latest.map((review) => <article key={review.id}>
          <div className={styles.reviewHeading}><strong>{review.display_name}</strong><span role="img" aria-label={`${review.rating} จาก 5 ดาว`}>{'★'.repeat(Math.max(0, Math.min(5, Number(review.rating) || 0)))}</span></div>
          {review.comment && <p>{review.comment}</p>}
          <time dateTime={review.created_at}>{new Date(review.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}</time>
        </article>) : <p className={styles.empty}>ยังไม่มีรีวิว</p>}
        {Number(count) > latest.length && latest.length > 0 && <p className={styles.deliveryNote}>แสดง {latest.length} รีวิวล่าสุดจากทั้งหมด {count} รีวิว</p>}
      </div>
    </dialog>
  </>;
}

export function StoreDetailContent({ merchant, reviews, onFavorite, activeCategoryId, onCategory }) {
  const categories = visibleStoreCategories(merchant.categories);
  const selectedId = categories.some((category) => category.id === activeCategoryId) ? activeCategoryId : categories[0]?.id;
  return <div className={styles.content}>
    <StoreGallery images={merchant.gallery} name={merchant.store_name} closed={!merchant.accepting_orders} />
    <section className={styles.storeInfo}>
      <div className={styles.titleRow}><h1>{merchant.store_name}</h1><button className={`${styles.favorite} ${merchant.is_favorite ? styles.favoriteActive : ''}`} type="button" onClick={onFavorite} aria-pressed={merchant.is_favorite} aria-label={merchant.is_favorite ? 'นำออกจากร้านโปรด' : 'เพิ่มเป็นร้านโปรด'}><Icon name="heart" size={20} /></button></div>
      <div className={styles.summaryRow}><StoreReviews key={merchant.id} reviews={reviews} count={merchant.review_count} average={merchant.average_rating} /><span className={merchant.accepting_orders ? styles.openBadge : styles.closedBadge}>{merchant.accepting_orders ? 'เปิดอยู่' : 'ปิดชั่วคราว'}</span></div>
      {merchant.location_text && <p className={styles.contact}><Icon name="map" size={18} />{merchant.location_text}</p>}
      {merchant.phone && <a className={styles.phone} href={`tel:${merchant.phone.replace(/[^+\d]/g, '')}`}><Icon name="phone" size={18} />{merchant.phone}</a>}
      <div className={styles.delivery}><Icon name="scooter" size={21} /><span>ค่าส่ง <strong>{merchant.delivery?.available ? baht(merchant.delivery.fee) : 'ยังไม่ครอบคลุม'}</strong></span></div>
      <p className={styles.deliveryNote}>เวลาจัดส่งขึ้นอยู่กับจำนวนออเดอร์</p>
    </section>
    {categories.length > 0 && <nav className={styles.categories} aria-label="หมวดหมู่เมนู">{categories.map((category) => <a key={category.id} href={`#category-${category.id}`} aria-current={selectedId === category.id ? 'true' : undefined} onClick={() => onCategory(category.id)}>{category.name}</a>)}</nav>}
    <div className={styles.menuSections}>{categories.length ? categories.map((category) => <section id={`category-${category.id}`} key={category.id}><div className={styles.sectionHeading}><h2>{category.name}</h2><span>{category.items.length} เมนู</span></div><div className={styles.menuList}>{category.items.map((item) => <StoreMenuCard key={item.id} item={item} />)}</div></section>) : <p className={styles.empty}>ร้านนี้ยังไม่มีเมนู</p>}</div>
  </div>;
}
