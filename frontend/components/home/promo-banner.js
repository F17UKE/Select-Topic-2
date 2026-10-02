import Image from 'next/image';

export function PromoBanner() {
  return (
    <section className="home-promo" aria-label="โปรโมชันแนะนำ">
      <div className="home-promo-copy">
        <span>อร่อยใกล้หอ</span>
        <h1>รวมร้านอร่อย<br />ส่งตรงถึงคุณ</h1>
        <p>สั่งง่าย อิ่มไว ไม่ต้องรอนาน</p>
        <a href="#recommended-stores">ดูร้านแนะนำ</a>
      </div>
      <div className="home-promo-image" aria-hidden="true">
        <Image src="/demo/promo-food.svg" alt="" fill sizes="180px" priority />
      </div>
    </section>
  );
}
