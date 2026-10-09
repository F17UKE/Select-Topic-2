"use client";
import { useState } from "react";
import Image from "next/image";
import { useManagement } from "./merchant-management";
export function MerchantContent({ kind }) {
  const [page, setPage] = useState(1);
  const { data, error } = useManagement(`/${kind}?page=${page}`);
  return (
    <>
      {kind === "reviews" && data && (
        <div className="management-kpi-grid">
          <article>
            <span>คะแนนเฉลี่ย</span>
            <strong>{Number(data.average_rating).toFixed(1)}</strong>
          </article>
          <article>
            <span>รีวิวทั้งหมด</span>
            <strong>{data.review_count}</strong>
          </article>
        </div>
      )}
      <p className="management-help">
        {kind === "reviews"
          ? "ดูข้อมูลเท่านั้น · แสดงเฉพาะรีวิวที่เผยแพร่ของร้านนี้ · Admin เป็นผู้จัดการสถานะ"
          : "ดูข้อมูลเท่านั้น · Admin เป็นผู้จัดการและเผยแพร่ · แสดงข้อมูลร้านนี้และรายการ Global ที่เกี่ยวข้อง"}
      </p>
      {error && <p role="alert">{error}</p>}
      {data?.items.map((row) => (
        <article className="management-row" key={row.id}>
          <h2>{row.name || row.title || row.display_name}</h2>
          {kind !== "reviews" && (
            <p>
              {row.merchant_id ? "สำหรับร้านนี้" : "Global"} ·{" "}
              {row.status || (row.is_active ? "เปิดใช้งาน" : "ปิดใช้งาน")}
            </p>
          )}
          {kind === "reviews" ? (
            <>
              <p
                className="merchant-review-stars"
                aria-label={`${row.rating} จาก 5 ดาว`}
              >
                {"★".repeat(row.rating)}
              </p>
              <p>{row.comment || "ไม่มีความคิดเห็น"}</p>
              <p>
                {row.order_code} ·{" "}
                {new Date(row.created_at).toLocaleString("th-TH")}
              </p>
            </>
          ) : kind === "banners" ? (
            <>
              <Image
                src={row.image_url}
                width={360}
                height={160}
                unoptimized
                style={{
                  maxWidth: "100%",
                  height: "auto",
                  objectFit: "contain",
                }}
                alt={row.title}
              />
              <p>
                ปลายทาง {row.target_type} · {row.target_value || "—"}
              </p>
            </>
          ) : (
            <>
              <p>{row.description}</p>
              <p>
                {row.promotion_type} · {row.value}
              </p>
              <p>
                ขั้นต่ำ ฿{row.minimum_order_amount} · ส่วนลดสูงสุด{" "}
                {row.maximum_discount_amount ?? "ไม่จำกัด"}
              </p>
              <p>
                ใช้แล้ว {row.usage_count}/{row.usage_limit ?? "ไม่จำกัด"}
              </p>
            </>
          )}
          {kind !== "reviews" && (
            <p>
              {row.starts_at
                ? new Date(row.starts_at).toLocaleString("th-TH")
                : "ไม่กำหนดวันเริ่ม"}{" "}
              —{" "}
              {row.ends_at
                ? new Date(row.ends_at).toLocaleString("th-TH")
                : "ไม่กำหนดวันสิ้นสุด"}
            </p>
          )}
        </article>
      ))}
      {data?.items.length === 0 && <p>ยังไม่มีรายการ</p>}
      <div className="management-toolbar">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          ก่อนหน้า
        </button>
        <span>หน้า {page}</span>
        <button
          disabled={!data || page * 20 >= data.pagination.total}
          onClick={() => setPage(page + 1)}
        >
          ถัดไป
        </button>
      </div>
    </>
  );
}
