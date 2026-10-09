'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { baht } from '../lib/api';
import { ImageUpload } from './merchant-editors';
import { useEffect, useState } from 'react';
import { Editor } from './merchant-editors';
import { managementApi, useManagement } from './merchant-management';
function useCategoryOptions() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    async function load() {
      const items = [];
      for (let page = 1; active; page += 1) {
        const result = await managementApi(`/categories?page=${page}&limit=50`);
        items.push(...result.items);
        if (items.length >= result.pagination.total || !result.items.length) break;
      }
      if (active) setData({ items });
    }
    load().catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  return { data, error };
}
export function CategoryManager() {
  const [page, setPage] = useState(1),
    [editing, setEditing] = useState(null),
    [error, setError] = useState('');
  const { data, error: loadError, reload } = useManagement(`/categories?page=${page}&limit=50`);
  const fields = [
    { key: 'name', label: 'ชื่อหมวดหมู่', required: true },
    { key: 'sort_order', label: 'ลำดับ', type: 'number', min: 0 },
    { key: 'is_active', label: 'เปิดใช้งาน', type: 'checkbox' },
  ];
  const run = async (fn) => {
    try {
      setError('');
      await fn();
      reload();
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <>
      <h2>{editing ? 'แก้ไขหมวดหมู่' : 'เพิ่มหมวดหมู่'}</h2>
      <Editor
        key={editing?.id || 'new'}
        initial={editing || { is_active: true, sort_order: 0 }}
        fields={fields}
        onSave={async (values) => {
          await managementApi(
            editing ? `/categories/${editing.id}` : '/categories',
            editing ? 'PATCH' : 'POST',
            values,
          );
          setEditing(null);
          reload();
        }}
      />
      {editing && (
        <button className="management-button" onClick={() => setEditing(null)}>
          ยกเลิกแก้ไข
        </button>
      )}
      {(error || loadError) && <p role="alert">{error || loadError}</p>}
      {data?.items.map((row) => (
        <article className="management-row" key={row.id}>
          <strong>{row.name}</strong>
          <p>
            {row.is_active ? 'เปิด' : 'ปิด'} · ลำดับ {row.sort_order}
          </p>
          <div className="management-toolbar">
            <button className="management-button" onClick={() => setEditing(row)}>
              แก้ไข
            </button>
            <button
              className="management-button"
              onClick={() => run(() => managementApi(`/categories/${row.id}`, 'PATCH', { direction: -1 }))}
            >
              ขึ้น
            </button>
            <button
              className="management-button"
              onClick={() => run(() => managementApi(`/categories/${row.id}`, 'PATCH', { direction: 1 }))}
            >
              ลง
            </button>
            <button
              className="management-button"
              onClick={() => run(() => managementApi(`/categories/${row.id}`, 'DELETE'))}
            >
              นำหมวดหมู่ออก
            </button>
          </div>
        </article>
      ))}
      <div className="management-toolbar">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          ก่อนหน้า
        </button>
        <span>หน้า {page}</span>
        <button disabled={!data || page * 50 >= data.pagination.total} onClick={() => setPage(page + 1)}>
          ถัดไป
        </button>
      </div>
    </>
  );
}

export function MenuList({ staff }) {
  const [search, setSearch] = useState(''),
    [available, setAvailable] = useState(''),
    [category, setCategory] = useState(''),
    [low, setLow] = useState(false),
    [page, setPage] = useState(1);
  const { data, error } = useManagement(
    `/menu?${new URLSearchParams({ search, available, category_id: category, low_stock: String(low), page: String(page) })}`,
  );
  const categories = useCategoryOptions();
  return (
    <>
      {staff.role === 'MANAGER' && (
        <Link className="management-button" href="/merchant/menu/new">
          เพิ่มเมนู
        </Link>
      )}
      <div className="management-toolbar">
        <input
          aria-label="ค้นหาเมนู"
          placeholder="ค้นหาเมนู"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="หมวดหมู่"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
        >
          <option value="">ทุกหมวดหมู่</option>
          {categories.data?.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="การจำหน่าย"
          value={available}
          onChange={(e) => {
            setAvailable(e.target.value);
            setPage(1);
          }}
        >
          <option value="">ทุกสถานะ</option>
          <option value="true">พร้อมขาย</option>
          <option value="false">งดขาย</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={low}
            onChange={(e) => {
              setLow(e.target.checked);
              setPage(1);
            }}
          />
          สต็อกต่ำ (≤5)
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="management-table">
        <table>
          <thead>
            <tr>
              <th>เมนู</th>
              <th>หมวดหมู่</th>
              <th>ราคา</th>
              <th>สต็อก</th>
              <th>สถานะ</th>
              <th>แก้ไขล่าสุด</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link href={`/merchant/menu/${row.id}`}>
                    {row.image_url && (
                      <Image
                        src={row.image_url}
                        width={64}
                        height={64}
                        unoptimized
                        alt=""
                        style={{ objectFit: 'contain', width: 64, height: 64, minWidth: 64 }}
                      />
                    )}
                    {row.name}
                  </Link>
                </td>
                <td>{row.category_name}</td>
                <td>{baht(row.price)}</td>
                <td>{row.stock_quantity ?? 'ไม่จำกัด'}</td>
                <td>{row.is_available ? 'พร้อมขาย' : 'งดขาย'}</td>
                <td>{new Date(row.updated_at).toLocaleString('th-TH')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="management-toolbar">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          ก่อนหน้า
        </button>
        <span>หน้า {page}</span>
        <button disabled={!data || page * 20 >= data.pagination.total} onClick={() => setPage(page + 1)}>
          ถัดไป
        </button>
      </div>
    </>
  );
}
export function MenuEditor({ id, staff }) {
  const { data, error, reload } = useManagement(id ? `/menu/${id}` : '/categories?limit=50');
  const categories = useCategoryOptions();
  const router = useRouter();
  const [image, setImage] = useState(null),
    [actionError, setActionError] = useState('');
  if (!data) return <p role={error ? 'alert' : undefined}>{error || 'กำลังโหลด…'}</p>;
  const manager = staff.role === 'MANAGER';
  if (!manager)
    return (
      <>
        <h2>{data.name}</h2>
        <p>{data.description}</p>
        <p>
          {baht(data.price)} · สต็อก {data.stock_quantity ?? 'ไม่จำกัด'}
        </p>
        {data.option_groups?.map((g) => (
          <article className="management-row" key={g.id}>
            <strong>{g.name}</strong>
            <p>
              เลือก {g.min_choices}–{g.max_choices}
            </p>
            {g.choices.map((c) => (
              <p key={c.id}>
                {c.name} +{baht(c.extra_price)}
              </p>
            ))}
          </article>
        ))}
      </>
    );
  const fields = [
    { key: 'name', label: 'ชื่อเมนู', required: true },
    {
      key: 'category_id',
      label: 'หมวดหมู่',
      required: true,
      options: categories.data?.items.map((c) => ({ value: c.id, label: c.name })) || [],
    },
    { key: 'description', label: 'รายละเอียด' },
    { key: 'price', label: 'ราคา (บาท)', required: true, type: 'number', min: 0, step: '0.01' },
    { key: 'stock_quantity', label: 'สต็อก (ว่าง = ไม่จำกัด)', type: 'number', min: 0 },
    { key: 'is_available', label: 'พร้อมขาย', type: 'checkbox' },
    { key: 'sort_order', label: 'ลำดับ', type: 'number', min: 0 },
  ];
  const run = async (body) => {
    try {
      setActionError('');
      await managementApi(`/menu/${id}`, 'PATCH', body);
      reload();
    } catch (e) {
      setActionError(e.message);
    }
  };
  return (
    <>
      <Editor
        key={id ? data.updated_at : 'new'}
        initial={id ? data : { price: 0, is_available: true, sort_order: 0 }}
        fields={fields}
        onSave={async (values) => {
          const body = Object.fromEntries(
            fields.map((f) => [f.key, values[f.key] ?? (f.key === 'stock_quantity' ? null : '')]),
          );
          if (image) body.image_url = image;
          const result = await managementApi(id ? `/menu/${id}` : '/menu', id ? 'PATCH' : 'POST', body);
          if (!id) router.push(`/merchant/menu/${result.id}`);
          else reload();
        }}
      />
      <ImageUpload
        namespace="menu"
        onUploaded={async (url) => {
          setImage(url);
          if (id) await run({ image_url: url });
        }}
      />
      {(image || data.image_url) && (
        <Image
          src={image || data.image_url}
          width={160}
          height={160}
          unoptimized
          alt="รูปเมนู"
          style={{ objectFit: 'contain', width: 160, height: 160 }}
        />
      )}
      {id && (
        <>
          <p className="management-help">
            สต็อกปรับด้วยตนเอง ระบบตรวจจำนวนตอนสั่ง แต่ยังไม่หักหรือจองอัตโนมัติ
          </p>
          <div className="management-toolbar">
            <button
              className="management-button"
              disabled={data.stock_quantity === null}
              onClick={() => run({ stock_quantity: data.stock_quantity, stock_delta: 1 })}
            >
              สต็อก +1
            </button>
            <button
              className="management-button"
              disabled={!data.stock_quantity}
              onClick={() => run({ stock_quantity: data.stock_quantity, stock_delta: -1 })}
            >
              สต็อก −1
            </button>
            <button className="management-button" onClick={() => run({ is_available: !data.is_available })}>
              {data.is_available ? 'งดขาย' : 'พร้อมขาย'}
            </button>
            <button
              className="management-button"
              onClick={async () => {
                try {
                  await managementApi(`/menu/${id}`, 'DELETE');
                  router.push('/merchant/menu');
                } catch (e) {
                  setActionError(e.message);
                }
              }}
            >
              นำเมนูออก
            </button>
          </div>
          {actionError && <p role="alert">{actionError}</p>}
          <OptionsEditor item={data} reload={reload} />
        </>
      )}
    </>
  );
}

function OptionsEditor({ item, reload }) {
  const [error, setError] = useState('');
  const base = `/menu/${item.id}/groups`;
  const groupFields = [
    { key: 'name', label: 'ชื่อกลุ่มตัวเลือก', required: true },
    { key: 'is_required', label: 'จำเป็นต้องเลือก', type: 'checkbox' },
    { key: 'min_choices', label: 'เลือกขั้นต่ำ', type: 'number', min: 0 },
    { key: 'max_choices', label: 'เลือกสูงสุด', type: 'number', min: 0 },
    { key: 'sort_order', label: 'ลำดับ', type: 'number', min: 0 },
  ];
  const choiceFields = [
    { key: 'name', label: 'ชื่อตัวเลือก', required: true },
    { key: 'extra_price', label: 'ราคาเพิ่ม', type: 'number', min: 0, step: '0.01', required: true },
    { key: 'is_available', label: 'พร้อมขาย', type: 'checkbox' },
    { key: 'sort_order', label: 'ลำดับ', type: 'number', min: 0 },
  ];
  const save = async (path, method, values) => {
    await managementApi(path, method, values);
    reload();
  };
  const remove = async (path) => {
    try {
      await save(path, 'DELETE');
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <>
      <h2>กลุ่มตัวเลือก</h2>
      <p className="management-help">กลุ่มบังคับควรมีตัวเลือกที่พร้อมขายเพียงพอก่อนเปิดขายเมนู</p>
      {error && <p role="alert">{error}</p>}
      {item.option_groups.map((g) => (
        <details className="management-row" key={g.id}>
          <summary>
            {g.name} · เลือก {g.min_choices}–{g.max_choices}
          </summary>
          <Editor initial={g} fields={groupFields} onSave={(v) => save(`${base}/${g.id}`, 'PATCH', v)} />
          <button className="management-button" onClick={() => remove(`${base}/${g.id}`)}>
            ลบกลุ่มตัวเลือก
          </button>
          {g.choices.map((c) => (
            <details className="management-row" key={c.id}>
              <summary>
                {c.name} +{baht(c.extra_price)}
              </summary>
              <Editor
                initial={c}
                fields={choiceFields}
                onSave={(v) => save(`${base}/${g.id}/choices/${c.id}`, 'PATCH', v)}
              />
              <button className="management-button" onClick={() => remove(`${base}/${g.id}/choices/${c.id}`)}>
                ลบตัวเลือก
              </button>
            </details>
          ))}
          <h3>เพิ่มตัวเลือก</h3>
          <Editor
            fields={choiceFields}
            initial={{ extra_price: 0, is_available: true, sort_order: g.choices.length }}
            onSave={(v) => save(`${base}/${g.id}/choices`, 'POST', v)}
            submitLabel="เพิ่มตัวเลือก"
          />
        </details>
      ))}
      <details className="management-row">
        <summary>เพิ่มกลุ่มตัวเลือก</summary>
        <Editor
          fields={groupFields}
          initial={{
            is_required: false,
            min_choices: 0,
            max_choices: 1,
            sort_order: item.option_groups.length,
          }}
          onSave={(v) => save(base, 'POST', v)}
          submitLabel="เพิ่มกลุ่ม"
        />
      </details>
    </>
  );
}
