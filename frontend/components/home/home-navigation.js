import Link from 'next/link';
import { Icon } from '../icons';
import styles from './home.module.css';

const shortcuts = [
  { href: '/promotions', icon: 'ticket', label: 'โปรโมชัน', subtitle: 'ดูสิทธิ์และส่วนลด' },
  { href: '/favorites', icon: 'heart', label: 'ร้านโปรด', subtitle: 'ร้านที่บันทึกไว้' },
];

export function HomeQuickActions({ promotionCount = 0 }) {
  return <nav className={styles.quickActions} aria-label="ทางลัด">
    {shortcuts.map((item) => <Link key={item.href} href={item.href}>
      <span className={styles.quickIcon}><Icon name={item.icon} size={22} />{item.href === '/promotions' && promotionCount > 0 && <span className={styles.notificationBadge} aria-label={`โปรโมชันที่ใช้งานได้ ${promotionCount} รายการ`}>{promotionCount > 9 ? '9+' : promotionCount}</span>}</span>
      <div><strong>{item.label}</strong><small>{item.subtitle}</small></div><Icon name="arrow" size={14} />
    </Link>)}
  </nav>;
}
