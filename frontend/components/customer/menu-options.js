'use client';

import { baht } from '../../lib/api';
import styles from './menu-detail.module.css';

function isLocalDemo(item, development) {
  // Only the exact local seed presentation; never rename arbitrary merchant data.
  return development && item.store_name === 'Local Kitchen'
    && item.name === 'Local Basil Rice' && item.image_url === '/demo/basil-rice.svg';
}

function isLocalRiceDemo(item, development) {
  return development && item.store_name === 'Local Kitchen'
    && item.name === 'Garlic Chicken Rice' && item.image_url === '/demo/garlic-chicken.svg';
}

export function optionGroupTitle(group, item, development = process.env.NODE_ENV === 'development') {
  if (isLocalRiceDemo(item, development) && group.name === 'Rice') return 'ชนิดข้าว';
  return isLocalDemo(item, development) ? ({ Spiciness: 'ระดับความเผ็ด', Extras: 'เพิ่มเติม' }[group.name] || group.name) : group.name;
}

export function optionChoiceTitle(choice, group, item, development = process.env.NODE_ENV === 'development') {
  if (isLocalRiceDemo(item, development) && group.name === 'Rice') {
    const riceLabels = { 'Jasmine rice': 'ข้าวหอมมะลิ', 'Brown rice': 'ข้าวกล้อง' };
    return Object.hasOwn(riceLabels, choice.name) ? riceLabels[choice.name] : choice.name;
  }
  if (!isLocalDemo(item, development)) return choice.name;
  const labels = group.name === 'Spiciness' ? { Mild: 'ไม่เผ็ด', Medium: 'เผ็ดกลาง', Hot: 'เผ็ดมาก' }
    : group.name === 'Extras' ? { 'Fried egg': 'ไข่ดาว', 'Extra rice': 'เพิ่มข้าว' } : {};
  return Object.hasOwn(labels, choice.name) ? labels[choice.name] : choice.name;
}

export function optionRuleLabel(group) {
  if (group.min_choices === group.max_choices) return `เลือก ${group.max_choices} รายการ`;
  if (group.min_choices > 0) return `เลือกอย่างน้อย ${group.min_choices} รายการ · สูงสุด ${group.max_choices}`;
  return `เลือกได้สูงสุด ${group.max_choices}`;
}

export function MenuOptionGroup({ group, item, selectedIds = [], onToggle }) {
  const incomplete = selectedIds.length < group.min_choices;
  const helperId = `option-helper-${group.id}`;
  return <fieldset className={styles.optionGroup} aria-describedby={helperId}>
    <legend><span>{optionGroupTitle(group, item)}</span><small className={group.is_required ? styles.required : styles.optional}>{group.is_required ? 'จำเป็น' : 'ไม่บังคับ'}</small></legend>
    <p id={helperId} className={incomplete ? styles.warning : styles.rule} aria-live="polite">
      {incomplete ? `กรุณาเลือก ${group.min_choices === group.max_choices ? '' : 'อย่างน้อย '}${group.min_choices} รายการ` : optionRuleLabel(group)}
    </p>
    <div className={styles.choices}>{group.choices.map((choice) => {
      const checked = selectedIds.includes(choice.id);
      return <label className={`${styles.choice} ${checked ? styles.selected : ''} ${!choice.is_available ? styles.disabled : ''}`} key={choice.id}>
        <input type={group.max_choices === 1 ? 'radio' : 'checkbox'} name={`group-${group.id}`} checked={checked} disabled={!choice.is_available} onChange={() => onToggle(group, choice.id)} />
        <span>{optionChoiceTitle(choice, group, item)}{!choice.is_available && <small className={styles.unavailable}>ไม่พร้อมใช้งาน</small>}</span>
        <strong>{choice.extra_price ? `+${baht(choice.extra_price)}` : 'ไม่เพิ่มราคา'}</strong>
      </label>;
    })}</div>
  </fieldset>;
}
